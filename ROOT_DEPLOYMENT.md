# 🔧 نشر مَرصَد على VPS / cPanel بصلاحيات Root

> دليل شامل لمن عندهم **root access** لكن لا يظهر لهم **"Setup Python App"** في cPanel.

---

## 🔍 لماذا لا يظهر "Setup Python App"؟

"Setup Python App" يتطلب:
- **CloudLinux OS** + **Python Selector** (ليسنس مدفوع من CloudLinux)
- أو **EasyApache 4** مع mod_passenger

لو عندك root لكن هذا مش مفعّل، عندك **3 خيارات**.

---

# 🏆 الخيار 1 (الأسهل): Application Manager

**من الصورة اللي أرسلتها: لديك `Application Manager` في قسم Software.**
هذا **نفس** "Setup Python App" لكن باسم جديد في cPanel v94+.

### الخطوات:

#### 1. ادخل على Application Manager
cPanel → Software → **Application Manager**

#### 2. Create Application
| الحقل | القيمة |
|------|--------|
| **Application URL** | `marsad.yourdomain.com` أو `yourdomain.com/marsad` |
| **Application root** | `marsad` (اسم المجلد داخل الـ home) |
| **Environment** | اختر Python (3.11 أو أحدث) |
| **Startup file** | `passenger_wsgi.py` |
| **Application Entry point** | `application` |
| **Application URL** | حسب ما تريد |

#### 3. Enter Virtual Environment
في نفس الصفحة بيظهر أمر مثل:
```bash
source /home/USER/virtualenv/marsad/3.11/bin/activate
```

#### 4. افتح Terminal (cPanel → Advanced → Terminal) والصق:
```bash
source /home/USER/virtualenv/marsad/3.11/bin/activate
cd ~/marsad
pip install -r requirements.txt
```

#### 5. أنشئ `.env` من `.env.example`:
```bash
cp .env.example .env
nano .env
```
عدّل بيانات MySQL → احفظ (Ctrl+O) → اخرج (Ctrl+X)

#### 6. ارجع لـ Application Manager → **Restart**

#### 7. افتح الرابط في المتصفح → سجّل أول admin.

✅ **خلاص!**

---

# 🔧 الخيار 2: تفعيل Setup Python App بنفسك (root access)

إذا بدك يظهر "Setup Python App" تحت Software، تحتاج تثبّت الـ module.

### متطلبات:
- CentOS / AlmaLinux / Rocky Linux + cPanel
- WHM access (لازم يكون WHM مش cPanel بس)

### الأوامر (من SSH as root):

```bash
# 1. فعّل mod_passenger في EasyApache
/scripts/easyapache --build

# في الـ UI اختار:
#   Ruby via Passenger
#   Python via Passenger

# أو من CLI مباشرة:
yum install -y ea-ruby27-mod_passenger

# 2. فعّل Python Selector (لو CloudLinux)
# إذا عندك CloudLinux license:
cagefsctl --enable-cagefs
yum install -y alt-python311 alt-python-pip
cagefsctl --force-update

# 3. أعد تشغيل cPanel
/etc/init.d/cpanel restart
```

بعد ذلك "Setup Python App" راح يظهر في cPanel.

⚠️ **ملاحظة:** لو الاستضافة مش بتاعتك كـ provider، غالباً CloudLinux مش مفعّل. استخدم الخيار 1 أو 3.

---

# 🛠️ الخيار 3 (الأقوى): systemd service + nginx reverse proxy

**هذا الحل الأفضل للمحترفين - لا يعتمد على cPanel أبداً.**

### المميزات:
- ✅ يعمل حتى لو ما عندك cPanel Python support
- ✅ أسرع وأكثر استقراراً
- ✅ logs منظمة via systemd
- ✅ auto-restart عند الفشل

### الخطوات:

#### 1. ثبّت Python + pip (كـ root)
```bash
# CentOS/AlmaLinux/Rocky
dnf install -y python3.11 python3.11-pip python3.11-devel
# أو Ubuntu/Debian
apt install -y python3.11 python3.11-venv python3.11-dev
```

#### 2. انقل الملفات لمسار دائم
```bash
mkdir -p /opt/marsad
cd /opt/marsad
# ارفع الملفات هنا (rsync/git/scp)
git clone https://github.com/AsemAbbas/facebook_scraper.git .
chown -R nobody:nogroup /opt/marsad  # أو cpanel user
```

#### 3. أنشئ virtualenv وثبّت deps
```bash
cd /opt/marsad
python3.11 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

#### 4. أنشئ `.env`
```bash
cp .env.example .env
nano .env
# عدّل DB credentials حسب MySQL في cPanel
```

#### 5. أنشئ systemd service
```bash
nano /etc/systemd/system/marsad.service
```

الصق:
```ini
[Unit]
Description=Marsad Facebook Monitor
After=network.target mysql.service

[Service]
Type=simple
User=cpanel_user_here
Group=cpanel_user_here
WorkingDirectory=/opt/marsad
Environment="PATH=/opt/marsad/venv/bin"
Environment="NO_BROWSER=1"
Environment="HOST=127.0.0.1"
Environment="PORT=5050"
ExecStart=/opt/marsad/venv/bin/python /opt/marsad/server.py
Restart=always
RestartSec=5
StandardOutput=append:/var/log/marsad.log
StandardError=append:/var/log/marsad.log

[Install]
WantedBy=multi-user.target
```

> استبدل `cpanel_user_here` بـ username الحساب في cPanel (شغّل `whoami` داخل حسابك لمعرفته)

#### 6. شغّل الخدمة
```bash
systemctl daemon-reload
systemctl enable marsad
systemctl start marsad
systemctl status marsad   # تأكد من "active (running)"
```

تابع الـ logs:
```bash
tail -f /var/log/marsad.log
```

#### 7. أضف reverse proxy في cPanel

الآن مَرصَد يعمل على `127.0.0.1:5050` داخلياً. نحتاج نربطه بـ subdomain أو path.

##### خيار 7A: عبر `.htaccess` (أبسط - يعمل في public_html)

في `public_html/marsad/.htaccess`:
```apache
RewriteEngine On
RewriteRule ^(.*)$ http://127.0.0.1:5050/$1 [P,L]

ProxyPreserveHost On
ProxyRequests Off
<Proxy *>
    Order deny,allow
    Allow from all
</Proxy>
```

افتح: `yourdomain.com/marsad`

##### خيار 7B: عبر WHM Apache config (أضمن)

```bash
nano /etc/apache2/conf.d/userdata/std/2_4/cpanel_user/yourdomain.com/marsad_proxy.conf
```

الصق:
```apache
<Location /marsad>
    ProxyPass http://127.0.0.1:5050
    ProxyPassReverse http://127.0.0.1:5050
</Location>
```

```bash
/scripts/rebuildhttpdconf
/scripts/restartsrv_httpd
```

##### خيار 7C: عبر Nginx (الأسرع - لو مثبت Nginx)

```bash
nano /etc/nginx/conf.d/marsad.conf
```

```nginx
server {
    listen 443 ssl http2;
    server_name marsad.yourdomain.com;

    ssl_certificate /etc/ssl/certs/yourdomain.pem;
    ssl_certificate_key /etc/ssl/private/yourdomain.key;

    location / {
        proxy_pass http://127.0.0.1:5050;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE streaming support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }
}
```

```bash
nginx -t
systemctl reload nginx
```

#### 8. افتح الموقع وسجّل admin

---

# 📊 مقارنة الخيارات

| الخيار | الصعوبة | الأداء | يتطلب |
|--------|---------|--------|--------|
| 1. Application Manager | 🟢 سهل | جيد | cPanel v94+ |
| 2. Enable Python App | 🟡 متوسط | جيد | CloudLinux / EasyApache |
| 3. systemd + proxy | 🔴 متقدم | الأفضل | root + SSH |

**توصيتي:** إذا `Application Manager` يظهر لك، استخدم الخيار 1. إنه نفس "Setup Python App" بالضبط.

---

# 🔍 استكشاف الأخطاء

### ❌ Application Manager يعرض خطأ "Python not available"
- جرّب الخيار 3 (systemd) - لا يحتاج cPanel Python support

### ❌ "502 Bad Gateway" عند فتح الموقع
- تأكد أن الخدمة شغّالة: `systemctl status marsad`
- تأكد من الـ port: `netstat -tlnp | grep 5050`
- افحص firewalld: `firewall-cmd --list-ports` (يجب أن يكون 5050 مسموح locally)

### ❌ "Connection refused" في logs
- MySQL غير شغّال: `systemctl start mysqld`
- تأكد من credentials في `.env`

### ❌ SSE streaming يقطع (progress modal يتجمد)
- في nginx config تأكد من `proxy_buffering off`
- في Apache أضف: `SetEnv proxy-sendchunked 1`

---

# 🚀 تشغيل السحب التلقائي (cron)

بعد النشر، فعّل السحب التلقائي عبر cron:

```bash
# كـ cpanel user
crontab -e
```

أضف:
```
0 */6 * * * curl -X POST -H "Cookie: session=YOUR_SESSION_COOKIE" http://127.0.0.1:5050/api/scrape > /dev/null 2>&1
```

بس هذا معقّد لأن يحتاج session cookie. الحل الأبسط: جدول السحب من داخل الواجهة (قيد التطوير) أو اترك السحب يدوياً من الواجهة.

---

# 🔒 نصائح أمان للإنتاج

1. **اربط SSL** (Let's Encrypt مجاني):
   - cPanel → SSL/TLS Status → AutoSSL
   - أو via certbot: `certbot --apache`

2. **غيّر SECRET_KEY** (يُولّد تلقائياً في `database/.app_secret` - لا تشاركه)

3. **اضبط firewall:**
   ```bash
   firewall-cmd --permanent --remove-port=5050/tcp  # لا تفتح port مباشرة
   firewall-cmd --reload
   ```
   الـ 5050 يجب أن يكون internal فقط - الوصول عبر reverse proxy على 443.

4. **Backup دوري** لـ MySQL:
   ```bash
   echo "0 2 * * * mysqldump -u root -p'PASS' marsad > /backup/marsad_$(date +\%Y\%m\%d).sql" | crontab -
   ```

---

# 📞 المساعدة

لو لسا في مشكلة:
- [GitHub Issues](https://github.com/AsemAbbas/facebook_scraper/issues)
- logs في `/var/log/marsad.log`
- `journalctl -u marsad -f` للـ systemd logs

---

**✨ خلاصة:** عندك 3 طرق - ابدأ بـ **Application Manager** (نفس Setup Python App) لأن من الصورة يبدو أنه متاح عندك. لو ما نفع، اذهب لـ systemd (الخيار 3).
