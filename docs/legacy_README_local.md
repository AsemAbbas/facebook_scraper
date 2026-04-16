# 📘 دليل تشغيل سحب منشورات فيسبوك

## ⚠️ تحذيرات قانونية وتقنية

1. **مخالف لشروط فيسبوك**: السحب الآلي يعرض حسابك للحظر. استخدم IP/جهاز منفصل.
2. **الصفحات العامة فقط**: لا تحاول سحب صفحات خاصة أو محتوى بعد تسجيل الدخول.
3. **احترم rate limits**: لا تشغّل السكريبت بشكل متكرر سريع.
4. **للأبحاث الإعلامية**: للاستخدام الصحفي/البحثي فقط.

---

## 🛠️ خطوات الإعداد

### 1. تثبيت المتطلبات (على جهازك المحلي، ليس على التابلت)

```bash
pip install -r requirements.txt
playwright install chromium
```

> **ملاحظة للتابلت**: Playwright لا يعمل على تابلت Huawei مباشرة. تحتاج:
> - جهاز كمبيوتر (ويندوز/ماك/لينكس)، أو
> - VPS صغير (Hetzner/DigitalOcean)، أو
> - GitHub Actions (مجاناً مع تشغيل مجدول)

### 2. إعداد Google Sheets

أ. أنشئ شيت جديد: [sheets.new](https://sheets.new)  
ب. انسخ ID الشيت من الرابط  
ج. اذهب إلى [Google Cloud Console](https://console.cloud.google.com)  
د. أنشئ مشروع → فعّل **Google Sheets API** و **Google Drive API**  
هـ. أنشئ **Service Account** → نزّل ملف JSON → سمّه `service_account.json`  
و. شارك الشيت مع إيميل الـ Service Account (له صلاحية محرر)

### 3. تعديل الإعدادات في `scraper.py`

```python
CONFIG = {
    "page_url": "https://www.facebook.com/PAGE_NAME_HERE",
    "max_posts": 30,
    "headless": True,
}
```

### 4. تعديل `upload_to_sheets.py`

```python
SHEET_ID = "ضع_معرف_الشيت_من_رابطه"
```

### 5. إعداد Apps Script

أ. في الشيت → **الإضافات** → **Apps Script**  
ب. الصق محتوى `AppsScript.gs`  
ج. عدّل `ALERT_EMAIL` و `KEYWORDS` و `HIGH_ENGAGEMENT_THRESHOLD`  
د. احفظ → ارجع للشيت → ستجد قائمة "🔍 مراقبة فيسبوك" بعد إعادة التحميل

---

## ▶️ التشغيل

```bash
# الخطوة 1: السحب
python scraper.py

# الخطوة 2: الرفع إلى الشيت
python upload_to_sheets.py
```

ثم في الشيت → قائمة **🔍 مراقبة فيسبوك** → **⚙️ تشغيل كل المهام**

---

## 🤖 الأتمتة (اختياري)

### عبر GitHub Actions (مجاناً، كل ساعة)

أنشئ `.github/workflows/scrape.yml`:

```yaml
name: FB Scraper
on:
  schedule:
    - cron: '0 * * * *'  # كل ساعة
  workflow_dispatch:

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r requirements.txt && playwright install chromium
      - name: Setup credentials
        run: echo '${{ secrets.SERVICE_ACCOUNT_JSON }}' > service_account.json
      - run: python scraper.py
      - run: python upload_to_sheets.py
```

أضف `service_account.json` كـ secret باسم `SERVICE_ACCOUNT_JSON`.

---

## 🐛 مشاكل شائعة

| المشكلة | الحل |
|---------|------|
| نافذة تسجيل الدخول تحجب المحتوى | جرّب `mbasic.facebook.com/PAGE_NAME` بدلاً |
| لا تظهر التفاعلات | فيسبوك يخفيها للزوار غير المسجلين أحياناً |
| السكريبت بطيء | قلّل `max_posts` أو زِد `scroll_pause` |
| حظر مؤقت من فيسبوك | استخدم proxy أو انتظر 24 ساعة |

---

## 📂 هيكل الملفات

```
fb_scraper/
├── scraper.py              # السحب الرئيسي
├── upload_to_sheets.py     # الرفع إلى الشيت
├── AppsScript.gs           # المعالجة داخل الشيت
├── requirements.txt
├── service_account.json    # (لا ترفعه على GitHub!)
└── output/                 # النتائج JSON و CSV
```

أضف `.gitignore`:
```
service_account.json
output/
__pycache__/
```
