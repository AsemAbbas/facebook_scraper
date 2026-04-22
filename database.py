"""
مَرصَد · Database Layer (MySQL)
===============================
- المستخدمون (users)
- الصفحات (pages) مربوطة بالمستخدم
- المنشورات (posts)
- Jobs السحب
- إعدادات المصادر per-user (مع tokens مشفّرة)

متوافق مع cPanel + shared hosting.
MySQL / MariaDB فقط (أي cPanel بيقدم MySQL).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

try:
    import pymysql
    from pymysql.cursors import DictCursor
    HAS_PYMYSQL = True
except ImportError:
    HAS_PYMYSQL = False

# Encryption للـ tokens (symmetric)
try:
    from cryptography.fernet import Fernet
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False


PROJECT_ROOT = Path(__file__).resolve().parent
DATA_DIR = PROJECT_ROOT / "database"
DATA_DIR.mkdir(exist_ok=True)
SECRET_FILE = DATA_DIR / ".secret"


# ======================================================================
#  Config (from environment / .env / config file)
# ======================================================================

def _load_env_file():
    """قراءة .env في مجلد المشروع (إن وجد)"""
    env_file = PROJECT_ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


_load_env_file()


DB_CONFIG = {
    "host": os.environ.get("MARSAD_DB_HOST", "localhost"),
    "port": int(os.environ.get("MARSAD_DB_PORT", "3306")),
    "user": os.environ.get("MARSAD_DB_USER", "root"),
    "password": os.environ.get("MARSAD_DB_PASSWORD", ""),
    "database": os.environ.get("MARSAD_DB_NAME", "marsad"),
    "charset": "utf8mb4",
    "cursorclass": DictCursor if HAS_PYMYSQL else None,
    "autocommit": False,
}


# ======================================================================
#  Encryption key (for storing API tokens)
# ======================================================================

def _get_or_create_secret() -> bytes:
    if SECRET_FILE.exists():
        return SECRET_FILE.read_bytes()
    if HAS_CRYPTO:
        key = Fernet.generate_key()
    else:
        key = base64.urlsafe_b64encode(secrets.token_bytes(32))
    SECRET_FILE.write_bytes(key)
    try:
        os.chmod(SECRET_FILE, 0o600)
    except Exception:
        pass
    return key


def encrypt_token(token: str) -> str:
    if not token:
        return ""
    if not HAS_CRYPTO:
        return "b64:" + base64.b64encode(token.encode("utf-8")).decode("ascii")
    f = Fernet(_get_or_create_secret())
    return "enc:" + f.encrypt(token.encode("utf-8")).decode("ascii")


def decrypt_token(encrypted: str) -> str:
    if not encrypted:
        return ""
    if encrypted.startswith("b64:"):
        try:
            return base64.b64decode(encrypted[4:]).decode("utf-8")
        except Exception:
            return ""
    if encrypted.startswith("enc:") and HAS_CRYPTO:
        try:
            f = Fernet(_get_or_create_secret())
            return f.decrypt(encrypted[4:].encode("ascii")).decode("utf-8")
        except Exception:
            return ""
    return encrypted  # plain (legacy)


# ======================================================================
#  Connection (pymysql)
# ======================================================================

_local = threading.local()


def _ensure_pymysql():
    if not HAS_PYMYSQL:
        raise RuntimeError(
            "PyMySQL غير مثبت. شغّل: pip install pymysql cryptography"
        )


def get_conn():
    _ensure_pymysql()
    conn = getattr(_local, "conn", None)
    if conn is None or not conn.open:
        conn = pymysql.connect(**DB_CONFIG)
        _local.conn = conn
    return conn


@contextmanager
def db_cursor():
    conn = get_conn()
    cur = conn.cursor()
    try:
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


def test_connection() -> tuple[bool, str]:
    """اختبار سريع للاتصال - يرجع (success, message)"""
    if not HAS_PYMYSQL:
        return False, "PyMySQL غير مثبت"
    try:
        conn = pymysql.connect(**{**DB_CONFIG, "database": None})
        cur = conn.cursor()
        cur.execute(f"SHOW DATABASES LIKE '{DB_CONFIG['database']}'")
        exists = cur.fetchone()
        if not exists:
            conn.close()
            return False, f"قاعدة البيانات '{DB_CONFIG['database']}' غير موجودة"
        conn.close()
        # full connect
        conn = pymysql.connect(**DB_CONFIG)
        conn.close()
        return True, "الاتصال نجح"
    except pymysql.err.OperationalError as e:
        return False, f"فشل الاتصال: {e.args[1] if len(e.args) > 1 else e}"
    except Exception as e:
        return False, f"خطأ: {e}"


# ======================================================================
#  Schema (MySQL / MariaDB)
# ======================================================================

SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        username        VARCHAR(64) NOT NULL UNIQUE,
        email           VARCHAR(191) UNIQUE,
        password_hash   VARCHAR(255) NOT NULL,
        role            VARCHAR(20) DEFAULT 'user',
        display_name    VARCHAR(128),
        created_at      DATETIME NOT NULL,
        last_login      DATETIME NULL,
        is_active       TINYINT(1) DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS pages (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        user_id         INT NOT NULL,
        slug            VARCHAR(64) NOT NULL,
        name            VARCHAR(255) NOT NULL,
        url             TEXT NOT NULL,
        max_posts       INT DEFAULT 20,
        source          VARCHAR(32) DEFAULT 'auto',
        enabled         TINYINT(1) DEFAULT 1,
        date_from       DATE NULL,
        date_to         DATE NULL,
        tags            TEXT,
        created_at      DATETIME NOT NULL,
        UNIQUE KEY uniq_user_slug (user_id, slug),
        CONSTRAINT fk_pages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS posts (
        id              BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id         INT NOT NULL,
        page_slug       VARCHAR(64) NOT NULL,
        post_id         VARCHAR(255) NOT NULL,
        page_name       VARCHAR(255),
        page_url        TEXT,
        text            TEXT,
        post_url        TEXT,
        image_url       TEXT,
        video_url       TEXT,
        published_at    DATETIME NULL,
        scraped_at      DATETIME NOT NULL,
        timestamp_text  VARCHAR(100),
        reactions       INT DEFAULT 0,
        comments        INT DEFAULT 0,
        shares          INT DEFAULT 0,
        source          VARCHAR(32),
        post_type       VARCHAR(32),
        raw_json        LONGTEXT,
        UNIQUE KEY uniq_user_page_post (user_id, page_slug, post_id(190)),
        KEY idx_user_page (user_id, page_slug),
        KEY idx_published (published_at),
        KEY idx_scraped (scraped_at),
        CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS jobs (
        id              BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id         INT NOT NULL,
        job_uid         VARCHAR(64) NOT NULL UNIQUE,
        status          VARCHAR(20) NOT NULL,
        started_at      DATETIME NOT NULL,
        finished_at     DATETIME NULL,
        duration_seconds INT DEFAULT 0,
        trigger_source  VARCHAR(20) DEFAULT 'manual',
        sources_used    TEXT,
        pages_total     INT DEFAULT 0,
        pages_success   INT DEFAULT 0,
        pages_failed    INT DEFAULT 0,
        new_posts       INT DEFAULT 0,
        params_json     TEXT,
        messages_json   LONGTEXT,
        KEY idx_user_started (user_id, started_at),
        CONSTRAINT fk_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS source_settings (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        user_id         INT NOT NULL,
        source_name     VARCHAR(32) NOT NULL,
        enabled         TINYINT(1) DEFAULT 0,
        priority        INT DEFAULT 99,
        token_encrypted TEXT,
        config_json     TEXT,
        updated_at      DATETIME NOT NULL,
        UNIQUE KEY uniq_user_src (user_id, source_name),
        CONSTRAINT fk_src_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS user_prefs (
        user_id         INT PRIMARY KEY,
        prefs_json      LONGTEXT,
        updated_at      DATETIME NOT NULL,
        CONSTRAINT fk_prefs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS schedules (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        user_id         INT NOT NULL,
        name            VARCHAR(128) NOT NULL,
        enabled         TINYINT(1) DEFAULT 1,
        pages_json      TEXT,
        source          VARCHAR(32) DEFAULT 'auto',
        interval_minutes INT NOT NULL,
        date_range_preset VARCHAR(20) DEFAULT 'last_24h',
        custom_hours_back INT DEFAULT 24,
        last_run        DATETIME NULL,
        next_run        DATETIME NULL,
        total_runs      INT DEFAULT 0,
        created_at      DATETIME NOT NULL,
        updated_at      DATETIME NOT NULL,
        KEY idx_user_enabled (user_id, enabled),
        KEY idx_next_run (next_run),
        CONSTRAINT fk_sched_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
]


DEFAULT_SOURCES = [
    {
        "source_name": "playwright",
        "enabled": 1,
        "priority": 5,
        "config": {
            "headless": True,
            "scroll_pause_seconds": 2.5,
            "use_mbasic": False,
        },
    },
    {
        "source_name": "apify",
        "enabled": 0,
        "priority": 1,
        "config": {
            # 🔒 Actor مقفول في الكود - أي قيمة هنا تُتجاهل
            # انظر scrapers/apify_source.py → LOCKED_ACTOR_ID
            "actor_id": "curious_coder/facebook-post-scraper",
            "include_comments": True,
            "max_comments_per_post": 10,
            "include_reactions_breakdown": True,
        },
    },
    {
        "source_name": "fetchrss",
        "enabled": 0,
        "priority": 2,
        "config": {},
    },
    {
        "source_name": "rssapp",
        "enabled": 0,
        "priority": 3,
        "config": {},
    },
    {
        "source_name": "rsshub",
        "enabled": 0,
        "priority": 4,
        "config": {
            "base_url": "https://rsshub.app",
        },
    },
]


def init_db() -> None:
    """إنشاء الجداول + migrations on-boot"""
    _ensure_pymysql()
    with db_cursor() as cur:
        for stmt in SCHEMA_STATEMENTS:
            cur.execute(stmt)

    # Migration: force apify actor to the locked one (curious_coder/facebook-post-scraper)
    # هذا يُطبَّق على أي row قديم كان فيه actor_id مختلف
    try:
        _force_apify_actor_lock()
    except Exception as e:
        print(f"[db] apify actor lock migration skipped: {e}")


def _force_apify_actor_lock() -> None:
    """
    يضمن أن كل users لديهم config_json فيه
    actor_id = 'curious_coder/facebook-post-scraper'.
    """
    LOCKED = "curious_coder/facebook-post-scraper"
    with db_cursor() as cur:
        cur.execute("SELECT user_id, config_json FROM source_settings WHERE source_name='apify'")
        rows = cur.fetchall() or []
        changed = 0
        for r in rows:
            uid = r["user_id"] if isinstance(r, dict) else r[0]
            raw = (r["config_json"] if isinstance(r, dict) else r[1]) or "{}"
            try:
                cfg = json.loads(raw)
            except Exception:
                cfg = {}
            if cfg.get("actor_id") != LOCKED:
                cfg["actor_id"] = LOCKED
                cur.execute(
                    "UPDATE source_settings SET config_json=%s WHERE user_id=%s AND source_name='apify'",
                    (json.dumps(cfg, ensure_ascii=False), uid)
                )
                changed += 1
        if changed:
            print(f"[db] forced apify actor_id='{LOCKED}' on {changed} row(s)")


# ======================================================================
#  User operations
# ======================================================================

def hash_password(password: str) -> str:
    """PBKDF2-SHA256 (من stdlib - يعمل على أي cPanel)"""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return f"pbkdf2:100000:{base64.b64encode(salt).decode()}:{base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        parts = stored.split(":")
        if len(parts) != 4 or parts[0] != "pbkdf2":
            return False
        iters = int(parts[1])
        salt = base64.b64decode(parts[2])
        expected = base64.b64decode(parts[3])
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
        return secrets.compare_digest(dk, expected)
    except Exception:
        return False


def create_user(
    username: str,
    password: str,
    email: Optional[str] = None,
    display_name: Optional[str] = None,
    role: str = "user",
) -> int:
    """ينشئ مستخدم جديد + seed sources الافتراضية"""
    now = datetime.now(timezone.utc)
    with db_cursor() as cur:
        cur.execute("""
            INSERT INTO users (username, email, password_hash, role, display_name, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (username.strip(), (email or "").strip() or None,
              hash_password(password), role,
              display_name or username, now))
        user_id = cur.lastrowid

        # Seed default sources
        for src in DEFAULT_SOURCES:
            cur.execute("""
                INSERT INTO source_settings
                (user_id, source_name, enabled, priority, token_encrypted, config_json, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (user_id, src["source_name"], src["enabled"], src["priority"],
                  "", json.dumps(src["config"], ensure_ascii=False), now))

    return user_id


def get_user_by_id(user_id: int) -> Optional[dict]:
    with db_cursor() as cur:
        cur.execute("SELECT * FROM users WHERE id=%s", (user_id,))
        return cur.fetchone()


def get_user_by_username(username: str) -> Optional[dict]:
    with db_cursor() as cur:
        cur.execute("SELECT * FROM users WHERE username=%s", (username.strip(),))
        return cur.fetchone()


def update_last_login(user_id: int) -> None:
    with db_cursor() as cur:
        cur.execute("UPDATE users SET last_login=%s WHERE id=%s",
                    (datetime.now(timezone.utc), user_id))


def user_count() -> int:
    with db_cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM users WHERE is_active=1")
        return cur.fetchone()["c"]


def list_users(limit: int = 100) -> list[dict]:
    with db_cursor() as cur:
        cur.execute("""
            SELECT id, username, email, role, display_name,
                   created_at, last_login, is_active
            FROM users ORDER BY created_at DESC LIMIT %s
        """, (limit,))
        return list(cur.fetchall())


def update_user(user_id: int, **kwargs) -> None:
    allowed = {"email", "display_name", "role", "is_active"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return
    cols = ", ".join(f"{k}=%s" for k in fields)
    with db_cursor() as cur:
        cur.execute(f"UPDATE users SET {cols} WHERE id=%s",
                    (*fields.values(), user_id))


def change_password(user_id: int, new_password: str) -> None:
    with db_cursor() as cur:
        cur.execute("UPDATE users SET password_hash=%s WHERE id=%s",
                    (hash_password(new_password), user_id))


def delete_user(user_id: int) -> None:
    with db_cursor() as cur:
        cur.execute("DELETE FROM users WHERE id=%s", (user_id,))


# ======================================================================
#  Pages operations
# ======================================================================

def list_pages(user_id: int, only_enabled: bool = False) -> list[dict]:
    with db_cursor() as cur:
        sql = "SELECT * FROM pages WHERE user_id=%s"
        if only_enabled:
            sql += " AND enabled=1"
        sql += " ORDER BY created_at DESC"
        cur.execute(sql, (user_id,))
        result = []
        for r in cur.fetchall():
            d = dict(r)
            d["enabled"] = bool(d["enabled"])
            d["tags"] = json.loads(d["tags"]) if d.get("tags") else []
            # Convert dates to strings
            for k in ("date_from", "date_to", "created_at"):
                if d.get(k):
                    d[k] = d[k].isoformat() if hasattr(d[k], "isoformat") else str(d[k])
            result.append(d)
        return result


def get_page(user_id: int, slug: str) -> Optional[dict]:
    with db_cursor() as cur:
        cur.execute("SELECT * FROM pages WHERE user_id=%s AND slug=%s", (user_id, slug))
        r = cur.fetchone()
        if not r:
            return None
        r["enabled"] = bool(r["enabled"])
        r["tags"] = json.loads(r["tags"]) if r.get("tags") else []
        return r


def upsert_pages(user_id: int, pages: list[dict]) -> None:
    """استبدال كل صفحات المستخدم بالقائمة الجديدة"""
    now = datetime.now(timezone.utc)
    with db_cursor() as cur:
        incoming_slugs = [p.get("slug") for p in pages if p.get("slug")]
        if incoming_slugs:
            placeholders = ",".join(["%s"] * len(incoming_slugs))
            cur.execute(
                f"DELETE FROM pages WHERE user_id=%s AND slug NOT IN ({placeholders})",
                (user_id, *incoming_slugs)
            )
        else:
            cur.execute("DELETE FROM pages WHERE user_id=%s", (user_id,))

        for p in pages:
            tags = json.dumps(p.get("tags") or [])
            cur.execute("""
                INSERT INTO pages
                (user_id, slug, name, url, max_posts, source, enabled, date_from, date_to, tags, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    name=VALUES(name),
                    url=VALUES(url),
                    max_posts=VALUES(max_posts),
                    source=VALUES(source),
                    enabled=VALUES(enabled),
                    date_from=VALUES(date_from),
                    date_to=VALUES(date_to),
                    tags=VALUES(tags)
            """, (user_id, p["slug"], p.get("name", ""), p.get("url", ""),
                  int(p.get("max_posts", 20)), p.get("source", "auto"),
                  1 if p.get("enabled", True) else 0,
                  p.get("date_from") or None, p.get("date_to") or None,
                  tags, now))


def delete_page(user_id: int, slug: str) -> int:
    with db_cursor() as cur:
        cur.execute("DELETE FROM pages WHERE user_id=%s AND slug=%s", (user_id, slug))
        return cur.rowcount


# ======================================================================
#  Posts operations
# ======================================================================

def _parse_dt(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return None
    return None


def _canonical_post_url(url: str) -> str:
    """
    تطبيع رابط المنشور لغرض كشف التكرار:
    - يحذف query params (خاصة __cft__ و __tn__ الي بتتغير كل مرة)
    - يوحّد المجال (www.facebook.com → facebook.com)
    - يزيل trailing slashes
    """
    if not url:
        return ""
    u = str(url).strip()
    if "?" in u:
        u = u.split("?", 1)[0]
    if "#" in u:
        u = u.split("#", 1)[0]
    u = u.replace("://www.facebook.com", "://facebook.com")
    u = u.replace("://m.facebook.com", "://facebook.com")
    u = u.replace("://mbasic.facebook.com", "://facebook.com")
    u = u.rstrip("/")
    return u.lower()


def _content_fingerprint(page_slug: str, text: str, post_url: str) -> str:
    """
    بصمة محتوى المنشور لكشف التكرار عبر مصادر مختلفة.
    نستخدم canonical URL إن وُجد، وإلا hash النص + page_slug.
    """
    canon_url = _canonical_post_url(post_url)
    if canon_url:
        return "u:" + hashlib.sha1(canon_url.encode("utf-8")).hexdigest()[:32]
    norm_text = (text or "").strip()[:300]
    if norm_text:
        key = f"{page_slug}:{norm_text}"
        return "t:" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:32]
    return ""


def insert_posts(user_id: int, page_slug: str, posts: list[dict]) -> int:
    """
    يرجع عدد المنشورات الجديدة.
    يمنع التكرار على 3 مستويات:
      1. UNIQUE KEY على (user_id, page_slug, post_id) - دفاع أولي في DB
      2. تطبيع post_url (إزالة query params المتغيّرة) وفحص مسبق
      3. content fingerprint (URL مُطبَّع أو hash النص) - يكشف لما نفس
         المنشور يجي من مصادر مختلفة بـ post_id مختلف
    """
    if not posts:
        return 0
    new_count = 0
    skipped_dup = 0

    with db_cursor() as cur:
        # جمع كل الـ fingerprints الموجودة للصفحة دفعة وحدة (أسرع من فحص واحد واحد)
        cur.execute("""
            SELECT post_id, post_url, text
            FROM posts
            WHERE user_id = %s AND page_slug = %s
        """, (user_id, page_slug))
        existing_rows = cur.fetchall() or []
        existing_post_ids: set[str] = set()
        existing_fingerprints: set[str] = set()
        for r in existing_rows:
            pid = r.get("post_id") if isinstance(r, dict) else r[0]
            purl = r.get("post_url") if isinstance(r, dict) else r[1]
            ptxt = r.get("text") if isinstance(r, dict) else r[2]
            if pid:
                existing_post_ids.add(str(pid))
            fp = _content_fingerprint(page_slug, ptxt or "", purl or "")
            if fp:
                existing_fingerprints.add(fp)

        # معرّفات الجلسة الحالية لمنع التكرار داخل نفس الـ batch
        seen_ids_batch: set[str] = set()
        seen_fps_batch: set[str] = set()

        for p in posts:
            pid = (p.get("post_id") or "")[:200]
            purl = p.get("post_url") or ""
            ptxt = p.get("text") or ""

            # 1. تكرار بالـ post_id (موجود في DB أو في نفس الـ batch)
            if pid and (pid in existing_post_ids or pid in seen_ids_batch):
                skipped_dup += 1
                continue

            # 2. تكرار بالـ fingerprint
            fp = _content_fingerprint(page_slug, ptxt, purl)
            if fp and (fp in existing_fingerprints or fp in seen_fps_batch):
                skipped_dup += 1
                continue

            # 3. لا بصمة ولا معرّف → منشور فارغ، نتجاهله
            if not pid and not fp:
                skipped_dup += 1
                continue

            try:
                cur.execute("""
                    INSERT IGNORE INTO posts
                    (user_id, page_slug, post_id, page_name, page_url, text,
                     post_url, image_url, video_url, published_at, scraped_at,
                     timestamp_text, reactions, comments, shares, source, post_type, raw_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    user_id, page_slug, pid,
                    p.get("page_name", ""), p.get("page_url", ""),
                    ptxt, purl,
                    p.get("image_url", ""), p.get("video_url", ""),
                    _parse_dt(p.get("published_at")),
                    _parse_dt(p.get("scraped_at")) or datetime.now(timezone.utc),
                    p.get("timestamp_text", ""),
                    int(p.get("reactions", 0) or 0),
                    int(p.get("comments", 0) or 0),
                    int(p.get("shares", 0) or 0),
                    p.get("source", ""), p.get("post_type", "text"),
                    json.dumps(p, ensure_ascii=False),
                ))
                if cur.rowcount > 0:
                    new_count += 1
                    if pid:
                        seen_ids_batch.add(pid)
                        existing_post_ids.add(pid)
                    if fp:
                        seen_fps_batch.add(fp)
                        existing_fingerprints.add(fp)
            except Exception:
                continue
    return new_count


def list_posts(
    user_id: int,
    page_slug: Optional[str] = None,
    source: Optional[str] = None,
    min_reactions: int = 0,
    min_comments: int = 0,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
    order_by: str = "newest",
) -> list[dict]:
    sql = "SELECT * FROM posts WHERE user_id=%s"
    args: list = [user_id]
    if page_slug:
        sql += " AND page_slug=%s"
        args.append(page_slug)
    if source:
        sql += " AND source=%s"
        args.append(source)
    if min_reactions > 0:
        sql += " AND reactions >= %s"
        args.append(min_reactions)
    if min_comments > 0:
        sql += " AND comments >= %s"
        args.append(min_comments)
    if date_from:
        sql += " AND COALESCE(published_at, scraped_at) >= %s"
        args.append(date_from)
    if date_to:
        sql += " AND COALESCE(published_at, scraped_at) <= %s"
        args.append(date_to)
    if search:
        sql += " AND text LIKE %s"
        args.append(f"%{search}%")

    order_map = {
        "newest": "COALESCE(published_at, scraped_at) DESC",
        "oldest": "COALESCE(published_at, scraped_at) ASC",
        "reactions": "reactions DESC",
        "comments": "comments DESC",
        "shares": "shares DESC",
    }
    sql += f" ORDER BY {order_map.get(order_by, order_map['newest'])}"
    sql += " LIMIT %s OFFSET %s"
    args.extend([limit, offset])

    with db_cursor() as cur:
        cur.execute(sql, args)
        result = []
        for r in cur.fetchall():
            d = dict(r)
            # inflate rich fields from raw_json
            if d.get("raw_json"):
                try:
                    raw = json.loads(d["raw_json"])
                    for k in ("media", "comments_data", "reactions_breakdown",
                              "hashtags", "mentions", "external_links",
                              "author_name", "author_url", "is_pinned", "is_sponsored"):
                        if k in raw and k not in d:
                            d[k] = raw[k]
                except Exception:
                    pass
            d.pop("raw_json", None)
            # dates to iso strings
            for k in ("published_at", "scraped_at"):
                if d.get(k) and hasattr(d[k], "isoformat"):
                    d[k] = d[k].isoformat()
            result.append(d)
        return result


def count_posts(user_id: int, page_slug: Optional[str] = None) -> int:
    sql = "SELECT COUNT(*) AS c FROM posts WHERE user_id=%s"
    args: list = [user_id]
    if page_slug:
        sql += " AND page_slug=%s"
        args.append(page_slug)
    with db_cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchone()["c"]


def delete_post(user_id: int, post_internal_id: int) -> bool:
    with db_cursor() as cur:
        cur.execute("DELETE FROM posts WHERE user_id=%s AND id=%s",
                    (user_id, post_internal_id))
        return cur.rowcount > 0


def delete_posts_bulk(user_id: int, post_ids: list[int]) -> int:
    if not post_ids:
        return 0
    placeholders = ",".join(["%s"] * len(post_ids))
    with db_cursor() as cur:
        cur.execute(
            f"DELETE FROM posts WHERE user_id=%s AND id IN ({placeholders})",
            (user_id, *post_ids)
        )
        return cur.rowcount


def delete_posts_by_page(user_id: int, page_slug: str) -> int:
    with db_cursor() as cur:
        cur.execute("DELETE FROM posts WHERE user_id=%s AND page_slug=%s",
                    (user_id, page_slug))
        return cur.rowcount


def delete_all_posts(user_id: int) -> int:
    with db_cursor() as cur:
        cur.execute("DELETE FROM posts WHERE user_id=%s", (user_id,))
        return cur.rowcount


def deduplicate_existing_posts(user_id: int) -> dict:
    """
    يمسح المنشورات المكرّرة الموجودة بالفعل في DB.
    يحتفظ بأقدم نسخة (أقل id) ويحذف الباقي.
    يرجع {removed, remaining, by_url, by_text}
    """
    removed = 0
    removed_by_url = 0
    removed_by_text = 0
    with db_cursor() as cur:
        cur.execute("""
            SELECT id, page_slug, post_url, text
            FROM posts
            WHERE user_id=%s
            ORDER BY id ASC
        """, (user_id,))
        rows = cur.fetchall() or []
        seen_fps: dict[str, int] = {}  # fingerprint → first id kept
        to_delete: list[int] = []
        for r in rows:
            rid = r["id"] if isinstance(r, dict) else r[0]
            slug = (r["page_slug"] if isinstance(r, dict) else r[1]) or ""
            purl = (r["post_url"] if isinstance(r, dict) else r[2]) or ""
            ptxt = (r["text"] if isinstance(r, dict) else r[3]) or ""
            fp = _content_fingerprint(slug, ptxt, purl)
            if not fp:
                continue
            if fp in seen_fps:
                to_delete.append(rid)
                if fp.startswith("u:"):
                    removed_by_url += 1
                else:
                    removed_by_text += 1
            else:
                seen_fps[fp] = rid

        # Batch delete in chunks of 500
        BATCH = 500
        for i in range(0, len(to_delete), BATCH):
            chunk = to_delete[i:i + BATCH]
            placeholders = ",".join(["%s"] * len(chunk))
            cur.execute(
                f"DELETE FROM posts WHERE user_id=%s AND id IN ({placeholders})",
                (user_id, *chunk)
            )
            removed += cur.rowcount

        cur.execute("SELECT COUNT(*) AS c FROM posts WHERE user_id=%s", (user_id,))
        remaining_row = cur.fetchone()
        remaining = remaining_row["c"] if isinstance(remaining_row, dict) else remaining_row[0]

    return {
        "removed": removed,
        "remaining": remaining,
        "by_url": removed_by_url,
        "by_text": removed_by_text,
    }


def stats_by_page(user_id: int) -> list[dict]:
    with db_cursor() as cur:
        cur.execute("""
            SELECT page_slug, page_name,
                   COUNT(*) AS total_posts,
                   SUM(reactions) AS total_reactions,
                   SUM(comments) AS total_comments,
                   SUM(shares) AS total_shares,
                   MAX(COALESCE(published_at, scraped_at)) AS last_post
            FROM posts
            WHERE user_id=%s
            GROUP BY page_slug, page_name
            ORDER BY total_reactions DESC
        """, (user_id,))
        result = []
        for r in cur.fetchall():
            d = dict(r)
            if d.get("last_post") and hasattr(d["last_post"], "isoformat"):
                d["last_post"] = d["last_post"].isoformat()
            result.append(d)
        return result


def stats_by_source(user_id: int) -> dict:
    with db_cursor() as cur:
        cur.execute("""
            SELECT source, COUNT(*) AS c FROM posts
            WHERE user_id=%s GROUP BY source
        """, (user_id,))
        return {r["source"] or "unknown": r["c"] for r in cur.fetchall()}


def stats_totals(user_id: int) -> dict:
    with db_cursor() as cur:
        cur.execute("""
            SELECT COUNT(*) AS total_posts,
                   COALESCE(SUM(reactions), 0) AS total_reactions,
                   COALESCE(SUM(comments), 0) AS total_comments,
                   COALESCE(SUM(shares), 0) AS total_shares
            FROM posts WHERE user_id=%s
        """, (user_id,))
        return dict(cur.fetchone())


# ======================================================================
#  Jobs operations
# ======================================================================

def create_job(user_id: int, job_uid: str, params: dict) -> None:
    with db_cursor() as cur:
        cur.execute("""
            INSERT INTO jobs (user_id, job_uid, status, started_at, trigger_source, params_json)
            VALUES (%s, %s, 'queued', %s, %s, %s)
        """, (user_id, job_uid, datetime.now(timezone.utc),
              params.get("trigger", "manual"),
              json.dumps(params, ensure_ascii=False)))


def update_job(job_uid: str, **kwargs) -> None:
    allowed = {"status", "finished_at", "duration_seconds", "sources_used",
               "pages_total", "pages_success", "pages_failed", "new_posts",
               "messages_json"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return
    # Serialize sources_used if list
    if "sources_used" in fields and isinstance(fields["sources_used"], (list, tuple)):
        fields["sources_used"] = json.dumps(list(fields["sources_used"]))
    cols = ", ".join(f"{k}=%s" for k in fields)
    with db_cursor() as cur:
        cur.execute(f"UPDATE jobs SET {cols} WHERE job_uid=%s",
                    (*fields.values(), job_uid))


def get_job_by_uid(job_uid: str) -> Optional[dict]:
    with db_cursor() as cur:
        cur.execute("SELECT * FROM jobs WHERE job_uid=%s", (job_uid,))
        row = cur.fetchone()
        return _inflate_job(row) if row else None


def list_jobs(user_id: int, limit: int = 50) -> list[dict]:
    with db_cursor() as cur:
        cur.execute("""
            SELECT * FROM jobs WHERE user_id=%s
            ORDER BY started_at DESC LIMIT %s
        """, (user_id, limit))
        return [_inflate_job(r) for r in cur.fetchall()]


def _inflate_job(row: dict) -> dict:
    if not row:
        return row
    d = dict(row)
    for k in ("started_at", "finished_at"):
        if d.get(k) and hasattr(d[k], "isoformat"):
            d[k] = d[k].isoformat()
    if d.get("params_json"):
        try:
            d["params"] = json.loads(d["params_json"])
        except Exception:
            d["params"] = {}
    if d.get("sources_used"):
        try:
            d["sources_used"] = json.loads(d["sources_used"])
        except Exception:
            d["sources_used"] = []
    else:
        d["sources_used"] = []
    if d.get("messages_json"):
        try:
            d["messages"] = json.loads(d["messages_json"])
        except Exception:
            d["messages"] = []
    return d


# ======================================================================
#  Source settings operations
# ======================================================================

def list_sources(user_id: int) -> list[dict]:
    """يرجع إعدادات كل المصادر للمستخدم"""
    with db_cursor() as cur:
        cur.execute("""
            SELECT * FROM source_settings
            WHERE user_id=%s ORDER BY priority
        """, (user_id,))
        result = []
        for r in cur.fetchall():
            d = dict(r)
            d["enabled"] = bool(d["enabled"])
            d["has_token"] = bool(d.get("token_encrypted"))
            try:
                d["config"] = json.loads(d.get("config_json") or "{}")
            except Exception:
                d["config"] = {}
            d.pop("token_encrypted", None)
            d.pop("config_json", None)
            if d.get("updated_at") and hasattr(d["updated_at"], "isoformat"):
                d["updated_at"] = d["updated_at"].isoformat()
            result.append(d)
        return result


def get_source_with_token(user_id: int, source_name: str) -> Optional[dict]:
    """للاستخدام الداخلي فقط - يرجع الـ token مفكوك"""
    with db_cursor() as cur:
        cur.execute("""
            SELECT * FROM source_settings WHERE user_id=%s AND source_name=%s
        """, (user_id, source_name))
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        d["enabled"] = bool(d["enabled"])
        d["token"] = decrypt_token(d.get("token_encrypted") or "")
        try:
            d["config"] = json.loads(d.get("config_json") or "{}")
        except Exception:
            d["config"] = {}
        d.pop("token_encrypted", None)
        d.pop("config_json", None)
        return d


def update_source(
    user_id: int,
    source_name: str,
    enabled: Optional[bool] = None,
    priority: Optional[int] = None,
    token: Optional[str] = None,
    config: Optional[dict] = None,
) -> None:
    updates = {"updated_at": datetime.now(timezone.utc)}
    if enabled is not None:
        updates["enabled"] = 1 if enabled else 0
    if priority is not None:
        updates["priority"] = priority
    if token is not None:
        updates["token_encrypted"] = encrypt_token(token) if token else ""
    if config is not None:
        updates["config_json"] = json.dumps(config, ensure_ascii=False)

    cols = ", ".join(f"{k}=%s" for k in updates)
    with db_cursor() as cur:
        cur.execute(f"""
            UPDATE source_settings SET {cols}
            WHERE user_id=%s AND source_name=%s
        """, (*updates.values(), user_id, source_name))


# ======================================================================
#  User preferences
# ======================================================================

def get_prefs(user_id: int) -> dict:
    with db_cursor() as cur:
        cur.execute("SELECT prefs_json FROM user_prefs WHERE user_id=%s", (user_id,))
        row = cur.fetchone()
        if row and row["prefs_json"]:
            try:
                return json.loads(row["prefs_json"])
            except Exception:
                return {}
        return {}


def save_prefs(user_id: int, prefs: dict) -> None:
    now = datetime.now(timezone.utc)
    with db_cursor() as cur:
        cur.execute("""
            INSERT INTO user_prefs (user_id, prefs_json, updated_at)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE
                prefs_json=VALUES(prefs_json),
                updated_at=VALUES(updated_at)
        """, (user_id, json.dumps(prefs, ensure_ascii=False), now))


# ======================================================================
#  Schedules operations
# ======================================================================

INTERVAL_PRESETS = {
    "hourly": 60,
    "3h": 180,
    "6h": 360,
    "12h": 720,
    "daily": 1440,
    "weekly": 10080,
}

DATE_RANGE_PRESETS = {
    "last_1h": 1,
    "last_24h": 24,
    "last_2d": 48,
    "last_week": 168,
    "last_month": 720,
    "custom": None,  # uses custom_hours_back
}


def _calc_next_run(interval_minutes: int, from_dt: Optional[datetime] = None) -> datetime:
    """يحسب next_run بناءً على الفاصل"""
    from datetime import timedelta
    base = from_dt or datetime.now(timezone.utc)
    return base + timedelta(minutes=interval_minutes)


def list_schedules(user_id: int) -> list[dict]:
    with db_cursor() as cur:
        cur.execute("""
            SELECT * FROM schedules
            WHERE user_id=%s
            ORDER BY created_at DESC
        """, (user_id,))
        result = []
        for r in cur.fetchall():
            d = dict(r)
            d["enabled"] = bool(d["enabled"])
            try:
                d["pages"] = json.loads(d.get("pages_json") or "[]")
            except Exception:
                d["pages"] = []
            d.pop("pages_json", None)
            for k in ("last_run", "next_run", "created_at", "updated_at"):
                if d.get(k) and hasattr(d[k], "isoformat"):
                    d[k] = d[k].isoformat()
            result.append(d)
        return result


def get_schedule(user_id: int, schedule_id: int) -> Optional[dict]:
    with db_cursor() as cur:
        cur.execute("SELECT * FROM schedules WHERE user_id=%s AND id=%s",
                    (user_id, schedule_id))
        r = cur.fetchone()
        if not r:
            return None
        d = dict(r)
        d["enabled"] = bool(d["enabled"])
        try:
            d["pages"] = json.loads(d.get("pages_json") or "[]")
        except Exception:
            d["pages"] = []
        d.pop("pages_json", None)
        return d


def create_schedule(user_id: int, data: dict) -> int:
    now = datetime.now(timezone.utc)
    pages = data.get("pages") or []
    interval_minutes = int(data.get("interval_minutes") or 60)
    next_run = _calc_next_run(interval_minutes, now)

    with db_cursor() as cur:
        cur.execute("""
            INSERT INTO schedules
            (user_id, name, enabled, pages_json, source, interval_minutes,
             date_range_preset, custom_hours_back, next_run, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            user_id,
            (data.get("name") or "مهمة جديدة").strip()[:128],
            1 if data.get("enabled", True) else 0,
            json.dumps(pages, ensure_ascii=False),
            data.get("source") or "auto",
            interval_minutes,
            data.get("date_range_preset") or "last_24h",
            int(data.get("custom_hours_back") or 24),
            next_run,
            now,
            now,
        ))
        return cur.lastrowid


def update_schedule(user_id: int, schedule_id: int, data: dict) -> bool:
    now = datetime.now(timezone.utc)
    fields = {"updated_at": now}

    if "name" in data:
        fields["name"] = (data["name"] or "").strip()[:128]
    if "enabled" in data:
        fields["enabled"] = 1 if data["enabled"] else 0
    if "pages" in data:
        fields["pages_json"] = json.dumps(data["pages"] or [], ensure_ascii=False)
    if "source" in data:
        fields["source"] = data["source"] or "auto"
    if "interval_minutes" in data:
        fields["interval_minutes"] = int(data["interval_minutes"])
        fields["next_run"] = _calc_next_run(fields["interval_minutes"], now)
    if "date_range_preset" in data:
        fields["date_range_preset"] = data["date_range_preset"]
    if "custom_hours_back" in data:
        fields["custom_hours_back"] = int(data["custom_hours_back"])

    cols = ", ".join(f"{k}=%s" for k in fields)
    with db_cursor() as cur:
        cur.execute(
            f"UPDATE schedules SET {cols} WHERE user_id=%s AND id=%s",
            (*fields.values(), user_id, schedule_id)
        )
        return cur.rowcount > 0


def delete_schedule(user_id: int, schedule_id: int) -> bool:
    with db_cursor() as cur:
        cur.execute("DELETE FROM schedules WHERE user_id=%s AND id=%s",
                    (user_id, schedule_id))
        return cur.rowcount > 0


def mark_schedule_ran(schedule_id: int) -> None:
    now = datetime.now(timezone.utc)
    with db_cursor() as cur:
        # Get interval
        cur.execute("SELECT interval_minutes FROM schedules WHERE id=%s",
                    (schedule_id,))
        row = cur.fetchone()
        if not row:
            return
        next_run = _calc_next_run(int(row["interval_minutes"]), now)
        cur.execute("""
            UPDATE schedules
            SET last_run=%s, next_run=%s, total_runs=total_runs+1, updated_at=%s
            WHERE id=%s
        """, (now, next_run, now, schedule_id))


def get_due_schedules() -> list[dict]:
    """يرجع كل schedules المستحقة (next_run <= now && enabled)"""
    with db_cursor() as cur:
        cur.execute("""
            SELECT * FROM schedules
            WHERE enabled=1 AND (next_run IS NULL OR next_run <= %s)
        """, (datetime.now(timezone.utc),))
        result = []
        for r in cur.fetchall():
            d = dict(r)
            d["enabled"] = bool(d["enabled"])
            try:
                d["pages"] = json.loads(d.get("pages_json") or "[]")
            except Exception:
                d["pages"] = []
            d.pop("pages_json", None)
            result.append(d)
        return result


# ======================================================================
#  Migration from legacy JSON files
# ======================================================================

def migrate_legacy_data(admin_user_id: int) -> dict:
    """يستورد pages.json + web/data/*.json إلى قاعدة البيانات"""
    stats = {"pages": 0, "posts": 0}

    pages_path = PROJECT_ROOT / "pages.json"
    if pages_path.exists():
        try:
            data = json.loads(pages_path.read_text(encoding="utf-8"))
            pages = data.get("pages", [])
            if pages:
                upsert_pages(admin_user_id, pages)
                stats["pages"] = len(pages)
        except Exception:
            pass

    data_dir = PROJECT_ROOT / "web" / "data"
    if data_dir.exists():
        for f in data_dir.glob("*.json"):
            if f.stem in ("index", "history"):
                continue
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                slug = data.get("page_slug", f.stem)
                posts = data.get("posts", [])
                if posts:
                    new_count = insert_posts(admin_user_id, slug, posts)
                    stats["posts"] += new_count
            except Exception:
                continue

    return stats


# ======================================================================
#  Boot
# ======================================================================

def bootstrap() -> None:
    """يُستدعى في بداية التطبيق"""
    init_db()
