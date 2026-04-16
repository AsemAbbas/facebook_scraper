"""
رفع البيانات المسحوبة إلى Google Sheets مباشرة عبر Service Account
يتطلب: pip install gspread google-auth
"""

import gspread
from google.oauth2.service_account import Credentials
import json
import sys
from pathlib import Path

# ============ الإعدادات ============
SHEET_ID = "ضع_معرف_الشيت_هنا"  # من رابط الشيت
WORKSHEET_NAME = "facebook_posts"
CREDENTIALS_FILE = "service_account.json"  # من Google Cloud Console

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
]


def upload_to_sheets(json_file: str):
    """رفع منشورات JSON إلى Google Sheets"""
    # تحميل البيانات
    with open(json_file, 'r', encoding='utf-8') as f:
        posts = json.load(f)

    if not posts:
        print("⚠️ لا توجد منشورات للرفع")
        return

    # المصادقة
    creds = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPES)
    client = gspread.authorize(creds)

    # فتح الشيت
    sheet = client.open_by_key(SHEET_ID)
    try:
        worksheet = sheet.worksheet(WORKSHEET_NAME)
    except gspread.WorksheetNotFound:
        worksheet = sheet.add_worksheet(title=WORKSHEET_NAME, rows=1000, cols=20)

    # العناوين
    headers = list(posts[0].keys())
    existing_data = worksheet.get_all_values()

    if not existing_data:
        worksheet.append_row(headers)
        existing_ids = set()
    else:
        # تجنب التكرار: قراءة معرفات المنشورات الموجودة
        id_col_index = headers.index('post_id')
        existing_ids = {row[id_col_index] for row in existing_data[1:] if len(row) > id_col_index}

    # رفع المنشورات الجديدة فقط
    new_posts = [p for p in posts if p['post_id'] not in existing_ids]
    if new_posts:
        rows = [[str(p.get(h, '')) for h in headers] for p in new_posts]
        worksheet.append_rows(rows, value_input_option='RAW')
        print(f"✅ تم رفع {len(new_posts)} منشور جديد إلى الشيت")
    else:
        print("ℹ️ لا توجد منشورات جديدة (كلها موجودة مسبقاً)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        # استخدام أحدث ملف JSON تلقائياً
        output_dir = Path("./output")
        json_files = sorted(output_dir.glob("posts_*.json"), reverse=True)
        if not json_files:
            print("❌ لا يوجد ملف JSON. شغّل scraper.py أولاً.")
            sys.exit(1)
        json_file = str(json_files[0])
    else:
        json_file = sys.argv[1]

    print(f"📤 رفع: {json_file}")
    upload_to_sheets(json_file)
