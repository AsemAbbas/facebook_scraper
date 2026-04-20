# 🚀 نشر مَرصَد على VPS — دليل شامل

> دليل الإنتاج لنشر مَرصَد على **أي VPS** (Ubuntu/Debian/Rocky) مع:
> gunicorn + systemd + nginx + Let's Encrypt SSL.

---

## 📋 الاحتياجات

- **VPS** بـ Ubuntu 22.04+ أو Debian 12+ (يعمل على Rocky/AlmaLinux بتعديلات بسيطة)
- **RAM**: 1GB كحد أدنى (2GB+ موصى به إذا بتستخدم Playwright)
- **Disk**: 5GB+ (Chromium يأخذ ~400MB)
- **Domain** موجّه إلى IP السيرفر (A record)
- **SSH root access**

---

## ⚡ التثبيت بأمر واحد (الأسرع)

على VPS نظيف:

```bash
ssh root@your-vps-ip

curl -fsSL https://raw.githubusercontent.com/AsemAbbas/facebook_scraper/main/deploy/install.sh | bash
```

السكريبت يتولّى:
- تثبيت Python + MariaDB + Nginx
- إنشاء مستخدم `marsad` بدون صلاحيات login
- استنساخ المشروع إلى `/opt/marsad`
- إنشاء virtualenv + تثبيت الحزم
- تنصيب Chromium لـ Playwright
- إنشاء DB + user + كلمة سر عشوائية في `.env`
- تثبيت systemd service + nginx template
- فتح ports في UFW firewall

**بعد الانتهاء:** عدّل الـ domain في nginx config وشغّل certbot (الخطوتين 6 و 7 أدناه).

---

## 🔧 التثبيت اليدوي (خطوة بخطوة)

إذا تفضّل تفهم كل خطوة:

### 1. تجهيز السيرفر

```bash
# تحديث النظام
apt update && apt upgrade -y

# الحزم الأساسية
apt install -y python3 python3-venv python3-pip python3-dev \
               mariadb-server nginx git curl build-essential ufw

# مستخدم نظام مخصّص (بدون login shell)
useradd --system --home /opt/marsad --shell /usr/sbin/nologin marsad
```

### 2. تنزيل المشروع

```bash
mkdir -p /opt/marsad
chown marsad:marsad /opt/marsad
sudo -u marsad git clone https://github.com/AsemAbbas/facebook_scraper.git /opt/marsad
cd /opt/marsad
```

### 3. Python environment

```bash
sudo -u marsad python3 -m venv venv
sudo -u marsad ./venv/bin/pip install --upgrade pip wheel
sudo -u marsad ./venv/bin/pip install -r requirements.txt

# Playwright browser (اختياري - استخدمه لو ما عندك Apify token)
./venv/bin/playwright install-deps chromium    # as root
sudo -u marsad ./venv/bin/playwright install chromium
```

### 4. قاعدة البيانات

```bash
systemctl enable --now mariadb
mysql_secure_installation   # اختياري لكن موصى به

# أنشئ DB + user
mysql <<EOF
CREATE DATABASE marsad CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'marsad'@'localhost' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON marsad.* TO 'marsad'@'localhost';
FLUSH PRIVILEGES;
EOF
```

### 5. ملف `.env`

```bash
cat > /opt/marsad/.env <<EOF
MARSAD_DB_HOST=localhost
MARSAD_DB_PORT=3306
MARSAD_DB_NAME=marsad
MARSAD_DB_USER=marsad
MARSAD_DB_PASSWORD=CHANGE_ME_STRONG_PASSWORD

HOST=127.0.0.1
PORT=5050
NO_BROWSER=1
EOF

chmod 600 /opt/marsad/.env
chown marsad:marsad /opt/marsad/.env

# مجلدات اللوغات + البيانات
mkdir -p /var/log/marsad /opt/marsad/database /opt/marsad/logs
chown -R marsad:marsad /var/log/marsad /opt/marsad/database /opt/marsad/logs
```

### 6. systemd service

```bash
cp /opt/marsad/deploy/marsad.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable marsad
systemctl start marsad
systemctl status marsad   # تأكد active (running)
```

تتبّع السجل:
```bash
journalctl -u marsad -f
# أو
tail -f /var/log/marsad/marsad.log
```

### 7. Nginx reverse proxy

```bash
cp /opt/marsad/deploy/nginx.conf /etc/nginx/sites-available/marsad

# عدّل الـ domain في الملف
sed -i 's/marsad\.example\.com/marsad.yourdomain.com/g' /etc/nginx/sites-available/marsad

ln -sf /etc/nginx/sites-available/marsad /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
```

### 8. Let's Encrypt SSL

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d marsad.yourdomain.com
# يتبع التعليمات → certbot يضبط nginx تلقائياً
```

### 9. Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

**🎉 افتح `https://marsad.yourdomain.com` وسجّل أول حساب admin.**

---

## 🏗️ المعمارية

```
┌─────────┐  HTTPS 443  ┌───────┐  127.0.0.1:5050  ┌──────────────┐
│ Browser │ ──────────> │ Nginx │ ───────────────> │ Gunicorn     │
└─────────┘             │ (SSL) │                  │ + Flask App  │
                        └───────┘                  │ + Scheduler  │ ──> MariaDB
                                                   └──────────────┘      (localhost)
                                                         │
                                                         └─> Playwright / Apify / RSS
```

- **Nginx**: SSL termination، compression، static caching، reverse proxy
- **Gunicorn**: production WSGI server مع `--workers 1 --threads 16`  
  (worker واحد ضروري لأن الجدولة تعمل في thread داخلي)
- **Flask App**: REST API + SSE + static files
- **Background Scheduler**: thread يفحص الجدول كل 30 ثانية
- **MariaDB**: كل البيانات

---

## 🔍 استكشاف الأخطاء

### الخدمة ما تشتغل

```bash
systemctl status marsad
journalctl -u marsad -n 100 --no-pager
```

**أخطاء شائعة:**

| الخطأ | الحل |
|------|------|
| `ModuleNotFoundError` | `sudo -u marsad ./venv/bin/pip install -r requirements.txt` |
| `Access denied for user 'marsad'@'localhost'` | تحقق من كلمة السر في `.env` + صلاحيات الـ user في MariaDB |
| `Can't connect to MySQL server` | `systemctl start mariadb` |
| `Address already in use` | `lsof -i :5050` — اقتل العملية القديمة |
| `Permission denied` على المجلدات | `chown -R marsad:marsad /opt/marsad` |

### 502 Bad Gateway

الـ Nginx يشوف ما في شيء على 5050:
```bash
curl http://127.0.0.1:5050/healthz   # هل يرد؟
systemctl status marsad               # هل شغّال؟
ss -tlnp | grep 5050                  # هل يستمع؟
```

### SSE يتوقّف (progress modal يتجمّد)

تحقق من nginx config فيه:
```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 600s;
```

### Playwright ما يشتغل

```bash
sudo -u marsad /opt/marsad/venv/bin/playwright install chromium
./venv/bin/playwright install-deps chromium   # as root

# test
sudo -u marsad /opt/marsad/venv/bin/python -c "from playwright.sync_api import sync_playwright; p=sync_playwright().start(); b=p.chromium.launch(); print('ok'); b.close()"
```

---

## 🔄 التحديث

```bash
cd /opt/marsad
sudo -u marsad git pull
sudo -u marsad ./venv/bin/pip install -r requirements.txt
systemctl restart marsad
```

أو auto-update via cron:
```bash
# crontab -e as root
0 4 * * * cd /opt/marsad && sudo -u marsad git pull && systemctl restart marsad
```

---

## 🔒 نصائح أمان للإنتاج

1. **غيّر SSH port** وفعّل key-only auth:
   ```bash
   # /etc/ssh/sshd_config
   Port 2222
   PermitRootLogin prohibit-password
   PasswordAuthentication no
   ```

2. **fail2ban** للـ brute force protection:
   ```bash
   apt install -y fail2ban
   systemctl enable --now fail2ban
   ```

3. **Backup يومي لـ MariaDB**:
   ```bash
   # /etc/cron.d/marsad-backup
   0 3 * * * root mysqldump marsad | gzip > /var/backups/marsad_$(date +\%Y\%m\%d).sql.gz
   # احذف القديم > 30 يوم
   0 4 * * * root find /var/backups -name 'marsad_*.sql.gz' -mtime +30 -delete
   ```

4. **مراقبة الموارد**:
   ```bash
   apt install -y htop iotop
   # أو ثبّت Netdata للـ dashboard
   bash <(curl -Ss https://my-netdata.io/kickstart.sh)
   ```

5. **حدّث النظام أسبوعياً**:
   ```bash
   # /etc/cron.weekly/apt-upgrade
   #!/bin/bash
   apt update && apt upgrade -y && apt autoremove -y
   ```

6. **لا تفتح Port 5050 على الانترنت** — خلّيه `127.0.0.1` فقط. الـ UFW rules في install.sh تمنعه تلقائياً.

---

## 📊 المراقبة (اختياري)

### Health check via UptimeRobot / BetterStack

URL: `https://marsad.yourdomain.com/healthz`

ترجع:
```json
{"ok": true, "db": "الاتصال نجح", "scheduler": true}
```

### Log rotation

```bash
# /etc/logrotate.d/marsad
/var/log/marsad/marsad.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

---

## 🆘 المساعدة

| الحالة | الأمر |
|--------|------|
| فحص الخدمة | `systemctl status marsad` |
| سجلات مباشرة | `journalctl -u marsad -f` |
| إعادة تشغيل | `systemctl restart marsad` |
| إيقاف | `systemctl stop marsad` |
| فحص الـ config | `nginx -t` |
| إعادة تحميل nginx | `systemctl reload nginx` |
| فحص DB | `mysql -u marsad -p marsad -e "SHOW TABLES"` |
| تجديد SSL | `certbot renew --dry-run` (cron يجدّده تلقائياً كل 60 يوم) |

---

**📞 Issues?** افتح issue على [GitHub](https://github.com/AsemAbbas/facebook_scraper/issues)
