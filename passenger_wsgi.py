"""
مَرصَد · Passenger WSGI Entry Point
=====================================
نقطة الدخول لـ cPanel + Phusion Passenger.

كيفية الإعداد في cPanel:
  1. cPanel → Setup Python App
  2. Create Application
  3. Python version: 3.11+ (أو أحدث متاح)
  4. Application root: /home/USER/public_html/marsad (مثلاً)
  5. Application URL: marsad.yourdomain.com أو /marsad
  6. Application startup file: passenger_wsgi.py
  7. Application Entry point: application

بعدها في نفس الصفحة:
  8. اضغط "Enter to the virtual environment" وانسخ الأمر
  9. افتح Terminal في cPanel والصق الأمر
  10. شغّل: pip install -r requirements.txt
  11. أنشئ قاعدة MySQL من cPanel → MySQL Databases
  12. انسخ بيانات الاتصال إلى .env (نسخة من .env.example)
  13. ارجع لـ Python App صفحة واضغط "Restart"
"""

import os
import sys
from pathlib import Path

# تأكد من أن الـ working directory صحيح
PROJECT_ROOT = Path(__file__).resolve().parent
os.chdir(str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT))

# استدعي التطبيق
from server import app as application  # noqa: E402

# بعض إعدادات الـ Passenger تحتاج "application" بالضبط
if __name__ == "__main__":
    # للتشغيل المحلي
    application.run(host="0.0.0.0", port=5050)
