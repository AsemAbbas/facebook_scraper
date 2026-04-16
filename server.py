"""
مَرصَد · Backend Server
=======================
خادم Flask يقدم:
  - الواجهة (web/)
  - REST API لكل العمليات
  - real-time progress عبر Server-Sent Events
  - background scraping بدون توقف الواجهة

تشغيل:
    python server.py
ثم افتح: http://localhost:5050
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from flask import Flask, jsonify, request, send_from_directory, Response, stream_with_context
    from flask_cors import CORS
except ImportError:
    print("=" * 60)
    print("  Flask not installed. Installing now...")
    print("=" * 60)
    subprocess.run([sys.executable, "-m", "pip", "install",
                    "flask>=3.0.0", "flask-cors>=4.0.0"], check=True)
    from flask import Flask, jsonify, request, send_from_directory, Response, stream_with_context
    from flask_cors import CORS

import yaml

from scrapers.base import UnifiedPost
from scrapers.apify_source import ApifySource
from scrapers.fetchrss_source import FetchRSSSource
from scrapers.rssapp_source import RSSAppSource
from scrapers.rsshub_source import RSSHubSource
from scrapers.playwright_source import PlaywrightSource

# ============================================================
#  Globals
# ============================================================

app = Flask(__name__, static_folder=str(PROJECT_ROOT / "web"), static_url_path="")
CORS(app)

WEB_DIR = PROJECT_ROOT / "web"
DATA_DIR = WEB_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

CONFIG_PATH = PROJECT_ROOT / "config.yml"
PAGES_PATH = PROJECT_ROOT / "pages.json"
HISTORY_PATH = DATA_DIR / "history.json"

# الـ SOURCE registry
SOURCE_REGISTRY = {
    "apify": ApifySource,
    "fetchrss": FetchRSSSource,
    "rssapp": RSSAppSource,
    "rsshub": RSSHubSource,
    "playwright": PlaywrightSource,
}

# Job tracking
JOBS: dict[str, dict] = {}  # job_id -> {status, progress, messages, ...}
JOBS_LOCK = threading.Lock()


# ============================================================
#  Helpers
# ============================================================

def load_config() -> dict:
    """قراءة config.yml + استبدال ${VAR}"""
    if not CONFIG_PATH.exists():
        return {}
    text = CONFIG_PATH.read_text(encoding="utf-8")

    def replacer(m):
        return os.environ.get(m.group(1), "")

    text = re.sub(r"\$\{([A-Z_][A-Z0-9_]*)\}", replacer, text)
    return yaml.safe_load(text) or {}


def load_config_raw() -> dict:
    """قراءة config.yml بدون استبدال (للعرض)"""
    if not CONFIG_PATH.exists():
        return {}
    return yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8")) or {}


def save_config(config: dict) -> None:
    """حفظ config.yml"""
    text = yaml.dump(config, allow_unicode=True, sort_keys=False, default_flow_style=False)
    CONFIG_PATH.write_text(text, encoding="utf-8")


def load_pages() -> dict:
    if not PAGES_PATH.exists():
        return {"pages": []}
    return json.loads(PAGES_PATH.read_text(encoding="utf-8"))


def save_pages(data: dict) -> None:
    # احذف _help قبل الحفظ
    if "_help" in data:
        help_data = data.pop("_help")
    else:
        help_data = None
    out = {"pages": data.get("pages", [])}
    if help_data:
        out["_help"] = help_data
    PAGES_PATH.write_text(
        json.dumps(out, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def load_history() -> list[dict]:
    if not HISTORY_PATH.exists():
        return []
    try:
        data = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        return data.get("runs", [])
    except Exception:
        return []


def append_history(run: dict) -> None:
    runs = load_history()
    runs.insert(0, run)  # latest first
    runs = runs[:50]  # keep last 50
    HISTORY_PATH.write_text(
        json.dumps({"runs": runs}, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_")
    return s[:40] or f"page_{int(time.time())}"


# ============================================================
#  API: Pages
# ============================================================

@app.route("/api/pages", methods=["GET"])
def api_pages_list():
    return jsonify(load_pages())


@app.route("/api/pages", methods=["POST"])
def api_pages_save():
    data = request.get_json(force=True)
    if not isinstance(data, dict) or "pages" not in data:
        return jsonify({"error": "Invalid data"}), 400
    # Auto-slug pages
    for p in data["pages"]:
        if not p.get("slug"):
            p["slug"] = slugify(p.get("name", ""))
    save_pages(data)
    return jsonify({"ok": True, "count": len(data["pages"])})


@app.route("/api/pages/<slug>", methods=["DELETE"])
def api_pages_delete(slug):
    pages_data = load_pages()
    pages_data["pages"] = [p for p in pages_data["pages"] if p.get("slug") != slug]
    save_pages(pages_data)
    # delete data file too
    data_file = DATA_DIR / f"{slug}.json"
    if data_file.exists():
        data_file.unlink()
    return jsonify({"ok": True})


# ============================================================
#  API: Config
# ============================================================

@app.route("/api/config", methods=["GET"])
def api_config_get():
    """يرجع config.yml كـ object + raw YAML text"""
    return jsonify({
        "config": load_config_raw(),
        "raw": CONFIG_PATH.read_text(encoding="utf-8") if CONFIG_PATH.exists() else "",
    })


@app.route("/api/config", methods=["POST"])
def api_config_save():
    """يحفظ config.yml من object"""
    data = request.get_json(force=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid"}), 400
    save_config(data)
    return jsonify({"ok": True})


@app.route("/api/config/raw", methods=["POST"])
def api_config_save_raw():
    """يحفظ config.yml من raw text"""
    data = request.get_json(force=True)
    raw = data.get("raw", "")
    try:
        # validate
        yaml.safe_load(raw)
    except yaml.YAMLError as e:
        return jsonify({"error": f"YAML غير صالح: {e}"}), 400
    CONFIG_PATH.write_text(raw, encoding="utf-8")
    return jsonify({"ok": True})


# ============================================================
#  API: Sources Status
# ============================================================

@app.route("/api/sources", methods=["GET"])
def api_sources_status():
    """يرجع حالة كل المصادر (مفعّل، token موجود، إلخ)"""
    config = load_config()
    sources_config = config.get("sources", [])
    result = []
    for sc in sources_config:
        name = sc.get("name", "")
        info = {
            "name": name,
            "enabled": sc.get("enabled", False),
            "priority": sc.get("priority", 99),
            "has_token": False,
            "icon": {"apify": "💎", "fetchrss": "🪶", "rssapp": "⚡",
                     "rsshub": "🏠", "playwright": "🎭"}.get(name, "🔌"),
            "description": _source_description(name),
            "price": _source_price(name),
        }
        # check token
        for tok_field in ("token", "api_key", "access_key"):
            v = sc.get(tok_field)
            if v and not str(v).startswith("${"):
                info["has_token"] = True
                break
        if name == "playwright":
            info["has_token"] = True  # ما يحتاج token
        if name == "rsshub" and sc.get("base_url"):
            info["has_token"] = True
        result.append(info)
    return jsonify(result)


def _source_description(name: str) -> str:
    return {
        "apify": "أفضل جودة - تفاعلات وتعليقات دقيقة",
        "fetchrss": "الأرخص - يحتاج إنشاء RSS feed لكل صفحة",
        "rssapp": "RSS سريع - تحديث أعلى",
        "rsshub": "مفتوح المصدر - مجاني عبر VPS",
        "playwright": "متصفح محلي - مجاني لكن غير موثوق",
    }.get(name, "")


def _source_price(name: str) -> str:
    return {
        "apify": "$49/شهر (5$ مجاني)",
        "fetchrss": "$9.95/شهر",
        "rssapp": "$16.64/شهر",
        "rsshub": "مجاني",
        "playwright": "مجاني",
    }.get(name, "")


# ============================================================
#  API: Scrape Job
# ============================================================

@app.route("/api/scrape", methods=["POST"])
def api_scrape_start():
    """يبدأ سحب جديد في الخلفية"""
    data = request.get_json(silent=True) or {}
    slug = data.get("slug")  # optional - specific page
    source = data.get("source")  # optional - force source
    date_from = data.get("date_from")
    date_to = data.get("date_to")

    job_id = uuid.uuid4().hex[:12]
    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "status": "queued",  # queued | running | success | error
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
            "progress": 0,
            "total": 0,
            "current_page": "",
            "messages": [],
            "result": None,
            "params": {"slug": slug, "source": source,
                       "date_from": date_from, "date_to": date_to},
        }

    # spawn thread
    t = threading.Thread(
        target=_run_scrape_job,
        args=(job_id, slug, source, date_from, date_to),
        daemon=True,
    )
    t.start()

    return jsonify({"job_id": job_id, "status": "queued"})


def _run_scrape_job(job_id: str, slug: Optional[str], source: Optional[str],
                    date_from: Optional[str], date_to: Optional[str]):
    """تشغيل job في thread منفصل"""
    def update(**kwargs):
        with JOBS_LOCK:
            JOBS[job_id].update(kwargs)

    def push_msg(level: str, text: str):
        with JOBS_LOCK:
            JOBS[job_id]["messages"].append({
                "time": datetime.now(timezone.utc).isoformat(),
                "level": level,
                "text": text,
            })

    update(status="running")
    push_msg("info", "🚀 بدء العملية…")

    try:
        config = load_config()
        pages_data = load_pages()
        all_pages = [p for p in pages_data.get("pages", []) if p.get("enabled", True)]

        if slug:
            all_pages = [p for p in all_pages if p.get("slug") == slug]
            if not all_pages:
                push_msg("error", f"الصفحة {slug} غير موجودة")
                update(status="error", finished_at=datetime.now(timezone.utc).isoformat())
                return

        update(total=len(all_pages))
        push_msg("info", f"📄 سحب {len(all_pages)} صفحة")

        # Build sources
        sources_instances = []
        for sc in config.get("sources", []):
            if not sc.get("enabled"):
                continue
            cls = SOURCE_REGISTRY.get(sc.get("name"))
            if cls:
                sources_instances.append(cls(sc))
        sources_instances.sort(key=lambda s: s.priority)

        if source:
            sources_instances = [s for s in sources_instances if s.source_name == source]

        if not sources_instances:
            push_msg("error", "لا يوجد مصدر مفعّل")
            update(status="error", finished_at=datetime.now(timezone.utc).isoformat())
            return

        push_msg("info", f"🔌 المصادر: {', '.join(s.source_name for s in sources_instances)}")

        # Loop pages
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        total_new = 0
        success_count = 0
        sources_used = set()

        for idx, page in enumerate(all_pages):
            update(progress=idx, current_page=page.get("name", ""))
            push_msg("info", f"📌 [{idx + 1}/{len(all_pages)}] {page.get('name', '')}")

            page_date_from = page.get("date_from") or date_from
            page_date_to = page.get("date_to") or date_to

            # try sources in order
            page_done = False
            for src in sources_instances:
                if page_done:
                    break
                push_msg("info", f"  ⏳ محاولة {src.source_name}…")
                try:
                    posts = loop.run_until_complete(
                        src.scrape_page(
                            page["url"], page["slug"], page["name"],
                            page.get("max_posts", 20),
                            date_from=page_date_from,
                            date_to=page_date_to,
                        )
                    )
                    if posts:
                        # merge & save
                        existing = []
                        out_path = DATA_DIR / f"{page['slug']}.json"
                        if out_path.exists():
                            try:
                                existing_data = json.loads(out_path.read_text(encoding="utf-8"))
                                existing = existing_data.get("posts", [])
                            except Exception:
                                pass
                        existing_ids = {p.get("post_id") for p in existing}
                        truly_new = [p for p in posts if p.post_id not in existing_ids]
                        merged = [p.to_dict() for p in truly_new] + [
                            p for p in existing if p.get("post_id") not in {x.post_id for x in truly_new}
                        ]
                        keep = config.get("output", {}).get("keep_history", 200)
                        merged = merged[:keep]

                        out_path.write_text(json.dumps({
                            "page_slug": page["slug"],
                            "page_name": page["name"],
                            "page_url": page["url"],
                            "last_updated": datetime.now(timezone.utc).isoformat(),
                            "total_posts": len(merged),
                            "posts": merged,
                        }, ensure_ascii=False, indent=2), encoding="utf-8")

                        push_msg("success",
                                 f"  ✅ {src.source_name}: {len(posts)} منشور ({len(truly_new)} جديد)")
                        total_new += len(truly_new)
                        success_count += 1
                        sources_used.add(src.source_name)
                        page_done = True
                    else:
                        push_msg("warn", f"  ⚠️  {src.source_name} ما رجع منشورات")
                except Exception as e:
                    push_msg("error", f"  ❌ {src.source_name}: {str(e)[:100]}")

            if not page_done:
                push_msg("error", f"  ⛔ كل المصادر فشلت لـ {page['name']}")

        update(progress=len(all_pages))

        # Update index.json
        index_data = {
            "last_run": datetime.now(timezone.utc).isoformat(),
            "sources_used": list(sources_used),
            "total_new_posts": total_new,
            "pages": [],
        }
        for page in all_pages:
            out_path = DATA_DIR / f"{page['slug']}.json"
            if out_path.exists():
                try:
                    pd = json.loads(out_path.read_text(encoding="utf-8"))
                    index_data["pages"].append({
                        "slug": page["slug"],
                        "name": page["name"],
                        "url": page["url"],
                        "status": "success",
                        "source_used": next(iter(sources_used), "unknown"),
                        "total_posts": pd.get("total_posts", 0),
                        "new_posts": 0,  # approx
                        "last_updated": pd.get("last_updated"),
                    })
                except Exception:
                    pass

        (DATA_DIR / "index.json").write_text(
            json.dumps(index_data, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

        # save to history
        finished = datetime.now(timezone.utc).isoformat()
        with JOBS_LOCK:
            started_at = JOBS[job_id]["started_at"]
        duration = (datetime.fromisoformat(finished) - datetime.fromisoformat(started_at)).total_seconds()
        append_history({
            "run_id": job_id,
            "started_at": started_at,
            "finished_at": finished,
            "duration_seconds": int(duration),
            "status": "success" if success_count > 0 else "error",
            "trigger": "manual",
            "sources_used": list(sources_used),
            "pages_total": len(all_pages),
            "pages_success": success_count,
            "pages_failed": len(all_pages) - success_count,
            "new_posts": total_new,
            "notes": "",
        })

        update(
            status="success" if success_count > 0 else "error",
            finished_at=finished,
            result={
                "success": success_count,
                "failed": len(all_pages) - success_count,
                "new_posts": total_new,
                "sources_used": list(sources_used),
            },
        )
        push_msg("success", f"🏁 انتهى. {total_new} منشور جديد · {success_count}/{len(all_pages)} صفحة")
    except Exception as e:
        push_msg("error", f"خطأ غير متوقع: {e}")
        update(status="error", finished_at=datetime.now(timezone.utc).isoformat())
    finally:
        try:
            loop.close()
        except Exception:
            pass


@app.route("/api/scrape/<job_id>", methods=["GET"])
def api_scrape_status(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "Not found"}), 404
    return jsonify(job)


@app.route("/api/scrape", methods=["GET"])
def api_scrape_active():
    """يرجع كل الـ jobs النشطة"""
    with JOBS_LOCK:
        active = [j for j in JOBS.values() if j["status"] in ("queued", "running")]
        recent = sorted(JOBS.values(), key=lambda j: j["started_at"], reverse=True)[:5]
    return jsonify({"active": active, "recent": recent})


@app.route("/api/scrape/<job_id>/stream")
def api_scrape_stream(job_id):
    """Server-Sent Events لعرض التقدم real-time"""
    def generate():
        last_msg_count = 0
        while True:
            with JOBS_LOCK:
                job = JOBS.get(job_id)
            if not job:
                yield f"data: {json.dumps({'error': 'job not found'})}\n\n"
                return
            # send only new messages
            new_msgs = job["messages"][last_msg_count:]
            payload = {
                "status": job["status"],
                "progress": job["progress"],
                "total": job["total"],
                "current_page": job["current_page"],
                "new_messages": new_msgs,
                "result": job["result"],
            }
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            last_msg_count = len(job["messages"])
            if job["status"] in ("success", "error"):
                break
            time.sleep(0.8)

    return Response(stream_with_context(generate()),
                    mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})


# ============================================================
#  API: History
# ============================================================

@app.route("/api/history", methods=["GET"])
def api_history():
    return jsonify({"runs": load_history()})


# ============================================================
#  API: Test page (sniff URL)
# ============================================================

@app.route("/api/test-page", methods=["POST"])
def api_test_page():
    """يجرّب سحب 3 منشورات فقط من URL واحد للاختبار"""
    data = request.get_json(force=True)
    url = data.get("url", "").strip()
    source_name = data.get("source", "playwright")

    if not url:
        return jsonify({"error": "URL مطلوب"}), 400

    config = load_config()
    src_config = next((s for s in config.get("sources", []) if s.get("name") == source_name), None)
    if not src_config:
        return jsonify({"error": f"المصدر {source_name} غير موجود في config.yml"}), 400
    if not src_config.get("enabled"):
        return jsonify({"error": f"المصدر {source_name} غير مفعّل"}), 400

    cls = SOURCE_REGISTRY.get(source_name)
    if not cls:
        return jsonify({"error": "مصدر غير معروف"}), 400

    src = cls(src_config)
    loop = asyncio.new_event_loop()
    try:
        posts = loop.run_until_complete(
            src.scrape_page(url, "test", "اختبار", max_posts=3)
        )
        return jsonify({
            "ok": True,
            "count": len(posts),
            "posts": [p.to_dict() for p in posts],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        loop.close()


# ============================================================
#  API: System status
# ============================================================

@app.route("/api/status", methods=["GET"])
def api_status():
    """صحة النظام"""
    pages = load_pages().get("pages", [])
    enabled_pages = [p for p in pages if p.get("enabled", True)]
    config = load_config()
    enabled_sources = [s for s in config.get("sources", []) if s.get("enabled")]

    posts_count = 0
    for f in DATA_DIR.glob("*.json"):
        if f.name == "index.json" or f.name == "history.json":
            continue
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            posts_count += len(d.get("posts", []))
        except Exception:
            pass

    with JOBS_LOCK:
        active = [j for j in JOBS.values() if j["status"] in ("queued", "running")]

    return jsonify({
        "ok": True,
        "version": "3.0.0",
        "pages_count": len(pages),
        "pages_enabled": len(enabled_pages),
        "sources_enabled": len(enabled_sources),
        "posts_count": posts_count,
        "active_jobs": len(active),
        "data_dir": str(DATA_DIR),
    })


# ============================================================
#  Static / SPA fallback
# ============================================================

@app.route("/data/<path:filename>")
def data_files(filename):
    return send_from_directory(str(DATA_DIR), filename)


@app.route("/")
def index():
    return send_from_directory(str(WEB_DIR), "index.html")


# ============================================================
#  Run
# ============================================================

def main():
    port = int(os.environ.get("PORT", 5050))
    host = os.environ.get("HOST", "127.0.0.1")
    no_browser = os.environ.get("NO_BROWSER") == "1"

    print()
    print("=" * 60)
    print("  🔍 مَرصَد · Local Server v3.0")
    print("=" * 60)
    print(f"  Server: http://{host}:{port}")
    print(f"  Data:   {DATA_DIR}")
    print()
    print("  افتح المتصفح وادخل: http://localhost:{}".format(port))
    print("  اضغط Ctrl+C لإيقاف الخادم")
    print("=" * 60)
    print()

    if not no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(f"http://{host}:{port}")).start()

    app.run(host=host, port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
