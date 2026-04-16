# 🔍 مَرصَد · Multi-Source Facebook Monitor

> أداة مرنة لرصد منشورات صفحات فيسبوك العامة · تدعم **5 مصادر مختلفة** قابلة للتبديل بإعداد واحد

![Arabic](https://img.shields.io/badge/الواجهة-عربية-orange)
![Python](https://img.shields.io/badge/Python-3.11+-blue)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ لماذا هذا المشروع؟

حلول Facebook scraping العادية تفشل لأن:
- ❌ GitHub Actions IPs محظورة من فيسبوك
- ❌ Login wall صار صارم جداً
- ❌ DOM selectors تتغير باستمرار

**الحل:** هذا المشروع يوفر **5 مصادر** قابلة للتبديل:

| المصدر | التكلفة | الموثوقية | التفاعلات | الصيانة |
|--------|---------|-----------|-----------|---------|
| 💎 **Apify** | $49/شهر | 🟢 90%+ | ✅ | 🟢 صفر |
| 🪶 **FetchRSS** | $9.95/شهر | 🟢 95%+ | ❌ | 🟢 صفر |
| ⚡ **RSS.app** | $16.64/شهر | 🟢 95%+ | ❌ | 🟢 صفر |
| 🏠 **RSSHub** | ~$4/شهر (self-hosted) | 🟡 80% | ❌ | 🟡 متوسطة |
| 🎭 **Playwright** | مجاني | 🔴 40-60% | ✅ | 🔴 عالية |

تقدر تستخدم **أي مصدر** أو **عدة مصادر مع fallback** — بس بدّل flag في `config.yml`.

---

## 🚀 البدء السريع (5 دقائق)

### 1. Clone الريبو

```bash
git clone https://github.com/YOUR_USERNAME/marsad.git
cd marsad
```

### 2. عدّل الصفحات في `pages.json`

```json
{
  "pages": [
    {
      "slug": "aljazeera",
      "name": "قناة الجزيرة",
      "url": "https://www.facebook.com/aljazeerachannel",
      "max_posts": 30,
      "source": "auto",
      "enabled": true
    }
  ]
}
```

### 3. اختر مصدر (في `config.yml`)

غيّر `enabled: true` للمصدر اللي تبغى. الافتراضي هو `playwright` (مجاني).

### 4. فعّل GitHub Pages

- Settings → Pages → Source: **GitHub Actions**

### 5. أضف الـ Secrets (حسب المصدر المختار)

Settings → Secrets and variables → Actions → New secret:

| Secret | متى تحتاجه |
|--------|-----------|
| `APIFY_TOKEN` | لو تستخدم Apify |
| `FETCHRSS_API_KEY` | لو تستخدم FetchRSS |
| `RSSAPP_API_KEY` | لو تستخدم RSS.app |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | للتنبيهات (اختياري) |

### 6. شغّل Workflow أول مرة

- Actions → "Marsad · Scrape Facebook Pages" → Run workflow

### 7. افتح الموقع

`https://YOUR_USERNAME.github.io/marsad/`

---

## 📚 إعداد كل مصدر بالتفصيل

### 💎 Apify (الأفضل جودة)

**لماذا Apify؟** تفاعلات دقيقة + تعليقات + residential proxies + صفر صيانة.

1. سجّل في [apify.com](https://apify.com) (مجاني ابتداءً)
2. من [Console](https://console.apify.com/account/integrations) انسخ الـ API token
3. أضف `APIFY_TOKEN` كـ GitHub Secret
4. في `config.yml`:
   ```yaml
   - name: apify
     enabled: true
     priority: 1
     token: ${APIFY_TOKEN}
     actor_id: "apify/facebook-posts-scraper"
   ```

**التكلفة:** $5 credits مجانية شهرياً ($49/شهر للـ Starter).

---

### 🪶 FetchRSS (الأرخص)

**لماذا FetchRSS؟** رخيص جداً ($9.95/شهر) لـ 100 feed.

1. سجّل في [fetchrss.com](https://fetchrss.com)
2. أنشئ feed لكل صفحة فيسبوك (يدوياً من لوحة التحكم)
3. في `pages.json`، ضع feed URL في `url` (بدلاً من Facebook URL):
   ```json
   {
     "slug": "aljazeera",
     "name": "الجزيرة",
     "url": "https://fetchrss.com/rss/ABC123.xml",
     "source": "fetchrss"
   }
   ```
4. في `config.yml`:
   ```yaml
   - name: fetchrss
     enabled: true
     priority: 2
   ```

⚠️ **تنبيه:** FetchRSS يحدّث Facebook feeds كل 3-6 ساعات (قيد من فيسبوك).

---

### ⚡ RSS.app (سرعة أعلى)

مشابه لـ FetchRSS لكن أسرع تحديثاً وأكثر مرونة.

1. سجّل في [rss.app](https://rss.app)
2. أنشئ feed لكل صفحة
3. احفظ feed URL في `pages.json`
4. في `config.yml`:
   ```yaml
   - name: rssapp
     enabled: true
   ```

**التكلفة:** $16.64/شهر (Developer plan, 100 feeds).

---

### 🏠 RSSHub (مفتوح المصدر - مجاني)

**لماذا RSSHub؟** مجاني، مفتوح المصدر، بدون حدود.

**خيار 1: الـ instance العام**
```yaml
- name: rsshub
  enabled: true
  base_url: "https://rsshub.app"
```

**خيار 2: Self-hosted (موصى به)**
```bash
# على VPS (Hetzner CX11 بـ €4/شهر)
docker run -d --name rsshub -p 1200:1200 diygod/rsshub
```

ثم في `config.yml`:
```yaml
- name: rsshub
  enabled: true
  base_url: "https://your-vps-ip:1200"
```

📚 [RSSHub Facebook docs](https://docs.rsshub.app/en/routes/social-media#facebook)

---

### 🎭 Playwright (المجاني - غير موثوق)

للتجربة أو المشاريع الصغيرة.

1. في `config.yml`:
   ```yaml
   - name: playwright
     enabled: true
   ```
2. GitHub Actions راح يثبّت Chromium تلقائياً

⚠️ **تنبيه:** Facebook بيحظر GitHub IPs بسرعة. متوقع نسبة فشل 40-60%.

---

## 🎛️ Hybrid Mode (كل صفحة بمصدر مختلف)

```json
{
  "pages": [
    {
      "slug": "important_page",
      "url": "https://facebook.com/important",
      "source": "apify"
    },
    {
      "slug": "secondary_page",
      "url": "https://fetchrss.com/rss/XYZ.xml",
      "source": "fetchrss"
    }
  ]
}
```

---

## 🔄 Fallback التلقائي

لو مصدر فشل، ينتقل للي بعده حسب `priority`:

```yaml
fallback:
  enabled: true
  max_attempts: 3
  retry_delay_seconds: 5
```

**مثال:** Apify (priority=1) فشل → FetchRSS (priority=2) نجح ✅

---

## 🔔 التنبيهات على Telegram (اختياري)

1. أنشئ bot من [@BotFather](https://t.me/BotFather)
2. احصل على `chat_id` من [@userinfobot](https://t.me/userinfobot)
3. أضف `TELEGRAM_BOT_TOKEN` و `TELEGRAM_CHAT_ID` كـ secrets
4. فعّل في `config.yml`:
   ```yaml
   alerts:
     telegram:
       enabled: true
       high_engagement_threshold: 5000
       keywords: ["غزة", "القدس"]
   ```

---

## 🏃 التشغيل المحلي

```bash
# 1. ثبّت
pip install -r requirements.txt
playwright install chromium  # لو تستخدم Playwright

# 2. أضف متغيرات البيئة (لو تستخدم APIs)
export APIFY_TOKEN="your_token"
# أو في .env (لا ترفعه!)

# 3. شغّل
python scripts/run.py                    # كل الصفحات
python scripts/run.py --slug aljazeera   # صفحة واحدة
python scripts/run.py --source apify     # إجبار مصدر
```

---

## 📂 هيكل المشروع

```
marsad/
├── .github/workflows/
│   ├── scrape.yml              # سحب تلقائي كل 6 ساعات
│   └── deploy.yml              # نشر على GitHub Pages
├── scrapers/                   # 🔌 Plugin-based sources
│   ├── base.py                 # Abstract base class
│   ├── normalizer.py           # أدوات التنظيف
│   ├── apify_source.py
│   ├── fetchrss_source.py
│   ├── rssapp_source.py
│   ├── rsshub_source.py
│   └── playwright_source.py
├── scripts/
│   ├── run.py                  # Orchestrator رئيسي
│   └── telegram_notify.py      # تنبيهات (اختياري)
├── web/                        # الواجهة (GitHub Pages)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── data/                   # ملفات JSON تُحدّث تلقائياً
├── docs/                       # أرشيف النسخ القديمة
├── config.yml                  # 🎛️ لوحة التحكم المركزية
├── pages.json                  # قائمة الصفحات
├── requirements.txt
└── README.md
```

---

## ⚙️ الـ Schema الموحّد

كل مصدر يرجع نفس الشكل (الواجهة ما يهمها المصدر):

```json
{
  "post_id": "unique_id",
  "page_slug": "aljazeera",
  "page_name": "قناة الجزيرة",
  "page_url": "https://facebook.com/aljazeerachannel",
  "text": "نص المنشور...",
  "post_url": "https://facebook.com/...",
  "image_url": "https://...",
  "video_url": "",
  "published_at": "2026-04-16T10:30:00Z",
  "scraped_at": "2026-04-16T12:00:00Z",
  "reactions": 1234,
  "comments": 56,
  "shares": 23,
  "source": "apify"
}
```

---

## 🎨 ميزات الواجهة

- ✅ **بحث فوري** في نصوص المنشورات
- ✅ **فلترة** حسب الصفحة والمصدر والحد الأدنى للتفاعل
- ✅ **ترتيب** (أحدث / أعلى تفاعل / أكثر تعليقات / أكثر مشاركة)
- ✅ **تصدير CSV** بكبسة واحدة
- ✅ **Badge المصدر** في كل منشور (تعرف من وين جت البيانات)
- ✅ **تصميم RTL عربي** مع خطوط Reem Kufi / Amiri
- ✅ **PWA-ready** (يمكن تحويله لتطبيق)

---

## ⚠️ تحذيرات قانونية

- 🚫 سحب فيسبوك يخالف **شروط الخدمة**
- ✅ استخدم فقط للأغراض **البحثية والصحفية**
- 🚫 لا تسحب صفحات خاصة
- ⏱️ احترم rate limits
- 👤 لا تستخدم حسابك الشخصي للسحب

---

## 🐛 مشاكل شائعة

| المشكلة | الحل |
|---------|------|
| `source not available` | تأكد من أن token موجود في GitHub Secrets |
| `no posts returned` | جرّب مصدر آخر (Facebook قد يكون حظر الـ IP) |
| `playwright timeout` | زد `scroll_pause_seconds` في config.yml |
| `rate limit` | قلّل التوتر في cron أو نقّص `max_posts` |
| الصفحة لا تعرض بيانات | تأكد من تشغيل workflow مرة واحدة على الأقل |

---

## 📊 مقارنة سريعة بالأرقام (50 صفحة)

| السيناريو | التكلفة/شهر | تحديث | تفاعلات |
|----------|-------------|--------|---------|
| Apify Starter | $49 | كل ساعة | ✅ |
| FetchRSS Advanced | $9.95 | 3-6 ساعات | ❌ |
| RSS.app Developer | $16.64 | 3-6 ساعات | ❌ |
| RSSHub (VPS) | ~$4 | حسب إعدادك | ❌ |
| Playwright (مجاني) | $0 | حسب cron | ✅ لكن غير موثوق |

---

## 📄 الترخيص

MIT - مفتوح المصدر بالكامل.

---

## 🤝 المساهمة

PRs مرحّب بها! خصوصاً:
- إضافة مصادر جديدة (مثل Bright Data، SocialBee)
- تحسين جودة السحب
- ترجمات لغات أخرى

---

صُنع بـ ❤️ للصحافة والبحث الإعلامي
