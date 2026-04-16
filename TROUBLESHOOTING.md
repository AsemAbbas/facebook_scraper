# 🛠️ استكشاف الأخطاء وإصلاحها

دليل لحل أكثر المشاكل شيوعاً في مَرصَد.

---

## 🔴 مشكلة #1: GitHub Actions تفشل في 2-5 ثواني

**الأعراض:**
- كل workflow runs تفشل فوراً
- `The job was not started because your account is locked due to a billing issue`
- لا يظهر أي steps في الـ run

**السبب:** GitHub قفل حسابك بسبب billing.

### ✅ الحل (خطوات بالترتيب)

#### 1. افحص spending limit
[github.com/settings/billing/spending_limit ↗](https://github.com/settings/billing/spending_limit)

- لو الـ limit = $0 → غيّره لـ $1+ أو unlimited
- (مع ريبو public، ما راح يتم تحصيلك مهما زاد الاستخدام)

#### 2. افحص الفواتير المفتوحة
[github.com/settings/billing ↗](https://github.com/settings/billing)

- لو في invoice مفتوحة، ادفعها
- لو في Marketplace subscription غير ضرورية، ألغها

#### 3. تأكد من أن الريبو public
- Settings → General → نزل لتحت → "Repository visibility"
- لو private + الحساب free → غيّره لـ public

#### 4. تأكد من الـ Actions enabled
- Settings → Actions → General → "Allow all actions and reusable workflows"

#### 5. أعد تشغيل آخر workflow run
- Actions → اختر آخر run فاشل → **Re-run all jobs**

---

## 🔴 مشكلة #2: GitHub Pages يعرض 404

### ✅ الحل
1. Settings → **Pages** → Source: **GitHub Actions** (وليس "Deploy from a branch")
2. شغّل workflow `Deploy` يدوياً من Actions
3. انتظر 2-3 دقائق
4. افتح `https://[username].github.io/facebook_scraper/`

---

## 🔴 مشكلة #3: Playwright يفشل على GitHub Actions

**الأعراض:** workflow يشتغل لكن Playwright يرجع 0 منشور أو timeout.

**السبب:** فيسبوك حاجب IPs الخاصة بـ GitHub Actions.

### ✅ الحلول
- **الأفضل:** انتقل لـ **Apify** ($5 مجاني/شهر) - يستخدم residential IPs
- **بديل:** شغّل السحب محلياً من جهازك (انظر أسفل ↓)

---

## 🟢 الحل القاطع: تشغيل السحب محلياً

لو GitHub Actions ما يشتغل لأي سبب، تقدر تشغّل السحب من جهازك.

### الإعداد (مرة واحدة فقط)

```bash
# 1. ثبّت Python (لو ما عندك)
# Windows: من microsoft store أو python.org
# Mac:     brew install python
# Linux:   sudo apt install python3

# 2. ثبّت dependencies
pip install pyyaml aiohttp playwright

# 3. ثبّت Chromium
python -m playwright install chromium
```

### التشغيل

#### Windows (الأسهل)
**انقر مرتين على `run.bat`** في مجلد المشروع.

أو من Command Prompt:
```cmd
run.bat                    REM سحب لمرة واحدة + push
run.bat loop               REM تشغيل دوري كل 6 ساعات
```

#### Mac / Linux
```bash
python scripts/local_run.py             # مرة واحدة
python scripts/local_run.py --loop 360  # كل 6 ساعات
```

#### خيارات متقدمة
```bash
# سحب صفحة واحدة فقط
python scripts/local_run.py --slug aljazeera

# مصدر محدد
python scripts/local_run.py --source apify

# نطاق تاريخ
python scripts/local_run.py --date-from 2026-04-01 --date-to 2026-04-16

# سحب فقط بدون push للـ GitHub
python scripts/local_run.py --no-push
```

### التشغيل التلقائي على Windows

#### الطريقة 1: Task Scheduler
1. افتح **Task Scheduler**
2. **Create Basic Task** → "Marsad Scrape"
3. Trigger: Daily، كل 6 ساعات
4. Action: **Start a program**
5. Program: `C:\laragon\www\facebook_scraper\run.bat`
6. احفظ

#### الطريقة 2: شغّل run.bat loop وسيبه شغّال
ينفّذ كل 6 ساعات تلقائياً (يحتاج جهازك يبقى شغّال).

### التشغيل التلقائي على Mac / Linux

أضف cron job:
```bash
crontab -e

# أضف السطر:
0 */6 * * * cd /path/to/marsad && /usr/bin/python3 scripts/local_run.py >> /tmp/marsad.log 2>&1
```

---

## 🌐 بديل: Cloudflare Pages

لو GitHub Pages عندك مشاكل، Cloudflare Pages بديل ممتاز:

### ✅ المزايا
- مجاني تماماً (لا حدود)
- نشر أسرع بكثير
- CDN عالمي
- لا billing issues

### الإعداد (5 دقائق)
1. سجّل في [pages.cloudflare.com](https://pages.cloudflare.com)
2. **Create a project** → **Connect to Git**
3. اختر `AsemAbbas/facebook_scraper`
4. Build settings:
   - Framework preset: **None**
   - Build command: (فاضي)
   - Build output directory: **`web`**
5. **Save and Deploy**

موقعك راح يكون على: `https://facebook-scraper.pages.dev/`

كل push للـ main راح ينشر تلقائياً.

---

## 🤝 المساعدة

لو لسا في مشكلة:
1. افحص logs في GitHub Actions
2. شغّل محلياً وشوف الـ errors
3. افتح [Issue على GitHub](https://github.com/AsemAbbas/facebook_scraper/issues/new)
