# 📚 مَرصَد · دليل الإعداد الكامل

> هذا الدليل يشرح **خطوة بخطوة** كيف تجهّز المشروع ببساطة — حتى لو ما كنت مطوّراً.

---

## 📋 قائمة المحتويات

1. [المتطلبات الأساسية](#1-المتطلبات-الأساسية)
2. [رفع المشروع على GitHub (5 دقائق)](#2-رفع-المشروع-على-github)
3. [اختيار المصدر المناسب](#3-اختيار-المصدر-المناسب-لك)
4. [إعداد كل مصدر بالتفصيل](#4-إعداد-كل-مصدر)
   - [Apify 💎](#-apify-الأفضل-موثوقية)
   - [FetchRSS 🪶](#-fetchrss-الأرخص)
   - [RSS.app ⚡](#-rssapp)
   - [RSSHub 🏠](#-rsshub)
   - [Playwright 🎭](#-playwright-مجاني-لكن-غير-موثوق)
5. [إضافة الصفحات من الواجهة](#5-إضافة-الصفحات)
6. [تخصيص نطاق التاريخ](#6-نطاق-التاريخ-للسحب)
7. [تنبيهات Telegram](#7-تنبيهات-telegram-اختياري)
8. [استكشاف الأخطاء](#8-استكشاف-الأخطاء)

---

## 1. المتطلبات الأساسية

كل اللي بتحتاجه:

- ✅ حساب [GitHub](https://github.com) (مجاني)
- ✅ متصفح ويب (Chrome / Safari / Firefox)
- ✅ إيميل لتلقي التنبيهات (اختياري)

**ما بتحتاج:**
- ❌ جهاز شغّال دائماً
- ❌ معرفة بالبرمجة (للإعداد الأساسي)
- ❌ خادم (Server)
- ❌ بطاقة ائتمان (للحلول المجانية)

---

## 2. رفع المشروع على GitHub

### الطريقة الأسهل (بدون terminal):

1. افتح [github.com/AsemAbbas/facebook_scraper](https://github.com/AsemAbbas/facebook_scraper)
2. اضغط **Fork** (زر في الأعلى يمين)
3. انسخ الريبو لحسابك

### الطريقة المتقدمة (terminal):

```bash
git clone https://github.com/AsemAbbas/facebook_scraper.git
cd facebook_scraper
```

### فعّل GitHub Pages:

1. في الريبو → **Settings** → **Pages**
2. تحت **Build and deployment** → Source: **GitHub Actions**
3. احفظ

### فعّل أذونات Workflow:

1. **Settings** → **Actions** → **General**
2. **Workflow permissions**: اختر **Read and write permissions**
3. احفظ

### شغّل أول workflow:

1. **Actions** → اختر **"Marsad · Scrape Facebook Pages"**
2. اضغط **Run workflow**
3. انتظر 3-5 دقائق
4. افتح الموقع على: `https://[username].github.io/facebook_scraper/`

---

## 3. اختيار المصدر المناسب لك

استخدم هالجدول ليساعدك تقرّر:

| احتياجك | المصدر المناسب | التكلفة |
|---------|----------------|---------|
| أريد تفاعلات دقيقة + بدون مخاطر | **Apify** 💎 | $49/شهر |
| أريد الأرخص للنصوص فقط | **FetchRSS** 🪶 | $9.95/شهر |
| عندي VPS وبدي مجاني | **RSSHub** 🏠 | ~$4/شهر |
| أجرب قبل الدفع | **Playwright** 🎭 | مجاني |
| تحديثات أسرع من RSS | **RSS.app** ⚡ | $16.64/شهر |

**التوصية العامة:** ابدأ بـ **Playwright** للتجربة، ثم انتقل لـ **FetchRSS** لو تحتاج موثوقية، أو **Apify** لو تحتاج تفاعلات.

---

## 4. إعداد كل مصدر

### 💎 Apify (الأفضل موثوقية)

**المميزات:**
- ✅ Residential proxies (IP نظيف)
- ✅ تفاعلات وتعليقات دقيقة
- ✅ صفر صيانة
- ✅ API موثقة

**الخطوات:**

1. **سجّل حساب:** [apify.com/sign-up](https://apify.com/sign-up) - مجاني
2. **انسخ الـ Token:**
   - اذهب إلى [Console → Integrations](https://console.apify.com/account/integrations)
   - انسخ **Personal API token**
3. **أضف كـ Secret في GitHub:**
   - GitHub repo → **Settings** → **Secrets and variables** → **Actions**
   - **New repository secret**
   - Name: `APIFY_TOKEN`
   - Secret: (الصق الـ token)
4. **فعّل في `config.yml`:**
   ```yaml
   sources:
     - name: apify
       enabled: true       # ← غيّر لـ true
       priority: 1
   ```
5. **في الواجهة:** اضغط زر "📄 إدارة الصفحات" → اختر `apify` كمصدر لكل صفحة

**التكلفة التفصيلية:**
- Free Trial: $5 credits (يكفي ~100 منشور)
- Starter: $49/شهر (~10K منشور)

---

### 🪶 FetchRSS (الأرخص)

**المميزات:**
- ✅ رخيص جداً ($9.95/شهر)
- ✅ بسيط وسهل
- ✅ 100 feed في plan الـ Advanced

**العيوب:**
- ❌ بدون تفاعلات
- ❌ تحديث كل 3-6 ساعات فقط (قيد من فيسبوك)

**الخطوات:**

1. **سجّل في [fetchrss.com](https://fetchrss.com)**
2. **اشترك في Advanced plan** ($9.95/شهر) من [fetchrss.com/prices](https://fetchrss.com/prices)
3. **أنشئ feed لكل صفحة:**
   - Dashboard → **Create Feed**
   - الصق رابط الصفحة (مثال: `facebook.com/aljazeerachannel`)
   - اضغط Create
   - انسخ **RSS URL** (شكلها: `fetchrss.com/rss/XXX.xml`)
4. **في الواجهة:** "📄 إدارة الصفحات":
   - في حقل URL: الصق الـ **RSS URL** (مش Facebook URL)
   - في المصدر: اختر `fetchrss`
   - اضغط حفظ
5. **فعّل في `config.yml`:**
   ```yaml
   sources:
     - name: fetchrss
       enabled: true
       priority: 2
   ```

**⚠️ تنبيه:** بعض الصفحات الخاصة ما تدعمها FetchRSS. جرّب أول صفحة قبل الاشتراك.

---

### ⚡ RSS.app

**المميزات:**
- ✅ تحديث أسرع من FetchRSS
- ✅ API للإدارة البرمجية
- ✅ Webhooks

**الخطوات:**

1. **سجّل في [rss.app](https://rss.app)**
2. **اشترك في Developer plan** ($16.64/شهر) - 100 feed
3. **أنشئ feed:** نفس خطوات FetchRSS
4. **انسخ RSS URL** (شكلها: `rss.app/feeds/XXX.xml`)
5. **في الواجهة:** استخدم RSS URL كـ page URL، واختر `rssapp` كمصدر

---

### 🏠 RSSHub (مفتوح المصدر)

**المميزات:**
- ✅ مفتوح المصدر بالكامل
- ✅ مجاني (public instance) أو رخيص (VPS)
- ✅ بدون حدود على عدد الصفحات
- ✅ يدعم مئات المواقع (فيسبوك + تويتر + إنستغرام...)

**خيار 1: Public Instance (مجاني - بطيء)**

```yaml
sources:
  - name: rsshub
    enabled: true
    base_url: "https://rsshub.app"
```

**خيار 2: Self-hosted على VPS (موصى به)**

1. **استأجر VPS:**
   - [Hetzner CX11](https://www.hetzner.com/cloud) - €4.51/شهر
   - أو [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) - مجاني دائماً
2. **ثبّت Docker** على VPS
3. **شغّل RSSHub:**
   ```bash
   docker run -d --name rsshub -p 1200:1200 --restart unless-stopped diygod/rsshub
   ```
4. **في `config.yml`:**
   ```yaml
   sources:
     - name: rsshub
       enabled: true
       base_url: "http://YOUR_VPS_IP:1200"
   ```
5. **في الواجهة:** احتفظ بـ Facebook URL الأصلي (RSSHub يحولها تلقائياً)

📚 توثيق: [docs.rsshub.app](https://docs.rsshub.app/en/routes/social-media#facebook)

---

### 🎭 Playwright (مجاني لكن غير موثوق)

**⚠️ مهم جداً:** هذا المصدر للتجربة فقط. فيسبوك بيحظر GitHub IPs.

**نسب النجاح المتوقعة:**
- صفحة عامة كبيرة (مثل قناة إخبارية): 40-60%
- صفحة صغيرة: 60-80%
- لو تم حظر GitHub IPs: 0%

**الاستخدام الموصى به:**
- للتجربة قبل الدفع
- 1-3 صفحات كحد أقصى
- تشغيل كل 6-12 ساعة (مش أكثر)

**الخطوات:**

1. في `config.yml`:
   ```yaml
   sources:
     - name: playwright
       enabled: true
       headless: true
       scroll_pause_seconds: 2.5
   ```
2. GitHub Actions راح يثبّت Chromium تلقائياً
3. في الواجهة: استخدم Facebook URL الأصلي، اختر `playwright` كمصدر

---

## 5. إضافة الصفحات

من واجهة المشروع نفسها (بدون تعديل ملفات):

### الطريقة 1: من الواجهة (الأسهل)

1. افتح موقعك على GitHub Pages
2. اضغط زر **📄** (إدارة الصفحات) في الأعلى
3. اضغط **"+ إضافة صفحة"**
4. املأ:
   - **الاسم:** بالعربي (مثل: "قناة الجزيرة")
   - **الرابط:** Facebook URL أو RSS URL (حسب المصدر)
   - **Slug:** يتولد تلقائياً (أو اكتبه بالإنجليزية)
   - **حد أقصى للمنشورات:** 30 (أو أي رقم من 1-500)
   - **المصدر:** تلقائي أو حدّد (apify/fetchrss/...)
   - **التفعيل:** (زرار أخضر)
5. اضغط:
   - **"حفظ محلياً"** للحفظ في متصفحك فقط
   - **"حفظ في GitHub"** لحفظ pages.json في الريبو (يحتاج token)

### الطريقة 2: تعديل pages.json مباشرة

افتح `pages.json` في الريبو وأضف:

```json
{
  "pages": [
    {
      "slug": "aljazeera",
      "name": "قناة الجزيرة",
      "url": "https://www.facebook.com/aljazeerachannel",
      "max_posts": 30,
      "source": "auto",
      "enabled": true,
      "tags": ["news"]
    }
  ]
}
```

---

## 6. نطاق التاريخ للسحب

### للسحب الأوتوماتيكي (cron):

في `pages.json`، أضف `date_from` و/أو `date_to` لأي صفحة:

```json
{
  "slug": "aljazeera",
  "name": "قناة الجزيرة",
  "url": "https://www.facebook.com/aljazeerachannel",
  "max_posts": 50,
  "date_from": "2026-04-01",
  "date_to": "2026-04-30"
}
```

### للتشغيل اليدوي:

من الواجهة: زر **"سحب الآن"** → راح تختار صفحة ومصدر (بدون تاريخ حالياً من UI، لكن ممكن محلياً):

```bash
python scripts/run.py --date-from 2026-04-01 --date-to 2026-04-30
python scripts/run.py --slug aljazeera --date-from 2026-04-01
```

### للفلترة في الواجهة (على البيانات الموجودة):

1. في الصفحة الرئيسية → اضغط **"فلاتر متقدمة"**
2. حدّد **"من تاريخ"** و**"إلى تاريخ"**
3. المنشورات راح تتفلتر فوراً

---

## 7. تنبيهات Telegram (اختياري)

تستقبل إشعارات عند ظهور منشور عالي التفاعل أو يحتوي كلمات معينة.

### الخطوات:

1. **أنشئ bot:**
   - افتح [@BotFather](https://t.me/BotFather) في Telegram
   - أرسل `/newbot`
   - اختار اسم (مثال: Marsad Bot)
   - احفظ الـ **token** (شكل: `1234567:ABC...`)

2. **احصل على chat_id:**
   - افتح [@userinfobot](https://t.me/userinfobot) وأرسل `/start`
   - احفظ الـ **id** (رقم)

3. **أضف Secrets في GitHub:**
   - `TELEGRAM_BOT_TOKEN` = (الـ token)
   - `TELEGRAM_CHAT_ID` = (الـ id)

4. **فعّل في `config.yml`:**
   ```yaml
   alerts:
     telegram:
       enabled: true
       high_engagement_threshold: 5000  # منشورات فوق 5K تفاعل
       keywords:                         # كلمات تستدعي تنبيه
         - "غزة"
         - "القدس"
         - "الأقصى"
   ```

الآن راح يوصلك تنبيه كل ما يلقى منشور مطابق.

---

## 8. استكشاف الأخطاء

### ❌ الـ workflow يفشل

**تحقق من:**
- [ ] الـ Secret المطلوب موجود (APIFY_TOKEN/إلخ)
- [ ] المصدر مفعّل في `config.yml`
- [ ] الصفحات عندها `enabled: true`

**اطلع على الـ logs:**
GitHub → Actions → اختر آخر تشغيل → اقرأ تفاصيل الأخطاء.

### ❌ لا تظهر منشورات

**جرب:**
1. شغّل workflow يدوياً من Actions
2. انتظر 5 دقائق
3. حدّث الصفحة (Ctrl+F5)
4. لو لسا ما ظهر، افحص `web/data/index.json` في الريبو

### ❌ Playwright timeout

فيسبوك بيحجب. جرب:
- قلّل `max_posts` لـ 10-20
- زد `scroll_pause_seconds` لـ 4-5
- استخدم مصدر آخر (Apify/FetchRSS)

### ❌ FetchRSS: نفس المنشورات كل مرة

- تذكّر: تحديث FB feeds كل **3-6 ساعات**
- لا تشغّل workflow أكثر من كل 6 ساعات مع FetchRSS

### ❌ خطأ 403 في GitHub Pages

- Settings → Pages → Source = **GitHub Actions** (ليس main branch)

### ❌ ما في فرق بين "auto" والمصادر الأخرى

- `auto` = جرّب المصادر حسب priority في `config.yml`
- حدّد مصدر = استخدم هذا المصدر أولاً ثم fallback للباقي

---

## 🎓 نصائح للاستخدام الأمثل

1. **ابدأ بصفحة واحدة** واختبر قبل إضافة 50 صفحة
2. **راقب الـ Actions tab** أول أسبوع للتأكد من نجاح workflows
3. **احفظ Secrets في مكان آمن** (مثل 1Password)
4. **لا تستخدم حسابك الشخصي** لأي scraping — Apify وFetchRSS يستخدمون حساباتهم
5. **للـ 50+ صفحة:** استخدم **Apify** فقط — RSS services راح تكون بطيئة

---

## 📞 المساعدة

- 🐛 [فتح Issue](https://github.com/AsemAbbas/facebook_scraper/issues/new)
- 📖 [README الرئيسي](README.md)
- 💬 نقاشات: [GitHub Discussions](https://github.com/AsemAbbas/facebook_scraper/discussions)

---

**✨ تم!** بعد إتباع هذا الدليل، راح يكون عندك مرصد شغّال تلقائياً بدون أي صيانة.
