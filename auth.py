"""
مَرصَد · Auth module
=====================
Flask-Login integration + register/login/logout/me endpoints
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from functools import wraps

from flask import Blueprint, jsonify, request, session
from flask_login import (
    LoginManager, UserMixin, login_user, logout_user,
    current_user, login_required
)

import database as db

auth_bp = Blueprint("auth", __name__)
login_manager = LoginManager()


class User(UserMixin):
    def __init__(self, data: dict):
        self.id = data["id"]
        self.username = data["username"]
        self.email = data.get("email")
        self.role = data.get("role", "user")
        self.display_name = data.get("display_name") or data["username"]
        self.is_active_flag = bool(data.get("is_active", 1))

    @property
    def is_active(self):
        return self.is_active_flag

    def is_admin(self) -> bool:
        return self.role == "admin"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "role": self.role,
            "display_name": self.display_name,
        }


@login_manager.user_loader
def load_user(user_id):
    try:
        data = db.get_user_by_id(int(user_id))
        if data and data.get("is_active", 1):
            return User(data)
    except Exception:
        pass
    return None


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({"error": "غير مصرح"}), 401
        if not current_user.is_admin():
            return jsonify({"error": "صلاحيات المشرف مطلوبة"}), 403
        return f(*args, **kwargs)
    return decorated


def _validate_signup(username: str, password: str, email: str) -> tuple[bool, str]:
    if not username or len(username) < 3:
        return False, "اسم المستخدم لازم 3 أحرف على الأقل"
    if not username.replace("_", "").replace("-", "").isalnum():
        return False, "اسم المستخدم يحتوي أحرف/أرقام فقط"
    if len(username) > 64:
        return False, "اسم المستخدم طويل جداً"
    if not password or len(password) < 6:
        return False, "كلمة السر لازم 6 أحرف على الأقل"
    if email and "@" not in email:
        return False, "البريد الإلكتروني غير صحيح"
    return True, ""


# ======================================================================
#  Routes
# ======================================================================

@auth_bp.route("/api/auth/setup", methods=["GET"])
def auth_setup_status():
    """هل في مستخدمين؟ (أول تشغيل)"""
    try:
        count = db.user_count()
        return jsonify({"configured": count > 0, "user_count": count})
    except Exception as e:
        return jsonify({"configured": False, "error": str(e), "user_count": 0})


@auth_bp.route("/api/auth/register", methods=["POST"])
def register():
    """
    تسجيل مستخدم جديد.
    أول مستخدم = admin تلقائياً.
    """
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    email = (data.get("email") or "").strip()
    display_name = (data.get("display_name") or username).strip()

    ok, err = _validate_signup(username, password, email)
    if not ok:
        return jsonify({"error": err}), 400

    # check existing
    if db.get_user_by_username(username):
        return jsonify({"error": "اسم المستخدم موجود مسبقاً"}), 400

    try:
        count = db.user_count()
        role = "admin" if count == 0 else "user"

        user_id = db.create_user(
            username=username,
            password=password,
            email=email or None,
            display_name=display_name,
            role=role,
        )

        # Auto-migrate legacy data to first admin
        if role == "admin":
            try:
                stats = db.migrate_legacy_data(user_id)
                print(f"[migrate] pages={stats['pages']} posts={stats['posts']}")
            except Exception as e:
                print(f"[migrate] failed: {e}")

        # Auto-login
        user_data = db.get_user_by_id(user_id)
        user = User(user_data)
        login_user(user, remember=True)
        db.update_last_login(user_id)

        return jsonify({
            "ok": True,
            "user": user.to_dict(),
            "is_first_user": role == "admin",
        })
    except Exception as e:
        return jsonify({"error": f"خطأ في التسجيل: {e}"}), 500


@auth_bp.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    remember = bool(data.get("remember", True))

    if not username or not password:
        return jsonify({"error": "اسم المستخدم وكلمة السر مطلوبان"}), 400

    user_data = db.get_user_by_username(username)
    if not user_data:
        return jsonify({"error": "اسم المستخدم أو كلمة السر خاطئة"}), 401
    if not user_data.get("is_active", 1):
        return jsonify({"error": "الحساب معطّل"}), 403
    if not db.verify_password(password, user_data["password_hash"]):
        return jsonify({"error": "اسم المستخدم أو كلمة السر خاطئة"}), 401

    user = User(user_data)
    login_user(user, remember=remember)
    db.update_last_login(user.id)

    return jsonify({"ok": True, "user": user.to_dict()})


@auth_bp.route("/api/auth/logout", methods=["POST"])
def logout():
    logout_user()
    return jsonify({"ok": True})


@auth_bp.route("/api/auth/me", methods=["GET"])
def me():
    if not current_user.is_authenticated:
        return jsonify({"authenticated": False}), 200
    return jsonify({
        "authenticated": True,
        "user": current_user.to_dict(),
    })


@auth_bp.route("/api/auth/change-password", methods=["POST"])
@login_required
def change_password():
    data = request.get_json(silent=True) or {}
    current = data.get("current_password") or ""
    new = data.get("new_password") or ""

    if len(new) < 6:
        return jsonify({"error": "كلمة السر الجديدة قصيرة"}), 400

    user_data = db.get_user_by_id(current_user.id)
    if not db.verify_password(current, user_data["password_hash"]):
        return jsonify({"error": "كلمة السر الحالية خاطئة"}), 401

    db.change_password(current_user.id, new)
    return jsonify({"ok": True})


@auth_bp.route("/api/auth/profile", methods=["POST"])
@login_required
def update_profile():
    """المستخدم يحدّث بياناته الشخصية (display_name + email)"""
    data = request.get_json(silent=True) or {}
    display_name = (data.get("display_name") or "").strip()
    email = (data.get("email") or "").strip()

    updates = {}
    if display_name:
        if len(display_name) > 128:
            return jsonify({"error": "الاسم المعروض طويل"}), 400
        updates["display_name"] = display_name
    if email:
        if "@" not in email or len(email) > 191:
            return jsonify({"error": "البريد الإلكتروني غير صحيح"}), 400
        updates["email"] = email
    else:
        updates["email"] = None

    if not updates:
        return jsonify({"error": "لا شيء للتحديث"}), 400

    try:
        db.update_user(current_user.id, **updates)
    except Exception as e:
        return jsonify({"error": f"فشل التحديث: {e}"}), 500

    # Reload user data
    fresh = db.get_user_by_id(current_user.id)
    user = User(fresh)
    return jsonify({"ok": True, "user": user.to_dict()})


# Admin routes
@auth_bp.route("/api/admin/users", methods=["GET"])
@admin_required
def admin_list_users():
    users = db.list_users(limit=200)
    # iso-ify dates
    for u in users:
        for k in ("created_at", "last_login"):
            if u.get(k) and hasattr(u[k], "isoformat"):
                u[k] = u[k].isoformat()
    return jsonify({"users": users})


@auth_bp.route("/api/admin/users", methods=["POST"])
@admin_required
def admin_create_user():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    email = (data.get("email") or "").strip()
    role = data.get("role", "user")
    display_name = data.get("display_name") or username

    ok, err = _validate_signup(username, password, email)
    if not ok:
        return jsonify({"error": err}), 400
    if db.get_user_by_username(username):
        return jsonify({"error": "اسم المستخدم موجود"}), 400

    user_id = db.create_user(
        username=username, password=password,
        email=email or None, display_name=display_name, role=role
    )
    return jsonify({"ok": True, "user_id": user_id})


@auth_bp.route("/api/admin/users/<int:uid>", methods=["PATCH"])
@admin_required
def admin_update_user(uid):
    data = request.get_json(silent=True) or {}
    allowed_updates = {}
    for k in ("email", "display_name", "role", "is_active"):
        if k in data:
            allowed_updates[k] = data[k]
    if "password" in data and data["password"]:
        db.change_password(uid, data["password"])
    if allowed_updates:
        if "is_active" in allowed_updates:
            allowed_updates["is_active"] = 1 if allowed_updates["is_active"] else 0
        db.update_user(uid, **allowed_updates)
    return jsonify({"ok": True})


@auth_bp.route("/api/admin/users/<int:uid>", methods=["DELETE"])
@admin_required
def admin_delete_user(uid):
    if uid == current_user.id:
        return jsonify({"error": "لا يمكن حذف نفسك"}), 400
    db.delete_user(uid)
    return jsonify({"ok": True})


def init_app(app):
    """يُستدعى من server.py"""
    # Secret key from env or generate
    secret = app.config.get("SECRET_KEY") or _get_app_secret()
    app.config["SECRET_KEY"] = secret
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["REMEMBER_COOKIE_DURATION"] = 60 * 60 * 24 * 30  # 30 days

    login_manager.init_app(app)
    login_manager.login_view = None  # API only - return 401

    @login_manager.unauthorized_handler
    def unauth():
        return jsonify({"error": "غير مصرح - سجل دخول أولاً"}), 401

    app.register_blueprint(auth_bp)


def _get_app_secret() -> str:
    """مفتاح الجلسات - يُخزّن في database/.app_secret"""
    f = db.DATA_DIR / ".app_secret"
    if f.exists():
        return f.read_text(encoding="utf-8").strip()
    secret = secrets.token_urlsafe(48)
    f.write_text(secret, encoding="utf-8")
    try:
        import os as _os
        _os.chmod(f, 0o600)
    except Exception:
        pass
    return secret
