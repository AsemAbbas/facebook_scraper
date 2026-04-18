"""
مَرصَد · Backend Server v4.0
=============================
Flask + MySQL + Flask-Login · متوافق مع cPanel.

تشغيل محلي:
    python server.py

تشغيل cPanel:
    اتبع CPANEL_DEPLOYMENT.md
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import threading
import time
import uuid
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

# --- Force UTF-8 on stdout/stderr so Arabic + emoji prints don't crash
# on Windows consoles that default to cp1252 ---
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    from flask import (Flask, jsonify, request, send_from_directory,
                       Response, stream_with_context, make_response)
    from flask_cors import CORS
    from flask_login import current_user, login_required
except ImportError:
    import subprocess
    print("Installing Flask dependencies...")
    subprocess.run([sys.executable, "-m", "pip", "install",
                    "flask>=3.0.0", "flask-cors>=4.0.0", "flask-login>=0.6.3"],
                   check=True)
    from flask import (Flask, jsonify, request, send_from_directory,
                       Response, stream_with_context, make_response)
    from flask_cors import CORS
    from flask_login import current_user, login_required

import database as db
import auth as auth_module

from scrapers.base import UnifiedPost
from scrapers.apify_source import ApifySource
from scrapers.fetchrss_source import FetchRSSSource
from scrapers.rssapp_source import RSSAppSource
from scrapers.rsshub_source import RSSHubSource
from scrapers.playwright_source import PlaywrightSource


# ======================================================================
#  App init
# ======================================================================

app = Flask(__name__, static_folder=str(PROJECT_ROOT / "web"), static_url_path="")
CORS(app, supports_credentials=True)

WEB_DIR = PROJECT_ROOT / "web"
DATA_DIR = WEB_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Bootstrap DB
try:
    db.bootstrap()
    print("[db] schema initialized")
except Exception as e:
    print(f"[db] warning: could not init schema: {e}")
    print("[db] make sure MySQL is running and credentials in .env are correct")

# Init auth
auth_module.init_app(app)


# Source metadata
SOURCE_REGISTRY = {
    "apify": ApifySource,
    "fetchrss": FetchRSSSource,
    "rssapp": RSSAppSource,
    "rsshub": RSSHubSource,
    "playwright": PlaywrightSource,
}

SOURCE_META = {
    "apify": {
        "icon": "💎", "label": "Apify",
        "description": "أعلى جودة - تفاعلات وتعليقات دقيقة",
        "price": "$49/شهر (5$ مجاني)",
        "needs_token": True,
        "token_label": "Apify API Token",
        "token_help": "من apify.com → Settings → Integrations → Personal API token",
        "signup_url": "https://apify.com/sign-up",
        "token_url": "https://console.apify.com/account/integrations",
    },
    "fetchrss": {
        "icon": "🪶", "label": "FetchRSS",
        "description": "الأرخص - يحتاج إنشاء RSS لكل صفحة",
        "price": "$9.95/شهر",
        "needs_token": False,
        "token_label": "غير مطلوب (ضع RSS URL في كل صفحة)",
        "token_help": "أنشئ feed في fetchrss.com ثم ضع رابط الـ RSS في حقل URL للصفحة",
        "signup_url": "https://fetchrss.com",
        "token_url": "https://fetchrss.com/dashboard",
    },
    "rssapp": {
        "icon": "⚡", "label": "RSS.app",
        "description": "RSS متوسط - تحديث أسرع",
        "price": "$16.64/شهر",
        "needs_token": False,
        "token_label": "غير مطلوب (ضع RSS URL في كل صفحة)",
        "token_help": "أنشئ feed في rss.app ثم ضع رابط الـ RSS في حقل URL للصفحة",
        "signup_url": "https://rss.app",
        "token_url": "https://rss.app/dashboard",
    },
    "rsshub": {
        "icon": "🏠", "label": "RSSHub",
        "description": "مفتوح المصدر - مجاني (تحتاج VPS)",
        "price": "مجاني / ~$4 على VPS",
        "needs_token": False,
        "token_label": "Base URL للـ RSSHub instance",
        "token_help": "استخدم https://rsshub.app (عام) أو نصّب نسختك الخاصة",
        "signup_url": "https://docs.rsshub.app",
        "token_url": "https://docs.rsshub.app/install/",
    },
    "playwright": {
        "icon": "🎭", "label": "Playwright",
        "description": "متصفح محلي - مجاني (غير متاح على cPanel)",
        "price": "مجاني",
        "needs_token": False,
        "token_label": "لا يتطلب (يستخدم Chromium محلياً)",
        "token_help": "يعمل فقط على جهازك المحلي، ليس على cPanel. استخدم Apify/FetchRSS لـ cPanel.",
        "signup_url": "",
        "token_url": "",
    },
}


# Job tracking (in-memory for real-time progress; DB for persistent history)
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()

# Scheduler state
SCHEDULER_STATE = {"running": False, "thread": None}


# ======================================================================
#  API: System status
# ======================================================================

@app.route("/api/status", methods=["GET"])
def api_status():
    """حالة النظام (public - بدون auth)"""
    try:
        db_ok, db_msg = db.test_connection()
    except Exception as e:
        db_ok, db_msg = False, str(e)

    info = {
        "ok": True,
        "version": "4.0.0",
        "database": {"connected": db_ok, "message": db_msg},
        "has_users": False,
        "authenticated": False,
    }
    if db_ok:
        try:
            info["has_users"] = db.user_count() > 0
        except Exception:
            pass

    if current_user.is_authenticated:
        info["authenticated"] = True
        info["user"] = current_user.to_dict()
        try:
            info["pages_count"] = len(db.list_pages(current_user.id))
            info["posts_count"] = db.count_posts(current_user.id)
        except Exception:
            pass

    return jsonify(info)


# ======================================================================
#  API: Pages (user-scoped)
# ======================================================================

@app.route("/api/pages", methods=["GET"])
@login_required
def api_pages_list():
    pages = db.list_pages(current_user.id)
    return jsonify({"pages": pages})


@app.route("/api/pages", methods=["POST"])
@login_required
def api_pages_save():
    data = request.get_json(force=True)
    if not isinstance(data, dict) or "pages" not in data:
        return jsonify({"error": "Invalid data"}), 400
    # Auto-slug
    for p in data["pages"]:
        if not p.get("slug"):
            p["slug"] = _slugify(p.get("name", ""))
    db.upsert_pages(current_user.id, data["pages"])
    return jsonify({"ok": True, "count": len(data["pages"])})


@app.route("/api/pages/<slug>", methods=["DELETE"])
@login_required
def api_pages_delete(slug):
    db.delete_page(current_user.id, slug)
    return jsonify({"ok": True})


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").strip().lower()).strip("_")
    return s[:40] or f"page_{int(time.time())}"


# ======================================================================
#  API: Posts (user-scoped) - with filtering + delete
# ======================================================================

@app.route("/api/posts", methods=["GET"])
@login_required
def api_posts_list():
    args = request.args
    posts = db.list_posts(
        current_user.id,
        page_slug=args.get("page") or None,
        source=args.get("source") or None,
        min_reactions=int(args.get("min_reactions", 0) or 0),
        min_comments=int(args.get("min_comments", 0) or 0),
        date_from=args.get("date_from") or None,
        date_to=args.get("date_to") or None,
        search=args.get("search") or None,
        limit=min(1000, int(args.get("limit", 500) or 500)),
        offset=int(args.get("offset", 0) or 0),
        order_by=args.get("order_by", "newest"),
    )
    total = db.count_posts(current_user.id, page_slug=args.get("page") or None)
    return jsonify({"posts": posts, "total": total})


@app.route("/api/posts/<int:post_id>", methods=["DELETE"])
@login_required
def api_post_delete(post_id):
    ok = db.delete_post(current_user.id, post_id)
    return jsonify({"ok": ok})


@app.route("/api/posts/bulk-delete", methods=["POST"])
@login_required
def api_posts_bulk_delete():
    data = request.get_json(force=True) or {}
    ids = data.get("ids") or []
    if not isinstance(ids, list):
        return jsonify({"error": "ids must be array"}), 400
    ids = [int(x) for x in ids if str(x).isdigit()]
    n = db.delete_posts_bulk(current_user.id, ids)
    return jsonify({"ok": True, "deleted": n})


@app.route("/api/posts/clear-page/<slug>", methods=["POST"])
@login_required
def api_posts_clear_page(slug):
    n = db.delete_posts_by_page(current_user.id, slug)
    return jsonify({"ok": True, "deleted": n})


@app.route("/api/posts/clear-all", methods=["POST"])
@login_required
def api_posts_clear_all():
    n = db.delete_all_posts(current_user.id)
    return jsonify({"ok": True, "deleted": n})


@app.route("/api/posts/dedupe", methods=["POST"])
@login_required
def api_posts_dedupe():
    """تنظيف المنشورات المكرّرة الموجودة (يحتفظ بأقدم نسخة)"""
    result = db.deduplicate_existing_posts(current_user.id)
    return jsonify({"ok": True, **result})


@app.route("/api/posts/export", methods=["GET"])
@login_required
def api_posts_export():
    """يرجع CSV كاملة (نفس الفلاتر مثل list)"""
    args = request.args
    posts = db.list_posts(
        current_user.id,
        page_slug=args.get("page") or None,
        source=args.get("source") or None,
        min_reactions=int(args.get("min_reactions", 0) or 0),
        min_comments=int(args.get("min_comments", 0) or 0),
        date_from=args.get("date_from") or None,
        date_to=args.get("date_to") or None,
        search=args.get("search") or None,
        limit=100_000,
        offset=0,
        order_by=args.get("order_by", "newest"),
    )
    csv_rows = [["الصفحة", "النص", "التفاعلات", "التعليقات", "المشاركات", "التاريخ", "المصدر", "الرابط"]]
    for p in posts:
        csv_rows.append([
            p.get("page_name", ""),
            (p.get("text", "") or "").replace('"', '""'),
            p.get("reactions", 0),
            p.get("comments", 0),
            p.get("shares", 0),
            p.get("published_at") or p.get("scraped_at") or "",
            p.get("source", ""),
            p.get("post_url") or "",
        ])
    csv_text = "\ufeff" + "\n".join(
        ",".join(f'"{c}"' for c in row) for row in csv_rows
    )

    resp = make_response(csv_text)
    resp.headers["Content-Type"] = "text/csv; charset=utf-8"
    resp.headers["Content-Disposition"] = (
        f'attachment; filename="marsad_{datetime.now().strftime("%Y%m%d_%H%M")}.csv"'
    )
    return resp


@app.route("/api/posts/export-and-delete", methods=["POST"])
@login_required
def api_posts_export_and_delete():
    """يرجع CSV ويحذف بعدها (للأرشفة)"""
    data = request.get_json(silent=True) or {}
    page_slug = data.get("page") or None

    posts = db.list_posts(
        current_user.id,
        page_slug=page_slug,
        limit=100_000,
    )

    # Build CSV string
    csv_rows = [["الصفحة", "النص", "التفاعلات", "التعليقات", "المشاركات", "التاريخ", "المصدر", "الرابط"]]
    for p in posts:
        csv_rows.append([
            p.get("page_name", ""),
            (p.get("text", "") or "").replace('"', '""'),
            p.get("reactions", 0),
            p.get("comments", 0),
            p.get("shares", 0),
            p.get("published_at") or p.get("scraped_at") or "",
            p.get("source", ""),
            p.get("post_url") or "",
        ])
    csv_text = "\ufeff" + "\n".join(
        ",".join(f'"{c}"' for c in row) for row in csv_rows
    )

    # Delete after export
    if page_slug:
        n = db.delete_posts_by_page(current_user.id, page_slug)
    else:
        n = db.delete_all_posts(current_user.id)

    return jsonify({
        "ok": True,
        "deleted": n,
        "csv": csv_text,
        "count": len(posts),
    })


# ======================================================================
#  API: Stats
# ======================================================================

@app.route("/api/stats", methods=["GET"])
@login_required
def api_stats():
    return jsonify({
        "totals": db.stats_totals(current_user.id),
        "by_page": db.stats_by_page(current_user.id),
        "by_source": db.stats_by_source(current_user.id),
    })


# ======================================================================
#  API: Sources (user-scoped)
# ======================================================================

@app.route("/api/sources", methods=["GET"])
@login_required
def api_sources_list():
    sources = db.list_sources(current_user.id)
    # enrich with meta
    for s in sources:
        meta = SOURCE_META.get(s["source_name"], {})
        s.update({
            "icon": meta.get("icon", "🔌"),
            "label": meta.get("label", s["source_name"]),
            "description": meta.get("description", ""),
            "price": meta.get("price", ""),
            "needs_token": meta.get("needs_token", False),
            "token_label": meta.get("token_label", ""),
            "token_help": meta.get("token_help", ""),
            "signup_url": meta.get("signup_url", ""),
            "token_url": meta.get("token_url", ""),
        })
    return jsonify({"sources": sources})


@app.route("/api/sources/<name>", methods=["PATCH"])
@login_required
def api_source_update(name):
    if name not in SOURCE_REGISTRY:
        return jsonify({"error": "مصدر غير معروف"}), 404
    data = request.get_json(silent=True) or {}
    updates = {}
    if "enabled" in data:
        updates["enabled"] = bool(data["enabled"])
    if "priority" in data:
        updates["priority"] = int(data["priority"])
    if "token" in data:
        updates["token"] = data["token"]
    if "config" in data and isinstance(data["config"], dict):
        updates["config"] = data["config"]

    db.update_source(current_user.id, name, **updates)
    return jsonify({"ok": True})


# ======================================================================
#  API: Scrape (user-scoped with real-time SSE)
# ======================================================================

@app.route("/api/scrape", methods=["POST"])
@login_required
def api_scrape_start():
    data = request.get_json(silent=True) or {}
    job_uid = uuid.uuid4().hex[:12]

    params = {
        "slug": data.get("slug"),
        "source": data.get("source"),
        "date_from": data.get("date_from"),
        "date_to": data.get("date_to"),
        "trigger": "manual",
    }

    with JOBS_LOCK:
        JOBS[job_uid] = {
            "id": job_uid,
            "user_id": current_user.id,
            "status": "queued",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
            "progress": 0,
            "total": 0,
            "current_page": "",
            "messages": [],
            "result": None,
            "params": params,
        }
    db.create_job(current_user.id, job_uid, params)

    t = threading.Thread(
        target=_run_scrape_job,
        args=(current_user.id, job_uid, params),
        daemon=True,
    )
    t.start()

    return jsonify({"job_id": job_uid, "status": "queued"})


def _run_scrape_job(user_id: int, job_uid: str, params: dict):
    """تشغيل الـ scraping في thread منفصل"""
    def update(**kwargs):
        with JOBS_LOCK:
            if job_uid in JOBS:
                JOBS[job_uid].update(kwargs)

    def push_msg(level: str, text: str):
        with JOBS_LOCK:
            if job_uid in JOBS:
                JOBS[job_uid]["messages"].append({
                    "time": datetime.now(timezone.utc).isoformat(),
                    "level": level,
                    "text": text,
                })

    update(status="running")
    db.update_job(job_uid, status="running")
    push_msg("info", "🚀 بدء العملية…")

    try:
        pages_all = db.list_pages(user_id, only_enabled=True)
        slug = params.get("slug")
        force_src = params.get("source")
        date_from = params.get("date_from")
        date_to = params.get("date_to")

        if slug:
            pages_all = [p for p in pages_all if p["slug"] == slug]
        if not pages_all:
            push_msg("error", "لا توجد صفحات مفعّلة")
            update(status="error",
                   finished_at=datetime.now(timezone.utc).isoformat())
            db.update_job(job_uid, status="error",
                          finished_at=datetime.now(timezone.utc))
            return

        update(total=len(pages_all))
        push_msg("info", f"📄 سحب {len(pages_all)} صفحة")

        # Build sources - user-scoped
        user_sources = db.list_sources(user_id)
        sources_instances = []
        for s in user_sources:
            if not s["enabled"]:
                continue
            cls = SOURCE_REGISTRY.get(s["source_name"])
            if not cls:
                continue
            # reconstruct config dict
            full_conf = dict(s.get("config") or {})
            full_conf["name"] = s["source_name"]
            full_conf["enabled"] = s["enabled"]
            full_conf["priority"] = s["priority"]
            # token
            secrets_ = db.get_source_with_token(user_id, s["source_name"])
            tok = (secrets_ or {}).get("token", "")
            if s["source_name"] == "apify":
                full_conf["token"] = tok
            elif s["source_name"] in ("fetchrss",):
                full_conf["api_key"] = tok
            elif s["source_name"] == "rssapp":
                full_conf["api_key"] = tok
            elif s["source_name"] == "rsshub":
                full_conf["base_url"] = full_conf.get("base_url") or (tok or "https://rsshub.app")
            sources_instances.append(cls(full_conf))

        sources_instances.sort(key=lambda s: s.priority)

        if force_src:
            # Put forced source first, keep others as fallback
            preferred = [s for s in sources_instances if s.source_name == force_src]
            others = [s for s in sources_instances if s.source_name != force_src]
            sources_instances = preferred + others
            if not preferred:
                push_msg("warn", f"⚠️ المصدر المطلوب '{force_src}' غير مفعّل - استخدام البديل")

        if not sources_instances:
            push_msg("error", "لا يوجد مصدر مفعّل - افتح الإعدادات وفعّل مصدراً أولاً")
            update(status="error",
                   finished_at=datetime.now(timezone.utc).isoformat())
            db.update_job(job_uid, status="error",
                          finished_at=datetime.now(timezone.utc))
            return

        push_msg("info", f"🔌 المصادر (بترتيب الأولوية): {', '.join(s.source_name for s in sources_instances)}")

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        total_new = 0
        success_count = 0
        sources_used: set = set()
        started = datetime.now(timezone.utc)

        for idx, page in enumerate(pages_all):
            update(progress=idx, current_page=page.get("name", ""))
            push_msg("info", f"📌 [{idx + 1}/{len(pages_all)}] {page.get('name', '')}")

            page_df = page.get("date_from") or date_from
            page_dt = page.get("date_to") or date_to

            done = False
            for src in sources_instances:
                if done:
                    break
                push_msg("info", f"  ⏳ محاولة {src.source_name}…")
                try:
                    posts_result = loop.run_until_complete(
                        src.scrape_page(
                            page["url"], page["slug"], page["name"],
                            page.get("max_posts", 20),
                            date_from=page_df, date_to=page_dt,
                        )
                    )
                    if posts_result:
                        posts_dicts = [p.to_dict() for p in posts_result]
                        new_n = db.insert_posts(user_id, page["slug"], posts_dicts)
                        push_msg("success",
                                 f"  ✅ {src.source_name}: {len(posts_result)} سُحب ({new_n} جديد)")
                        total_new += new_n
                        success_count += 1
                        sources_used.add(src.source_name)
                        done = True
                    else:
                        push_msg("warn", f"  ⚠️  {src.source_name} ما رجع منشورات")
                except Exception as e:
                    push_msg("error", f"  ❌ {src.source_name}: {str(e)[:120]}")

            if not done:
                push_msg("error", f"  ⛔ كل المصادر فشلت لـ {page['name']}")

        update(progress=len(pages_all))
        finished = datetime.now(timezone.utc)
        duration = int((finished - started).total_seconds())

        final_status = "success" if success_count > 0 else "error"

        update(
            status=final_status,
            finished_at=finished.isoformat(),
            result={
                "success": success_count,
                "failed": len(pages_all) - success_count,
                "new_posts": total_new,
                "sources_used": list(sources_used),
            },
        )

        # persist to DB
        with JOBS_LOCK:
            msgs = JOBS.get(job_uid, {}).get("messages", [])
        db.update_job(
            job_uid,
            status=final_status,
            finished_at=finished,
            duration_seconds=duration,
            sources_used=list(sources_used),
            pages_total=len(pages_all),
            pages_success=success_count,
            pages_failed=len(pages_all) - success_count,
            new_posts=total_new,
            messages_json=json.dumps(msgs, ensure_ascii=False),
        )

        push_msg("success",
                 f"🏁 انتهى. {total_new} منشور جديد · {success_count}/{len(pages_all)} صفحة")

    except Exception as e:
        push_msg("error", f"خطأ غير متوقع: {e}")
        update(status="error", finished_at=datetime.now(timezone.utc).isoformat())
        db.update_job(job_uid, status="error",
                      finished_at=datetime.now(timezone.utc))


@app.route("/api/scrape/<job_id>", methods=["GET"])
@login_required
def api_scrape_status(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if job and job.get("user_id") == current_user.id:
        return jsonify(job)
    # fallback to DB
    j = db.get_job_by_uid(job_id)
    if j and j.get("user_id") == current_user.id:
        return jsonify(j)
    return jsonify({"error": "Not found"}), 404


@app.route("/api/scrape", methods=["GET"])
@login_required
def api_scrape_active():
    with JOBS_LOCK:
        active = [
            j for j in JOBS.values()
            if j.get("user_id") == current_user.id
            and j["status"] in ("queued", "running")
        ]
    return jsonify({"active": active})


@app.route("/api/scrape/<job_id>/stream")
@login_required
def api_scrape_stream(job_id):
    uid = current_user.id

    def generate():
        last = 0
        for _ in range(2000):  # max ~30 min
            with JOBS_LOCK:
                job = JOBS.get(job_id)
            if not job:
                yield f"data: {json.dumps({'error': 'not found'})}\n\n"
                return
            if job.get("user_id") != uid:
                yield f"data: {json.dumps({'error': 'forbidden'})}\n\n"
                return
            new_msgs = job["messages"][last:]
            last = len(job["messages"])
            payload = {
                "status": job["status"],
                "progress": job["progress"],
                "total": job["total"],
                "current_page": job["current_page"],
                "new_messages": new_msgs,
                "result": job["result"],
            }
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            if job["status"] in ("success", "error"):
                break
            time.sleep(0.8)

    return Response(stream_with_context(generate()),
                    mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no"})


# ======================================================================
#  API: History
# ======================================================================

@app.route("/api/history", methods=["GET"])
@login_required
def api_history():
    runs = db.list_jobs(current_user.id, limit=50)
    return jsonify({"runs": runs})


# ======================================================================
#  API: Test single URL
# ======================================================================

@app.route("/api/test-page", methods=["POST"])
@login_required
def api_test_page():
    data = request.get_json(force=True)
    url = (data.get("url") or "").strip()
    source_name = data.get("source", "playwright")
    if not url:
        return jsonify({"error": "URL مطلوب"}), 400

    sec = db.get_source_with_token(current_user.id, source_name)
    if not sec:
        return jsonify({"error": f"المصدر {source_name} غير معرّف"}), 400
    if not sec["enabled"]:
        return jsonify({"error": f"المصدر {source_name} معطّل. فعّله أولاً."}), 400

    cls = SOURCE_REGISTRY.get(source_name)
    if not cls:
        return jsonify({"error": "مصدر غير معروف"}), 400

    conf = dict(sec.get("config") or {})
    conf["name"] = source_name
    conf["enabled"] = True
    conf["priority"] = sec.get("priority", 99)
    if source_name == "apify":
        conf["token"] = sec.get("token", "")
    elif source_name in ("fetchrss", "rssapp"):
        conf["api_key"] = sec.get("token", "")
    elif source_name == "rsshub":
        conf["base_url"] = conf.get("base_url") or "https://rsshub.app"

    src = cls(conf)
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


# ======================================================================
#  API: User prefs
# ======================================================================

@app.route("/api/prefs", methods=["GET"])
@login_required
def api_prefs_get():
    return jsonify(db.get_prefs(current_user.id))


@app.route("/api/prefs", methods=["POST"])
@login_required
def api_prefs_save():
    data = request.get_json(silent=True) or {}
    db.save_prefs(current_user.id, data)
    return jsonify({"ok": True})


# ======================================================================
#  API: Schedules (CRUD)
# ======================================================================

@app.route("/api/schedules", methods=["GET"])
@login_required
def api_schedules_list():
    return jsonify({"schedules": db.list_schedules(current_user.id)})


@app.route("/api/schedules", methods=["POST"])
@login_required
def api_schedules_create():
    data = request.get_json(silent=True) or {}
    if not data.get("name"):
        return jsonify({"error": "الاسم مطلوب"}), 400
    if not data.get("interval_minutes"):
        return jsonify({"error": "الفاصل الزمني مطلوب"}), 400
    sched_id = db.create_schedule(current_user.id, data)
    return jsonify({"ok": True, "id": sched_id})


@app.route("/api/schedules/<int:sid>", methods=["PATCH"])
@login_required
def api_schedules_update(sid):
    data = request.get_json(silent=True) or {}
    ok = db.update_schedule(current_user.id, sid, data)
    if not ok:
        return jsonify({"error": "لم يتم العثور على المهمة"}), 404
    return jsonify({"ok": True})


@app.route("/api/schedules/<int:sid>", methods=["DELETE"])
@login_required
def api_schedules_delete(sid):
    ok = db.delete_schedule(current_user.id, sid)
    return jsonify({"ok": ok})


@app.route("/api/schedules/<int:sid>/run-now", methods=["POST"])
@login_required
def api_schedules_run_now(sid):
    """تشغيل schedule يدوياً الآن"""
    sched = db.get_schedule(current_user.id, sid)
    if not sched:
        return jsonify({"error": "غير موجود"}), 404
    _run_scheduled_job(current_user.id, sched)
    return jsonify({"ok": True})


def _calculate_date_from(preset: str, custom_hours: int) -> Optional[str]:
    """يرجع ISO date لـ date_from حسب الـ preset"""
    from datetime import timedelta
    hours_map = {
        "last_1h": 1,
        "last_24h": 24,
        "last_2d": 48,
        "last_week": 168,
        "last_month": 720,
    }
    hours = hours_map.get(preset) if preset != "custom" else int(custom_hours or 24)
    if hours is None:
        return None
    dt = datetime.now(timezone.utc) - timedelta(hours=hours)
    return dt.isoformat()


def _run_scheduled_job(user_id: int, sched: dict):
    """يحوّل schedule إلى scrape job"""
    job_uid = uuid.uuid4().hex[:12]
    date_from = _calculate_date_from(
        sched.get("date_range_preset", "last_24h"),
        sched.get("custom_hours_back", 24),
    )

    params = {
        "slug": None,  # all pages (filter in thread)
        "source": sched.get("source") if sched.get("source") != "auto" else None,
        "date_from": date_from,
        "date_to": None,
        "trigger": "schedule",
        "schedule_id": sched["id"],
        "schedule_name": sched.get("name"),
        "pages_filter": sched.get("pages") or [],
    }

    with JOBS_LOCK:
        JOBS[job_uid] = {
            "id": job_uid,
            "user_id": user_id,
            "status": "queued",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
            "progress": 0,
            "total": 0,
            "current_page": "",
            "messages": [],
            "result": None,
            "params": params,
        }
    db.create_job(user_id, job_uid, params)

    t = threading.Thread(
        target=_run_scheduled_scrape,
        args=(user_id, job_uid, params),
        daemon=True,
    )
    t.start()
    db.mark_schedule_ran(sched["id"])


def _run_scheduled_scrape(user_id: int, job_uid: str, params: dict):
    """نسخة من _run_scrape_job تدعم pages_filter"""
    def update(**kwargs):
        with JOBS_LOCK:
            if job_uid in JOBS:
                JOBS[job_uid].update(kwargs)

    def push_msg(level: str, text: str):
        with JOBS_LOCK:
            if job_uid in JOBS:
                JOBS[job_uid]["messages"].append({
                    "time": datetime.now(timezone.utc).isoformat(),
                    "level": level,
                    "text": text,
                })

    update(status="running")
    db.update_job(job_uid, status="running")
    push_msg("info", f"🕐 مهمة مجدولة: {params.get('schedule_name', '')}")

    try:
        pages_all = db.list_pages(user_id, only_enabled=True)
        pages_filter = params.get("pages_filter") or []
        if pages_filter:
            pages_all = [p for p in pages_all if p["slug"] in pages_filter]

        if not pages_all:
            push_msg("error", "لا توجد صفحات مفعّلة")
            update(status="error",
                   finished_at=datetime.now(timezone.utc).isoformat())
            db.update_job(job_uid, status="error",
                          finished_at=datetime.now(timezone.utc))
            return

        update(total=len(pages_all))
        push_msg("info", f"📄 سحب {len(pages_all)} صفحة")

        user_sources = db.list_sources(user_id)
        sources_instances = []
        for s in user_sources:
            if not s["enabled"]:
                continue
            cls = SOURCE_REGISTRY.get(s["source_name"])
            if not cls:
                continue
            full_conf = dict(s.get("config") or {})
            full_conf["name"] = s["source_name"]
            full_conf["enabled"] = s["enabled"]
            full_conf["priority"] = s["priority"]
            secrets_ = db.get_source_with_token(user_id, s["source_name"])
            tok = (secrets_ or {}).get("token", "")
            if s["source_name"] == "apify":
                full_conf["token"] = tok
            elif s["source_name"] in ("fetchrss", "rssapp"):
                full_conf["api_key"] = tok
            elif s["source_name"] == "rsshub":
                full_conf["base_url"] = full_conf.get("base_url") or (tok or "https://rsshub.app")
            sources_instances.append(cls(full_conf))

        sources_instances.sort(key=lambda s: s.priority)

        force_src = params.get("source")
        if force_src:
            # Put forced source first, but keep others as fallback
            preferred = [s for s in sources_instances if s.source_name == force_src]
            others = [s for s in sources_instances if s.source_name != force_src]
            sources_instances = preferred + others
            if not preferred:
                push_msg("warn", f"⚠️ المصدر المطلوب '{force_src}' غير مفعّل - استخدام البديل")

        if not sources_instances:
            push_msg("error", "لا يوجد مصدر مفعّل. افتح الإعدادات وفعّل مصدراً أولاً.")
            update(status="error",
                   finished_at=datetime.now(timezone.utc).isoformat())
            db.update_job(job_uid, status="error",
                          finished_at=datetime.now(timezone.utc))
            return

        push_msg("info", f"🔌 المصادر (بترتيب الأولوية): {', '.join(s.source_name for s in sources_instances)}")

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        total_new = 0
        success_count = 0
        sources_used: set = set()
        started = datetime.now(timezone.utc)
        date_from = params.get("date_from")
        date_to = params.get("date_to")

        for idx, page in enumerate(pages_all):
            update(progress=idx, current_page=page.get("name", ""))
            push_msg("info", f"📌 [{idx + 1}/{len(pages_all)}] {page.get('name', '')}")

            done = False
            for src in sources_instances:
                if done:
                    break
                push_msg("info", f"  ⏳ محاولة {src.source_name}…")
                try:
                    posts_result = loop.run_until_complete(
                        src.scrape_page(
                            page["url"], page["slug"], page["name"],
                            page.get("max_posts", 20),
                            date_from=date_from, date_to=date_to,
                        )
                    )
                    if posts_result:
                        posts_dicts = [p.to_dict() for p in posts_result]
                        new_n = db.insert_posts(user_id, page["slug"], posts_dicts)
                        push_msg("success",
                                 f"  ✅ {src.source_name}: {len(posts_result)} سُحب ({new_n} جديد)")
                        total_new += new_n
                        success_count += 1
                        sources_used.add(src.source_name)
                        done = True
                    else:
                        push_msg("warn", f"  ⚠️  {src.source_name} ما رجع منشورات")
                except Exception as e:
                    push_msg("error", f"  ❌ {src.source_name}: {str(e)[:120]}")

        update(progress=len(pages_all))
        finished = datetime.now(timezone.utc)
        duration = int((finished - started).total_seconds())
        final_status = "success" if success_count > 0 else "error"

        with JOBS_LOCK:
            msgs = JOBS.get(job_uid, {}).get("messages", [])

        update(status=final_status, finished_at=finished.isoformat(),
               result={"new_posts": total_new, "success": success_count,
                       "failed": len(pages_all) - success_count,
                       "sources_used": list(sources_used)})

        db.update_job(
            job_uid,
            status=final_status,
            finished_at=finished,
            duration_seconds=duration,
            sources_used=list(sources_used),
            pages_total=len(pages_all),
            pages_success=success_count,
            pages_failed=len(pages_all) - success_count,
            new_posts=total_new,
            messages_json=json.dumps(msgs, ensure_ascii=False),
        )

        push_msg("success",
                 f"🏁 انتهى. {total_new} منشور جديد · {success_count}/{len(pages_all)} صفحة")

    except Exception as e:
        push_msg("error", f"خطأ: {e}")
        update(status="error", finished_at=datetime.now(timezone.utc).isoformat())
        db.update_job(job_uid, status="error",
                      finished_at=datetime.now(timezone.utc))


def _scheduler_loop():
    """خيط يفحص schedules المستحقة كل 30 ثانية"""
    print("[scheduler] loop started")
    while SCHEDULER_STATE.get("running"):
        try:
            due = db.get_due_schedules()
            for sched in due:
                try:
                    _run_scheduled_job(sched["user_id"], sched)
                    print(f"[scheduler] fired schedule #{sched['id']} '{sched.get('name')}'")
                except Exception as e:
                    print(f"[scheduler] error firing schedule {sched.get('id')}: {e}")
        except Exception as e:
            print(f"[scheduler] loop error: {e}")
        time.sleep(30)


def start_scheduler():
    if SCHEDULER_STATE.get("running"):
        return
    SCHEDULER_STATE["running"] = True
    t = threading.Thread(target=_scheduler_loop, daemon=True)
    t.start()
    SCHEDULER_STATE["thread"] = t


# ======================================================================
#  Static files
# ======================================================================

@app.route("/")
def index():
    return send_from_directory(str(WEB_DIR), "index.html")


# ======================================================================
#  Main (for local dev)
# ======================================================================

def main():
    port = int(os.environ.get("PORT", 5050))
    host = os.environ.get("HOST", "127.0.0.1")
    no_browser = os.environ.get("NO_BROWSER") == "1"

    print()
    print("=" * 62)
    print("  🔍 مَرصَد · Server v4.0 (MySQL + Auth + cPanel-ready)")
    print("=" * 62)
    print(f"  Server: http://{host}:{port}")
    print(f"  DB:     {db.DB_CONFIG['host']}:{db.DB_CONFIG['port']}/{db.DB_CONFIG['database']}")
    print()

    ok, msg = db.test_connection()
    if ok:
        print(f"  ✅ DB: {msg}")
    else:
        print(f"  ⚠️  DB: {msg}")
        print(f"  → ضع بيانات الاتصال في .env (انظر .env.example)")
    print("=" * 62)
    print()

    if not no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(f"http://{host}:{port}")).start()

    # Start scheduler background thread
    try:
        start_scheduler()
        print("  ✅ Scheduler thread started")
    except Exception as e:
        print(f"  ⚠️  Scheduler failed to start: {e}")

    app.run(host=host, port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
