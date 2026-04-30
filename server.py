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
import hashlib
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
from scrapers.rss_source import RSSSource


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
# المنصة الآن مقتصرة على مصدرين فقط:
#  - apify: لصفحات فيسبوك (يحتاج token)
#  - rss:   لأي رابط RSS/Atom (مجاني)
# Auto-routing: عند سحب صفحة، نختار المصدر حسب URL الصفحة.
SOURCE_REGISTRY = {
    "apify": ApifySource,
    "rss":   RSSSource,
}

SOURCE_META = {
    "apify": {
        "icon": "💎", "label": "Apify",
        "description": "لصفحات فيسبوك - تفاعلات وتعليقات دقيقة",
        "price": "$5/1000 منشور (5$ مجاني)",
        "needs_token": True,
        "token_label": "Apify API Token",
        "token_help": "من apify.com → Settings → Integrations → Personal API token",
        "signup_url": "https://apify.com/sign-up",
        "token_url": "https://console.apify.com/account/integrations",
    },
    "rss": {
        "icon": "📡", "label": "RSS",
        "description": "أي رابط RSS أو Atom - مجاني تماماً",
        "price": "مجاني",
        "needs_token": False,
        "token_label": "لا يحتاج توكن - فقط ضع رابط الـ RSS كـ URL للصفحة",
        "token_help": "إذا كانت الصفحة فيها رابط RSS feed، ضعه في حقل 'رابط الصفحة' وسنقرأ منه مباشرة.",
        "signup_url": "",
        "token_url": "",
    },
}


def _detect_source_for_url(url: str) -> str:
    """
    Auto-routing: يحدد المصدر المناسب بناءً على رابط الصفحة.
      - facebook.com / fb.com → apify
      - أي شيء آخر → rss
    """
    if not url:
        return "apify"
    u = url.lower().strip()
    if "facebook.com" in u or "fb.com" in u:
        return "apify"
    return "rss"


def _resolve_max_posts(page_value, date_from=None, date_to=None) -> int:
    """
    يحدد max_posts للسحب بناءً على إعدادات الصفحة:
      - إذا max_posts على الصفحة محدد (>=1) → يستخدمه (الأولوية للصفحة)
      - إذا فارغ/0/None → يستخدم كاب عالي (1000) عشان date_from/date_to
        تتحكم بالنطاق. عملياً المصدر يرجع الأحدث ضمن التاريخ.
    """
    try:
        n = int(page_value) if page_value not in (None, "", 0, "0") else 0
    except (TypeError, ValueError):
        n = 0
    if n >= 1:
        return min(n, 1000)
    return 1000   # cap عالي - الفلترة بالتاريخ


def _build_user_sources(user_id: int) -> dict:
    """
    يبني dict { source_name: instance } للمصادر المفعّلة لهذا المستخدم.
    """
    user_sources = db.list_sources(user_id)
    out: dict = {}
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
        # الـ token (apify only)
        secrets_ = db.get_source_with_token(user_id, s["source_name"])
        tok = (secrets_ or {}).get("token", "")
        if s["source_name"] == "apify":
            full_conf["token"] = tok
        out[s["source_name"]] = cls(full_conf)
    return out


# Job tracking (in-memory for real-time progress; DB for persistent history)
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()

# Scheduler state
SCHEDULER_STATE = {"running": False, "thread": None}

# ----------------------------------------------------------------------
# Concurrency control
# ----------------------------------------------------------------------
# 1. USER_RUN_LOCKS: قفل واحد لكل مستخدم — لا أكثر من scrape واحد متزامن
#    لنفس المستخدم. يمنع تكرار البيانات من schedule + manual scrape بنفس
#    الوقت أو 2 schedules لنفس المستخدم.
# 2. APIFY_TOKEN_LOCKS: قفل واحد لكل Apify token — لو عدة حسابات تستخدم
#    نفس الـ token (مشاركة)، نضمن جلسة واحدة على Apify بنفس الوقت لتجنّب
#    rate-limit الـ token + تداخل الـ runs.
# الـ acquire يستخدم timeout صغير وما يبلوك إلى الأبد — لو ما لقى الـ
# lock فاضي، نرفض الـ job مع رسالة واضحة.

USER_RUN_LOCKS: dict[int, threading.Lock] = {}
USER_RUN_LOCKS_GUARD = threading.Lock()

APIFY_TOKEN_LOCKS: dict[str, threading.Lock] = {}
APIFY_TOKEN_LOCKS_GUARD = threading.Lock()


def _get_user_lock(user_id: int) -> threading.Lock:
    with USER_RUN_LOCKS_GUARD:
        lock = USER_RUN_LOCKS.get(user_id)
        if lock is None:
            lock = threading.Lock()
            USER_RUN_LOCKS[user_id] = lock
        return lock


def _get_apify_token_lock(token: str) -> threading.Lock:
    """قفل لكل Apify token (لمنع تداخل الـ runs على نفس الـ token المشترك)"""
    if not token:
        return threading.Lock()  # nop lock
    # نستخدم hash للـ token عشان ما يظهر في memory في clear text
    key = hashlib.sha1(token.encode("utf-8")).hexdigest()[:16] if token else ""
    with APIFY_TOKEN_LOCKS_GUARD:
        lock = APIFY_TOKEN_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            APIFY_TOKEN_LOCKS[key] = lock
        return lock


def _user_has_active_run(user_id: int) -> bool:
    """هل في job قيد التشغيل لهذا المستخدم؟"""
    with JOBS_LOCK:
        for j in JOBS.values():
            if (j.get("user_id") == user_id and
                j.get("status") in ("queued", "running")):
                return True
    return False


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
    # delete_missing default = False — لا نحذف صفحات تلقائياً.
    # المستخدم يحذف بشكل صريح عبر DELETE /api/pages/<slug>
    delete_missing = bool(data.get("delete_missing", False))
    db.upsert_pages(current_user.id, data["pages"], delete_missing=delete_missing)
    return jsonify({"ok": True, "count": len(data["pages"])})


@app.route("/api/pages/<slug>", methods=["DELETE"])
@login_required
def api_pages_delete(slug):
    """
    يحذف صفحة. إذا أُرسل ?with_posts=1 يحذف منشوراتها أيضاً.
    """
    with_posts = request.args.get("with_posts") in ("1", "true", "yes")
    posts_n = 0
    if with_posts:
        posts_n = db.delete_posts_by_page(current_user.id, slug)
    pages_n = db.delete_page(current_user.id, slug)
    return jsonify({
        "ok": bool(pages_n),
        "deleted_page": pages_n,
        "deleted_posts": posts_n,
    })


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


@app.route("/api/posts/<int:post_id>/raw", methods=["GET"])
@login_required
def api_post_raw(post_id):
    """يرجع raw_json لمنشور - للاستخدام في debug (إظهار ما سحبه المصدر فعلياً)"""
    with db.db_cursor() as cur:
        cur.execute(
            "SELECT raw_json FROM posts WHERE id=%s AND user_id=%s",
            (post_id, current_user.id)
        )
        row = cur.fetchone()
    if not row:
        return jsonify({"error": "المنشور غير موجود"}), 404
    raw = row.get("raw_json") if isinstance(row, dict) else row[0]
    try:
        parsed = json.loads(raw) if raw else {}
    except Exception:
        parsed = {"_raw_text": raw or ""}
    return jsonify(parsed)


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

    # نقبل: slug (واحدة) أو slugs (قائمة) أو "all" / فارغ → كل الصفحات
    slugs_in = data.get("slugs")
    if isinstance(slugs_in, list):
        slugs = [str(s).strip() for s in slugs_in if str(s).strip()]
    elif data.get("slug"):
        slugs = [str(data["slug"]).strip()]
    else:
        slugs = []   # empty = all pages

    params = {
        "slug": data.get("slug"),       # legacy single-slug
        "slugs": slugs,                  # new: list (empty = all)
        "source": data.get("source"),
        "date_from": data.get("date_from"),
        "date_to": data.get("date_to"),
        "trigger": "manual",
    }

    # ⚠️ امنع المستخدم من تشغيل أكثر من scrape بنفس الوقت
    if _user_has_active_run(current_user.id):
        return jsonify({
            "error": "لديك عملية سحب قيد التنفيذ بالفعل. انتظر حتى تنتهي قبل بدء أخرى.",
        }), 409

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
        target=_run_scrape_job_locked,
        args=(current_user.id, job_uid, params),
        daemon=True,
    )
    t.start()

    return jsonify({"job_id": job_uid, "status": "queued"})


def _run_scrape_job_locked(user_id: int, job_uid: str, params: dict):
    """
    Wrapper يأخذ user-lock + apify-token-lock قبل الـ scrape الفعلي.
    user-lock: يضمن لا أكثر من scrape واحد متزامن لنفس المستخدم
    apify-token-lock: لو عدة users يستخدمون نفس Apify token (مشاركة)،
                      نضمن جلسة واحدة على Apify بنفس الوقت.
    """
    user_lock = _get_user_lock(user_id)
    if not user_lock.acquire(blocking=False):
        # job ثاني للمستخدم نفسه يحاول يبدأ — نسجّل خطأ ونغادر
        with JOBS_LOCK:
            if job_uid in JOBS:
                JOBS[job_uid]["status"] = "error"
                JOBS[job_uid]["messages"].append({
                    "time": datetime.now(timezone.utc).isoformat(),
                    "level": "error",
                    "text": "⛔ يوجد عملية سحب قيد التنفيذ لنفس المستخدم — تم الإلغاء"
                })
        try:
            db.update_job(job_uid, status="error", finished_at=datetime.now(timezone.utc))
        except Exception:
            pass
        return

    try:
        # احصل على apify token (لو موجود) للقفل المشترك بين المستخدمين
        apify_token = ""
        try:
            apify_secret = db.get_source_with_token(user_id, "apify")
            apify_token = (apify_secret or {}).get("token", "") if apify_secret and apify_secret.get("enabled") else ""
        except Exception:
            apify_token = ""

        if apify_token:
            tok_lock = _get_apify_token_lock(apify_token)
            # نقفل بـ timeout طويل (وقت السحب الكامل) عشان ما نسقط الـ jobs
            with tok_lock:
                _run_scrape_job(user_id, job_uid, params)
        else:
            _run_scrape_job(user_id, job_uid, params)
    finally:
        user_lock.release()


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
        slugs = params.get("slugs") or []
        force_src = params.get("source")
        date_from = params.get("date_from")
        date_to = params.get("date_to")

        # فلترة على slug واحد (legacy) أو قائمة (الجديدة).
        # قائمة فارغة → كل الصفحات.
        if slugs:
            slug_set = set(slugs)
            pages_all = [p for p in pages_all if p["slug"] in slug_set]
        elif slug:
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

        # Build a map: source_name -> source instance (user-scoped)
        # Auto-routing يختار المناسب حسب رابط كل صفحة على حدة.
        source_map = _build_user_sources(user_id)

        if not source_map:
            push_msg("error", "لا يوجد مصدر مفعّل - افتح الإعدادات وفعّل Apify أو RSS")
            update(status="error",
                   finished_at=datetime.now(timezone.utc).isoformat())
            db.update_job(job_uid, status="error",
                          finished_at=datetime.now(timezone.utc))
            return

        push_msg("info", f"🔌 المصادر المفعّلة: {', '.join(source_map.keys())}")

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

            # حدد المصدر المناسب لرابط الصفحة (override بـ force_src أو page.source إن وُجدا)
            chosen = force_src or page.get("source")
            if not chosen or chosen == "auto":
                chosen = _detect_source_for_url(page.get("url", ""))

            src = source_map.get(chosen)
            if not src:
                # fallback: لو المختار غير مفعّل، خذ أي مصدر مفعّل آخر
                fallback_name = next(iter(source_map.keys()), None)
                if not fallback_name:
                    push_msg("error", f"  ⛔ لا يوجد مصدر مفعّل لـ {page['name']}")
                    continue
                push_msg("warn", f"  ⚠️ المصدر '{chosen}' غير مفعّل - استخدام {fallback_name}")
                src = source_map[fallback_name]
                chosen = fallback_name

            # max_posts: لو الصفحة لها رقم محدد نستخدمه، وإلا (فارغ/0/None)
            # نأخذ كاب عالي ونعتمد على التاريخ للتحديد
            page_max = _resolve_max_posts(page.get("max_posts"), page_df, page_dt)
            mode_hint = "بالتاريخ" if not page.get("max_posts") else f"حد {page_max}"
            push_msg("info", f"  ⏳ {chosen} ← {page.get('url', '')[:60]} ({mode_hint})…")
            try:
                posts_result = loop.run_until_complete(
                    src.scrape_page(
                        page["url"], page["slug"], page["name"],
                        page_max,
                        date_from=page_df, date_to=page_dt,
                    )
                )
                if posts_result:
                    posts_dicts = [p.to_dict() for p in posts_result]
                    new_n = db.insert_posts(user_id, page["slug"], posts_dicts)
                    push_msg("success",
                             f"  ✅ {chosen}: {len(posts_result)} سُحب ({new_n} جديد)")
                    total_new += new_n
                    success_count += 1
                    sources_used.add(chosen)
                else:
                    push_msg("warn", f"  ⚠️  {chosen}: لم يرجع منشورات")
            except Exception as e:
                push_msg("error", f"  ❌ {chosen}: {str(e)[:120]}")

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


@app.route("/api/history", methods=["DELETE"])
@login_required
def api_history_clear():
    """يمسح كل سجل العمليات للمستخدم الحالي"""
    n = db.delete_jobs_all(current_user.id)
    return jsonify({"ok": True, "deleted": n})


@app.route("/api/history/<job_uid>", methods=["DELETE"])
@login_required
def api_history_delete_one(job_uid):
    """يمسح سطر واحد من السجل (job_uid)"""
    n = db.delete_job(current_user.id, job_uid)
    return jsonify({"ok": bool(n), "deleted": n})


# ======================================================================
#  Keywords API
# ======================================================================

@app.route("/api/keywords", methods=["GET"])
@login_required
def api_keywords_list():
    return jsonify({"keywords": db.list_keywords(current_user.id)})


@app.route("/api/keywords", methods=["POST"])
@login_required
def api_keywords_create():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "نص الكلمة المفتاحية مطلوب"}), 400
    try:
        kid = db.create_keyword(
            current_user.id,
            text=text,
            mode=data.get("match_mode", "contains"),
            color=data.get("color", ""),
            notes=data.get("notes", ""),
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"ok": True, "id": kid})


@app.route("/api/keywords/<int:kid>", methods=["PATCH"])
@login_required
def api_keywords_update(kid):
    data = request.get_json(silent=True) or {}
    ok = db.update_keyword(current_user.id, kid, **data)
    return jsonify({"ok": bool(ok)})


@app.route("/api/keywords/<int:kid>", methods=["DELETE"])
@login_required
def api_keywords_delete(kid):
    ok = db.delete_keyword(current_user.id, kid)
    return jsonify({"ok": bool(ok)})


@app.route("/api/keywords/<int:kid>/posts", methods=["GET"])
@login_required
def api_keyword_posts(kid):
    return jsonify({"posts": db.keyword_posts(current_user.id, kid)})


@app.route("/api/keywords/<int:kid>/stats", methods=["GET"])
@login_required
def api_keyword_stats(kid):
    return jsonify(db.keyword_stats(current_user.id, kid))


# ======================================================================
#  API: Test single URL
# ======================================================================

@app.route("/api/test-page", methods=["POST"])
@login_required
def api_test_page():
    data = request.get_json(force=True)
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "URL مطلوب"}), 400

    # Auto-route حسب الـ URL لو ما حدد المستخدم مصدر
    source_name = data.get("source") or "auto"
    if source_name == "auto":
        source_name = _detect_source_for_url(url)

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

    # Skip if user already has a running scrape (prevents data races
    # when manual + scheduled jobs would otherwise fire concurrently
    # for the same user, or two schedules for the same user)
    if _user_has_active_run(user_id):
        with JOBS_LOCK:
            if job_uid in JOBS:
                JOBS[job_uid]["status"] = "error"
                JOBS[job_uid]["messages"].append({
                    "time": datetime.now(timezone.utc).isoformat(),
                    "level": "warn",
                    "text": "⏸ توجد عملية أخرى قيد التشغيل - تم تأجيل هذا الجدول"
                })
        try:
            db.update_job(job_uid, status="error", finished_at=datetime.now(timezone.utc))
        except Exception:
            pass
        # don't mark_schedule_ran — سيُعاد المحاولة بعد 30 ثانية
        return

    t = threading.Thread(
        target=_run_scheduled_scrape_locked,
        args=(user_id, job_uid, params),
        daemon=True,
    )
    t.start()
    db.mark_schedule_ran(sched["id"])


def _run_scheduled_scrape_locked(user_id: int, job_uid: str, params: dict):
    """نفس wrapper الـ locked على المستخدم + Apify token المشترك"""
    user_lock = _get_user_lock(user_id)
    if not user_lock.acquire(blocking=False):
        with JOBS_LOCK:
            if job_uid in JOBS:
                JOBS[job_uid]["status"] = "error"
                JOBS[job_uid]["messages"].append({
                    "time": datetime.now(timezone.utc).isoformat(),
                    "level": "warn",
                    "text": "⛔ تم الإلغاء — يوجد scrape آخر قيد التشغيل لنفس المستخدم"
                })
        try:
            db.update_job(job_uid, status="error", finished_at=datetime.now(timezone.utc))
        except Exception:
            pass
        return
    try:
        apify_token = ""
        try:
            apify_secret = db.get_source_with_token(user_id, "apify")
            apify_token = (apify_secret or {}).get("token", "") if apify_secret and apify_secret.get("enabled") else ""
        except Exception:
            apify_token = ""

        if apify_token:
            tok_lock = _get_apify_token_lock(apify_token)
            with tok_lock:
                _run_scheduled_scrape(user_id, job_uid, params)
        else:
            _run_scheduled_scrape(user_id, job_uid, params)
    finally:
        user_lock.release()


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

        # Auto-routing per page (نفس منطق _run_scrape_job)
        source_map = _build_user_sources(user_id)
        if not source_map:
            push_msg("error", "لا يوجد مصدر مفعّل. افتح الإعدادات وفعّل Apify أو RSS.")
            update(status="error",
                   finished_at=datetime.now(timezone.utc).isoformat())
            db.update_job(job_uid, status="error",
                          finished_at=datetime.now(timezone.utc))
            return

        push_msg("info", f"🔌 المصادر المفعّلة: {', '.join(source_map.keys())}")

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        total_new = 0
        success_count = 0
        sources_used: set = set()
        started = datetime.now(timezone.utc)
        date_from = params.get("date_from")
        date_to = params.get("date_to")
        force_src = params.get("source")

        for idx, page in enumerate(pages_all):
            update(progress=idx, current_page=page.get("name", ""))
            push_msg("info", f"📌 [{idx + 1}/{len(pages_all)}] {page.get('name', '')}")

            chosen = force_src or page.get("source")
            if not chosen or chosen == "auto":
                chosen = _detect_source_for_url(page.get("url", ""))

            src = source_map.get(chosen)
            if not src:
                fallback_name = next(iter(source_map.keys()), None)
                if not fallback_name:
                    push_msg("error", f"  ⛔ لا يوجد مصدر مفعّل لـ {page['name']}")
                    continue
                push_msg("warn", f"  ⚠️ المصدر '{chosen}' غير مفعّل - استخدام {fallback_name}")
                src = source_map[fallback_name]
                chosen = fallback_name

            page_max = _resolve_max_posts(page.get("max_posts"), date_from, date_to)
            mode_hint = "بالتاريخ" if not page.get("max_posts") else f"حد {page_max}"
            push_msg("info", f"  ⏳ {chosen} ← {page.get('url', '')[:60]} ({mode_hint})…")
            try:
                posts_result = loop.run_until_complete(
                    src.scrape_page(
                        page["url"], page["slug"], page["name"],
                        page_max,
                        date_from=date_from, date_to=date_to,
                    )
                )
                if posts_result:
                    posts_dicts = [p.to_dict() for p in posts_result]
                    new_n = db.insert_posts(user_id, page["slug"], posts_dicts)
                    push_msg("success",
                             f"  ✅ {chosen}: {len(posts_result)} سُحب ({new_n} جديد)")
                    total_new += new_n
                    success_count += 1
                    sources_used.add(chosen)
                else:
                    push_msg("warn", f"  ⚠️  {chosen}: لم يرجع منشورات")
            except Exception as e:
                push_msg("error", f"  ❌ {chosen}: {str(e)[:120]}")

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
    from datetime import datetime as _dt
    print(f"[scheduler] loop started (server local time: {_dt.now().isoformat(timespec='seconds')})")
    iteration = 0
    while SCHEDULER_STATE.get("running"):
        iteration += 1
        try:
            due = db.get_due_schedules()
            # heartbeat كل 5 دقائق (10 iterations × 30s) عشان تعرف إنه شغّال
            if iteration % 10 == 0:
                print(f"[scheduler] heartbeat — local now: {_dt.now().isoformat(timespec='seconds')}, due: {len(due)}")
            for sched in due:
                try:
                    sched_id = sched.get('id')
                    name = sched.get('name', '')
                    next_run = sched.get('next_run')
                    print(f"[scheduler] firing #{sched_id} '{name}' (next_run was: {next_run})")
                    _run_scheduled_job(sched["user_id"], sched)
                    print(f"[scheduler] ✅ fired schedule #{sched_id} '{name}'")
                except Exception as e:
                    import traceback
                    print(f"[scheduler] ❌ error firing schedule {sched.get('id')}: {e}")
                    traceback.print_exc()
        except Exception as e:
            import traceback
            print(f"[scheduler] loop error: {e}")
            traceback.print_exc()
        time.sleep(30)


def start_scheduler():
    if SCHEDULER_STATE.get("running"):
        return
    SCHEDULER_STATE["running"] = True
    t = threading.Thread(target=_scheduler_loop, daemon=True)
    t.start()
    SCHEDULER_STATE["thread"] = t


# Auto-start the scheduler when loaded under a WSGI server (gunicorn / uwsgi /
# passenger / mod_wsgi). When running as `python server.py` main() does this
# explicitly, so we guard with a flag to avoid double-starting.
#
# WARNING: when using gunicorn, pass --workers 1 so only one scheduler runs.
# Scale via --threads instead. Multiple workers = duplicate schedule runs.
if os.environ.get("MARSAD_AUTOSTART_SCHEDULER", "1") != "0":
    try:
        start_scheduler()
    except Exception as _e:
        print(f"[scheduler] auto-start failed: {_e}")


# ======================================================================
#  Static files
# ======================================================================

@app.route("/")
def index():
    return send_from_directory(str(WEB_DIR), "index.html")


@app.route("/healthz")
def healthz():
    """Health check endpoint for reverse proxy / monitoring."""
    ok, msg = db.test_connection()
    return jsonify({
        "ok": bool(ok),
        "db": msg,
        "scheduler": bool(SCHEDULER_STATE.get("running")),
    }), (200 if ok else 503)


# ======================================================================
#  Media proxy — يحلّ مشكلة hotlink-protection على fbcdn و scontent
#  وي خلي الصور/الفيديوهات تظهر داخل المنصة بدل ما المتصفح يطلبها مباشرة.
# ======================================================================
import urllib.request
import urllib.error
from urllib.parse import urlparse

_ALLOWED_MEDIA_HOSTS = (
    "fbcdn.net", "scontent.", "video.", "fb.com", "facebook.com",
    "feedly.com", "feedburner.com", "rss.app", "rsshub.app",
    "fetchrss.com", "scdn.co", "ytimg.com", "youtube.com",
)


@app.route("/api/media-proxy", methods=["GET"])
@login_required
def api_media_proxy():
    """
    Proxy لصور/فيديوهات خارجية (مع تحقق من الـ host لمنع SSRF).
    استخدام:  /api/media-proxy?u=<encoded-url>

    يدعم HTTP Range requests (ضروري لتشغيل الفيديو في <video>).
    يبثّ chunks بدلاً من تحميل الملف كاملاً في الذاكرة.
    """
    raw_url = request.args.get("u", "").strip()
    if not raw_url:
        return jsonify({"error": "u parameter required"}), 400

    try:
        parsed = urlparse(raw_url)
    except Exception:
        return jsonify({"error": "invalid URL"}), 400

    if parsed.scheme not in ("http", "https"):
        return jsonify({"error": "only http/https allowed"}), 400

    host = (parsed.hostname or "").lower()
    if not host:
        return jsonify({"error": "no host"}), 400

    if not any(allowed in host for allowed in _ALLOWED_MEDIA_HOSTS):
        return jsonify({"error": f"host not in allowlist: {host}"}), 403

    if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
        return jsonify({"error": "local hosts blocked"}), 403

    # نمرّر Range request من العميل عشان الفيديو يقدر يبدأ التشغيل
    # ويعمل seeking. الـ <video> يطلب أول chunk صغير قبل أي شيء.
    upstream_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Accept": "image/*,video/*,*/*",
        "Referer": "https://www.facebook.com/",
        "Accept-Encoding": "identity",   # لا تطلب gzip - يكسر الـ Range
    }
    range_hdr = request.headers.get("Range")
    if range_hdr:
        upstream_headers["Range"] = range_hdr

    try:
        req = urllib.request.Request(raw_url, headers=upstream_headers)
        resp = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as e:
        return jsonify({"error": f"upstream {e.code}"}), e.code
    except Exception as e:
        return jsonify({"error": str(e)[:200]}), 502

    # بناء headers رد العميل
    upstream_status = resp.status if hasattr(resp, "status") else 200
    upstream_ct = resp.headers.get("Content-Type", "application/octet-stream")
    upstream_cl = resp.headers.get("Content-Length")
    upstream_cr = resp.headers.get("Content-Range")
    upstream_ar = resp.headers.get("Accept-Ranges", "bytes")

    # streaming generator
    def _stream():
        try:
            while True:
                chunk = resp.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            try:
                resp.close()
            except Exception:
                pass

    headers = {
        "Content-Type": upstream_ct,
        "Cache-Control": "public, max-age=3600",
        "Accept-Ranges": upstream_ar,
        "X-Proxied-By": "marsad",
    }
    if upstream_cl:
        headers["Content-Length"] = upstream_cl
    if upstream_cr:
        headers["Content-Range"] = upstream_cr

    return Response(
        stream_with_context(_stream()),
        status=upstream_status,
        headers=headers,
        direct_passthrough=True,
    )


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
