# 🌐 رفع مَرصَد على cPanel - دليل شامل

> دليل مصوّر خطوة بخطوة لرفع المشروع على استضافة cPanel.
> الوقت المتوقع: **15-30 دقيقة**.

---

## ✅ المتطلبات

- استضافة cPanel تدعم:
  - ✅ **Python 3.8+** (تحت "Setup Python App")
  - ✅ **MySQL / MariaDB**
  - ⚠️ Playwright **لن يعمل** على cPanel - استخدم Apify / FetchRSS

---

## 🗂️ الخطوات

### 1️⃣ إنشاء قاعدة البيانات (2 دقيقة)

1. افتح cPanel → **MySQL® Databases**
2. **Create New Database:** اكتب اسم (مثل `marsad`) → **Create Database**
   - الاسم الفعلي سيكون `username_marsad`
3. **Add New User:** أنشئ مستخدم (مثل `marsad_user`) → كلمة سر قوية → **Create User**
   - الاسم الفعلي سيكون `username_marsad_user`
4. **Add User To Database:** اختر المستخدم والـ DB → **ALL PRIVILEGES** → Submit

📝 **احفظ:**
- DB Name: `username_marsad`
- DB User: `username_marsad_user`
- DB Password: `******`

---

### 2️⃣ رفع الملفات (5 دقائق)

**الطريقة الأسهل: File Manager**
1. cPanel → **File Manager**
2. روح إلى `public_html/` (أو مجلد فرعي مثل `public_html/marsad/`)
3. اضغط **Upload** → ارفع ملف `.zip` لكامل المشروع
4. بعد الرفع: Right-click → **Extract**
5. تأكد أن الملفات في مكانها (مش داخل مجلد إضافي)

**أو عبر Git:**
1. cPanel → **Git Version Control** → **Create**
2. URL: `https://github.com/AsemAbbas/facebook_scraper.git`
3. Repository Path: `/home/USER/marsad`
4. Clone

---

### 3️⃣ إنشاء Python App (3 دقائق)

1. cPanel → **Setup Python App** (أو Python Selector)
2. **Create Application:**

| الحقل | القيمة |
|------|---------|
| **Python version** | 3.11 أو أحدث |
| **Application root** | `marsad` (أو مسار الملفات) |
| **Application URL** | `marsad.yourdomain.com` أو `yourdomain.com/marsad` |
| **Application startup file** | `passenger_wsgi.py` |
| **Application Entry point** | `application` |

3. اضغط **Create**

---

### 4️⃣ تثبيت المكتبات (5 دقائق)

في صفحة الـ Python App اللي أنشأتها:

1. انسخ الأمر اللي بيبان تحت **"Enter to the virtual environment"**
   (شكله: `source /home/USER/virtualenv/marsad/3.11/bin/activate`)

2. افتح cPanel → **Terminal** (لو غير متاح، افتح SSH)

3. الصق الأمر + Enter (بيدخلك للـ virtualenv)

4. الصق الأوامر:
   ```bash
   cd ~/marsad
   pip install -r requirements.txt
   ```

5. انتظر التثبيت (2-3 دقائق)

---

### 5️⃣ ضبط ملف .env (2 دقيقة)

في File Manager:
1. روح إلى مجلد المشروع
2. ابحث عن `.env.example`
3. Right-click → **Copy** → اسم الملف الجديد: `.env`
4. Right-click على `.env` → **Edit**
5. عدّل القيم:

```env
MARSAD_DB_HOST=localhost
MARSAD_DB_PORT=3306
MARSAD_DB_NAME=username_marsad
MARSAD_DB_USER=username_marsad_user
MARSAD_DB_PASSWORD=your_password_here
```

6. Save

---

### 6️⃣ إعادة تشغيل التطبيق (30 ثانية)

1. ارجع لصفحة **Setup Python App**
2. اضغط **Restart** بجانب تطبيقك
3. افتح الرابط: `yourdomain.com/marsad`

✅ **لو ظهر لك شاشة التسجيل → التطبيق شغّال!**

---

### 7️⃣ إنشاء أول حساب (30 ثانية)

أول مستخدم يسجّل = **admin تلقائياً**.

1. في الواجهة: اضغط **"تسجيل حساب جديد"**
2. اسم المستخدم + كلمة سر + إيميل
3. اضغط **Register**
4. انت الآن مسجّل دخول كـ admin

---

## 🎯 ماذا بعد؟

### تفعيل مصدر السحب

**الموصى به لـ cPanel:** Apify (أفضل جودة) أو FetchRSS (الأرخص).

**⚠️ Playwright لا يعمل على cPanel** لأنه يحتاج Chromium (غير متاح على الاستضافة المشتركة).

#### Apify (الأفضل)
1. في الواجهة → الإعدادات → Apify
2. اضغط "إنشاء حساب" → [apify.com](https://apify.com)
3. انسخ API token من Settings → Integrations
4. الصقه في الإعدادات → فعّل → احفظ

#### FetchRSS (الأرخص)
1. في الواجهة → الإعدادات → FetchRSS → فعّل
2. في [fetchrss.com](https://fetchrss.com) أنشئ feed لكل صفحة
3. الصق رابط الـ RSS في حقل "رابط الصفحة" عند إضافة الصفحة

---

## 🐛 حل المشاكل الشائعة

### ❌ 500 Internal Server Error
- افتح cPanel → **Metrics** → **Errors**
- شوف آخر خطأ

**الأسباب الشائعة:**
1. ملف `.env` مش موجود أو فيه خطأ
2. قاعدة البيانات غير متصلة → تأكد من البيانات في `.env`
3. المكتبات مش مثبّتة → شغّل `pip install -r requirements.txt` في الـ virtualenv

### ❌ "Database connection failed"
- تأكد من:
  - DB موجودة في cPanel → MySQL Databases
  - المستخدم مضاف للـ DB بصلاحيات ALL
  - البيانات صحيحة في `.env`
  - اسم DB مع prefix الـ username (مثل `username_marsad`)

### ❌ التطبيق شغّال لكن بطيء جداً
- Playwright مش راح يشتغل على cPanel (ما عنده Chromium)
- استخدم Apify أو FetchRSS للسحب (sources خارجية)

### ❌ Passenger Timeout
- السحب ياخذ وقت → استخدم jobs في الخلفية (مفعّل بالفعل)
- لكن على الـ shared hosting، الـ threads قد تُقطع عند Timeout الـ request
- الحل: استخدم Apify (يشتغل على servers خارجية، نحن فقط نقرأ النتائج)

### ❌ خطأ في الـ Session
- احذف مجلد `database/` من السيرفر → أعد التشغيل
- هذا يولّد secret جديد

---

## 🔒 الأمان

1. **غيّر كلمة سر الـ admin** بعد أول تسجيل
2. **لا تشارك ملف .env** - فيه كلمة سر DB
3. **استخدم HTTPS** - cPanel → SSL/TLS → Let's Encrypt مجاني
4. **backup دوري** - cPanel → Backup Wizard

---

## 📊 Cron Jobs (اختياري - للسحب التلقائي)

لتشغيل سحب تلقائي كل 6 ساعات:

1. cPanel → **Cron Jobs**
2. أضف جديد:

```
0 */6 * * * cd /home/USER/marsad && /home/USER/virtualenv/marsad/3.11/bin/python scripts/run.py 2>&1 > /dev/null
```

(عدّل المسارات حسب استضافتك)

---

## 🆘 لو لسا في مشكلة

- ابعت lines اللي ظاهرة في **cPanel → Metrics → Errors**
- أو افتح [GitHub Issues](https://github.com/AsemAbbas/facebook_scraper/issues)

---

✨ **انتهيت!** الآن عندك مَرصَد يعمل على cPanel بـ MySQL.
