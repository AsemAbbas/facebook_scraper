# 🔍 مَرصَد · Marsad

> منصة احترافية لرصد منشورات صفحات فيسبوك العامة · نظام حسابات · MySQL · متوافق مع cPanel

![Version](https://img.shields.io/badge/version-4.0-orange)
![Python](https://img.shields.io/badge/python-3.11+-blue)
![Database](https://img.shields.io/badge/database-MySQL-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ ما الجديد في v4.0

- 🔐 **نظام حسابات كامل** - تسجيل دخول + إدارة مستخدمين (admin + users)
- 🗄️ **MySQL** - بدل JSON files، جاهز للاستضافة
- 🌐 **متوافق cPanel** - passenger_wsgi.py + دليل نشر شامل
- ⚙️ **كل الإعدادات من الواجهة** - لا حاجة لتعديل ملفات
- 🗑️ **إدارة المنشورات** - حذف فردي / متعدد / كامل / تصدير+حذف (أرشفة)
- 🎯 **ربط المصادر مبسّط** - فعّل/عطّل بكبسة، الصق token محفوظ مشفّراً
- 🧩 **كل مستخدم بياناته** - صفحات، منشورات، إعدادات، tokens منفصلة

---

## 🚀 طريقتين للتشغيل

### 1️⃣ محلياً (للتطوير / الاستخدام الشخصي)

**على ويندوز:**
```
نقر مزدوج على start.bat
```

**على Mac / Linux:**
```bash
./start.sh
```

المتصفح يفتح على `http://localhost:5050` → سجّل أول مستخدم = admin → ابدأ.

### 2️⃣ على cPanel (للنشر الإنتاجي)

راجع [CPANEL_DEPLOYMENT.md](CPANEL_DEPLOYMENT.md) - دليل 7 خطوات مفصّل (15-30 دقيقة).

---

## 🗄️ متطلبات قاعدة البيانات

**MySQL 5.7+ أو MariaDB 10+**

أي cPanel يوفرها. محلياً استخدم Laragon / XAMPP / MySQL Community.

ملف `.env` (انسخ من `.env.example`):
```env
MARSAD_DB_HOST=localhost
MARSAD_DB_PORT=3306
MARSAD_DB_NAME=marsad
MARSAD_DB_USER=root
MARSAD_DB_PASSWORD=
```

الجداول تُنشأ تلقائياً في أول تشغيل.

---

## 👥 نظام الحسابات

- **أول مستخدم يسجّل = admin** تلقائياً
- admin يرى كل المستخدمين في الإعدادات
- كل مستخدم يرى بياناته فقط (صفحاته، منشوراته، token ه)
- كلمات السر مشفّرة بـ PBKDF2-SHA256
- API tokens مشفّرة بـ Fernet في DB

---

## 🔌 المصادر المدعومة

| المصدر | التكلفة | يعمل cPanel؟ | التفاعلات |
|--------|---------|--------------|-----------|
| 💎 **Apify** | $49/شهر (5$ مجاني) | ✅ | ✅ كاملة + تعليقات |
| 🪶 **FetchRSS** | $9.95/شهر | ✅ | ❌ |
| ⚡ **RSS.app** | $16.64/شهر | ✅ | ❌ |
| 🏠 **RSSHub** | مجاني (VPS) | ✅ | ❌ |
| 🎭 **Playwright** | مجاني | ❌ | جزئي |

> **لـ cPanel:** استخدم Apify أو FetchRSS. Playwright يحتاج Chromium وهو غير متاح على الاستضافة المشتركة.

---

## 🎯 الاستخدام (من الواجهة بالكامل)

1. **سجّل حساب** (أول مستخدم = admin)
2. **الإعدادات** ⚙️ → فعّل مصدر (Apify / FetchRSS...) → الصق token
3. **إدارة الصفحات** 📄 → أضف صفحة فيسبوك → اختبرها 🧪
4. **سحب الآن** ▶️ → شاهد التقدم مباشرة
5. **استكشف المنشورات** - فلتر، ابحث، انقر لتفاصيل التعليقات
6. **إدارة** - احذف منشور/عدة/صفحة/كل شي - أو صدّر+احذف (أرشفة)

---

## 🗂️ هيكل المشروع

```
marsad/
├── server.py              ← Flask + API (16 endpoint)
├── database.py            ← MySQL ORM layer
├── auth.py                ← Flask-Login + user management
├── passenger_wsgi.py      ← cPanel entry point
├── .htaccess              ← cPanel / Apache config
├── start.bat / start.sh   ← مشغّل محلي
├── .env.example           ← قالب إعدادات DB
├── requirements.txt       ← تبعيات Python
│
├── web/                   ← الواجهة
│   ├── index.html         ← auth screen + app
│   ├── auth.js            ← تسجيل / دخول / خروج
│   ├── app.js             ← التطبيق الرئيسي
│   └── style.css
│
├── scrapers/              ← 5 مصادر قابلة للتبديل
│   ├── base.py
│   ├── apify_source.py
│   ├── fetchrss_source.py
│   ├── rssapp_source.py
│   ├── rsshub_source.py
│   └── playwright_source.py
│
├── scripts/
│   └── run.py / local_run.py
│
├── database/              ← (لا يُرفع - يحتوي secrets)
│   ├── .secret            ← مفتاح Fernet لتشفير tokens
│   └── .app_secret        ← Flask session key
│
├── CPANEL_DEPLOYMENT.md   ← دليل النشر
├── TROUBLESHOOTING.md     ← حل المشاكل
└── README.md
```

---

## 🔗 REST API

كل endpoints تحت `/api/` تتطلب تسجيل دخول (cookie session).

### Auth
- `POST /api/auth/register` - تسجيل (أول = admin)
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/change-password`

### Pages
- `GET /api/pages` - صفحات المستخدم
- `POST /api/pages` - حفظ
- `DELETE /api/pages/:slug`

### Posts
- `GET /api/posts` - مع فلاتر (page, source, date, search, limit)
- `DELETE /api/posts/:id` - حذف واحد
- `POST /api/posts/bulk-delete` - حذف متعدد
- `POST /api/posts/clear-page/:slug` - حذف كل منشورات صفحة
- `POST /api/posts/clear-all` - حذف الكل
- `GET /api/posts/export` - CSV
- `POST /api/posts/export-and-delete` - أرشفة

### Scraping
- `POST /api/scrape` - بدء job
- `GET /api/scrape/:id/stream` - SSE progress
- `GET /api/history`

### Settings
- `GET /api/sources` - حالة + metadata
- `PATCH /api/sources/:name` - فعّل / priority / token / config

### Admin
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id`
- `DELETE /api/admin/users/:id`

### System
- `GET /api/status` - صحة النظام (public)

---

## 🔒 الأمان

- كلمات السر: PBKDF2-SHA256 · 100,000 iterations
- API tokens: Fernet symmetric encryption
- Session cookies: HttpOnly + SameSite=Lax
- CORS مُفعّل مع credentials
- `.htaccess` يمنع الوصول لـ `.env` و `database/`

---

## ⚠️ تحذيرات

- 🚫 سحب فيسبوك يخالف شروط الخدمة - للأغراض البحثية فقط
- 🚫 Playwright لا يعمل على cPanel (لا Chromium)
- ✅ Apify / FetchRSS / RSS.app يعملون على كل استضافة

---

## 📄 الترخيص

MIT · مفتوح المصدر بالكامل

---

صُنع بـ ❤️ للصحافة والبحث الإعلامي · v4.0
