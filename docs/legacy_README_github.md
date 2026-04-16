# 🔍 مَرصَد · Facebook Pages Monitor

أداة كاملة لرصد منشورات صفحات فيسبوك العامة، مع واجهة ويب جميلة، تعمل بالكامل عبر **GitHub Actions + GitHub Pages** بدون أي خادم.

## ✨ المزايا

- 🌐 **واجهة عربية أنيقة** بتصميم صحفي على GitHub Pages
- 🤖 **سحب تلقائي** كل ساعتين عبر GitHub Actions
- ⚡ **زر "سحب الآن"** يشغّل workflow من الواجهة مباشرة
- 🔍 بحث وفلترة وفرز فوري
- 📊 إحصاءات فورية (تفاعلات، تعليقات، مشاركات)
- 📥 تصدير CSV
- 🚫 لا حاجة لخادم أو قاعدة بيانات
- 💰 **مجاني 100%** (في حدود GitHub Free tier)

## 🏗️ المعمارية

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  GitHub Actions │────▶│   web/data/*.json│────▶│ GitHub Pages│
│  (Playwright)   │     │   (في الريبو)    │     │  (الواجهة)  │
└─────────────────┘     └──────────────────┘     └─────────────┘
        ▲                                                │
        │                                                │
        └────────── workflow_dispatch API ◀──────────────┘
                    (زر "سحب الآن")
```

## 🚀 خطوات الإعداد (10 دقائق)

### 1. إنشاء الريبو

```bash
# على جهازك أو مباشرة في GitHub
git init fb-monitor
cd fb-monitor
# انسخ كل ملفات هذا المشروع
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/fb-monitor.git
git push -u origin main
```

> **تلميح للتابلت**: استخدم تطبيق GitHub أو [github.dev](https://github.dev) (محرر VSCode في المتصفح) لإنشاء الريبو ورفع الملفات بدون كمبيوتر.

### 2. تعديل الصفحات المراد رصدها

عدّل `pages.json`:

```json
{
  "pages": [
    {
      "slug": "wattan",
      "name": "وطن",
      "url": "https://www.facebook.com/WattanNews",
      "max_posts": 30
    }
  ]
}
```

- `slug`: معرّف فريد بالإنجليزية (سيُستخدم في اسم ملف JSON)
- `name`: الاسم بالعربي (يظهر في الواجهة)
- `url`: رابط الصفحة على فيسبوك
- `max_posts`: عدد المنشورات لسحبها كل مرة

### 3. تفعيل GitHub Pages

من إعدادات الريبو:
1. **Settings** → **Pages**
2. Source: **GitHub Actions**

### 4. تفعيل GitHub Actions

من إعدادات الريبو:
1. **Settings** → **Actions** → **General**
2. Workflow permissions: اختر **Read and write permissions**
3. احفظ

### 5. التشغيل الأول

شغّل السحب يدوياً أول مرة:
1. اذهب إلى **Actions** في الريبو
2. اختر **"Facebook Pages Scraper"**
3. اضغط **"Run workflow"** → **Run workflow**
4. انتظر 3-5 دقائق
5. الموقع سيُنشر تلقائياً على: `https://YOUR_USERNAME.github.io/fb-monitor/`

## 🎮 الاستخدام اليومي من التابلت

افتح موقعك على Pages من التابلت. كل شيء يعمل من المتصفح:

- **تحديث الصفحة** → يجلب آخر بيانات
- **زر "سحب الآن"** → يفتح modal يطلب Personal Access Token مرة واحدة، ثم يشغّل workflow عند الطلب
- **التشغيل التلقائي** → يعمل كل ساعتين دون تدخل

### إنشاء Personal Access Token (لمرة واحدة)

1. [github.com/settings/tokens/new](https://github.com/settings/tokens/new?scopes=repo&description=marsad-trigger)
2. اختر صلاحية `repo` فقط
3. انسخ التوكن، الصقه في الموقع → سيُحفظ محلياً في متصفحك

## 📂 هيكل الملفات

```
fb-monitor/
├── .github/workflows/
│   ├── scrape.yml          # سحب البيانات (كل ساعتين)
│   └── deploy.yml          # نشر الواجهة على Pages
├── scraper/
│   ├── scraper.py          # السكريبت الرئيسي
│   └── requirements.txt
├── web/                     # الواجهة (تُنشر على Pages)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── data/               # ملفات JSON تُحدّث تلقائياً
│       ├── index.json
│       └── *.json
├── pages.json              # قائمة الصفحات المراد رصدها
└── README.md
```

## ⚙️ التخصيص

### إضافة صفحة جديدة
أضف عنصراً جديداً في `pages.json` ثم ادفع للـ main → سيُسحب تلقائياً في الجولة القادمة.

### تغيير وتيرة السحب
في `.github/workflows/scrape.yml`، عدّل cron:
- `'0 */2 * * *'` = كل ساعتين (الافتراضي)
- `'0 * * * *'` = كل ساعة
- `'0 */6 * * *'` = كل 6 ساعات

### تغيير الألوان والخطوط
كل المتغيرات في أول `web/style.css` تحت `:root`.

## ⚠️ تحذيرات قانونية

- سحب فيسبوك يخالف **شروط الخدمة**
- استخدمه فقط للأغراض **البحثية والصحفية**
- لا تسحب صفحات خاصة أو بمعدلات عالية
- فيسبوك قد يحظر IPs الخاصة بـ GitHub Actions في وقت ما (لا يوجد ضمان)

## 🐛 مشاكل شائعة

| المشكلة | الحل |
|---------|------|
| الـ workflow يفشل | افحص اللوغ في Actions → غالباً فيسبوك يطلب login |
| لا تظهر التفاعلات | فيسبوك يخفيها للزوار غير المسجلين أحياناً |
| الصفحة فارغة | تأكد من تشغيل workflow الأول وانتشار البيانات |
| 403 من Pages | تأكد من Settings → Pages → Source = GitHub Actions |

## 🔄 التطوير المستقبلي

أفكار للإضافة لاحقاً:
- تكامل مع Google Sheets (ربط مع مشروعك السابق)
- إرسال تنبيهات Telegram للمنشورات عالية التفاعل
- تحليل المشاعر بـ Groq API
- رسوم بيانية للتفاعل عبر الزمن
- مقارنة بين الصفحات

---

صُنع بـ ❤️ للصحافة والبحث الإعلامي
