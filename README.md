# 🔍 مَرصَد · Marsad

> أداة احترافية لرصد منشورات صفحات فيسبوك العامة · واجهة عربية كاملة · 5 مصادر سحب قابلة للتبديل

![Version](https://img.shields.io/badge/version-3.0-orange)
![Python](https://img.shields.io/badge/python-3.11+-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ⚡ التشغيل السريع (دقيقة واحدة)

### على ويندوز

1. **نزّل المشروع** (أو fork من GitHub)
2. **انقر مرتين** على `start.bat`
3. انتظر التثبيت التلقائي (أول مرة فقط ~2 دقيقة)
4. المتصفح راح يفتح على `http://localhost:5050`

### على Mac / Linux

```bash
chmod +x start.sh
./start.sh
```

**انتهيت!** راح يظهرلك الـ wizard ليرشدك للإعداد.

---

## ✨ المزايا

### 🎯 واجهة احترافية بالكامل
- ✅ **سحب بكبسة واحدة** من داخل الواجهة
- ✅ **progress live** أثناء السحب
- ✅ **إدارة الصفحات** (إضافة / تعديل / حذف / اختبار)
- ✅ **تحرير الإعدادات** مباشرة (config.yml) من الواجهة
- ✅ **تفاصيل كاملة** لكل منشور (انقر المنشور)
- ✅ **Analytics dashboard** (رسومات بيانية + إحصاءات)
- ✅ **سجل كامل** لكل عمليات السحب

### 🔌 5 مصادر مرنة (بدّل بكبسة)
| المصدر | التكلفة | الموثوقية | التفاعلات |
|--------|---------|-----------|-----------|
| 🎭 **Playwright** | مجاني | متوسط | جزئي |
| 🪶 **FetchRSS** | $9.95/شهر | عالي | ❌ |
| ⚡ **RSS.app** | $16.64/شهر | عالي | ❌ |
| 🏠 **RSSHub** | مجاني (VPS) | عالي | ❌ |
| 💎 **Apify** | $49/شهر | عالي جداً | ✅ كاملة + تعليقات |

### 🔍 بحث وفلترة متقدمة
- فلتر بالصفحة، المصدر، التاريخ، الحد الأدنى للتفاعل
- فلاتر سريعة: آخر 24س / 7 أيام / 30 يوم
- بحث فوري في النصوص
- تصدير CSV

### 🔔 اختياري
- تنبيهات Telegram للمنشورات العالية
- سحب تلقائي كل X ساعة
- GitHub Actions (لو بدك تشغيل على cloud)

---

## 📋 كيف تستخدمه؟

### الخطوة 1: شغّل السيرفر
انقر مرتين على `start.bat` (ويندوز) أو `./start.sh` (mac/linux).

### الخطوة 2: أضف صفحة
من الواجهة: اضغط زر **📄 إدارة الصفحات** → **+ إضافة صفحة**:
- اسم الصفحة بالعربي (مثل: "قناة الجزيرة")
- رابط الصفحة (`https://facebook.com/aljazeerachannel`)
- 🧪 **اختبر** قبل الحفظ للتأكد من الرابط

### الخطوة 3: ابدأ السحب
اضغط **▶️ سحب الآن** → راح يظهرلك progress مباشر.

### الخطوة 4: اكتشف المنشورات
- انقر أي منشور لتفاصيله الكاملة (تعليقات، تفاعلات، صور، روابط)
- فلتر، ابحث، رتّب، صدّر CSV

---

## 🧙‍♂️ الإعدادات المتقدمة (اختياري)

كل شي من الواجهة عبر زر **⚙️ الإعدادات**:
- **نظرة عامة:** روابط وإحصاءات
- **config.yml:** محرر كامل بـ syntax highlighting
- **pages.json:** عرض الصفحات المعرفة
- **متقدّم:** أمثلة جاهزة لـ keywords, date ranges, Telegram

### أمثلة (في config.yml مباشرة من الواجهة)

**تفعيل Apify (للحصول على تعليقات دقيقة):**
```yaml
sources:
  - name: apify
    enabled: true
    token: ${APIFY_TOKEN}
    include_comments: true
    max_comments_per_post: 10
```

**فلترة عند السحب:**
```yaml
scraping:
  required_keywords: ["غزة", "القدس"]
  excluded_keywords: ["إعلان"]
  skip_sponsored: true
```

**تنبيهات Telegram:**
```yaml
alerts:
  telegram:
    enabled: true
    high_engagement_threshold: 5000
    keywords: ["عاجل"]
```

---

## 🗂️ هيكل المشروع

```
marsad/
├── server.py              ← الخادم (Flask + API)
├── start.bat / start.sh   ← مشغّل واحد فقط (double-click)
├── config.yml             ← إعدادات المصادر + الفلاتر
├── pages.json             ← قائمة الصفحات
├── requirements.txt       ← Python dependencies
│
├── web/                   ← الواجهة
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── data/              ← البيانات المسحوبة (JSON)
│
├── scrapers/              ← plugins المصادر (قابلة للتوسيع)
│   ├── base.py            ← UnifiedPost schema
│   ├── apify_source.py
│   ├── fetchrss_source.py
│   ├── rssapp_source.py
│   ├── rsshub_source.py
│   └── playwright_source.py
│
├── scripts/               ← scripts مساعدة
│   ├── run.py             ← CLI scraper
│   ├── local_run.py       ← سحب محلي + git push
│   └── telegram_notify.py
│
└── .github/workflows/     ← GitHub Actions (اختياري)
    ├── scrape.yml
    └── deploy.yml
```

---

## 🔗 API (للمطورين)

السيرفر يوفر REST API كامل على `http://localhost:5050/api`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | حالة النظام |
| `GET` | `/api/pages` | قائمة الصفحات |
| `POST` | `/api/pages` | حفظ الصفحات |
| `DELETE` | `/api/pages/{slug}` | حذف صفحة |
| `GET` | `/api/config` | إعدادات + raw YAML |
| `POST` | `/api/config` | حفظ الإعدادات |
| `POST` | `/api/config/raw` | حفظ من raw YAML |
| `GET` | `/api/sources` | حالة المصادر |
| `POST` | `/api/scrape` | بدء سحب |
| `GET` | `/api/scrape` | Jobs نشطة |
| `GET` | `/api/scrape/{id}` | حالة job |
| `GET` | `/api/scrape/{id}/stream` | SSE progress |
| `GET` | `/api/history` | سجل العمليات |
| `POST` | `/api/test-page` | اختبار URL واحد |

---

## ⚠️ تحذيرات قانونية

- 🚫 سحب فيسبوك يخالف شروط الخدمة
- ✅ استخدم للأغراض البحثية/الصحفية فقط
- 🚫 لا تسحب صفحات خاصة
- ⏱️ احترم rate limits
- 👤 لا تستخدم حسابك الشخصي للسحب

---

## 🛠️ استكشاف الأخطاء

راجع [TROUBLESHOOTING.md](TROUBLESHOOTING.md) للمشاكل الشائعة.

**المشكلة الأكثر شيوعاً:** Playwright يفشل على GitHub Actions (IPs محجوبة). الحل: شغّل محلياً عبر `start.bat`.

---

## 📄 الترخيص

MIT · مفتوح المصدر بالكامل

---

صُنع بـ ❤️ للصحافة والبحث الإعلامي · v3.0
