"""
Facebook Public Page Scraper
============================
سحب منشورات صفحة فيسبوك عامة باستخدام Playwright
للاستخدام الإعلامي البحثي.

⚠️ تحذير: يخالف شروط فيسبوك. استخدم بحذر ومن جهاز/IP غير مرتبط بحسابك الشخصي.
"""

import asyncio
import json
import re
import os
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright

# ============ الإعدادات ============
CONFIG = {
    "page_url": "https://www.facebook.com/aljazeerachannel",  # غيّر هذا
    "max_posts": 30,
    "scroll_pause": 2.5,
    "headless": True,  # اجعلها False لرؤية المتصفح أثناء العمل
    "output_dir": "./output",
    "use_mbasic": False,  # mbasic.facebook.com أسهل للسحب لكن أقل محتوى
}

# ============ الدوال المساعدة ============

def clean_text(text: str) -> str:
    """تنظيف النصوص العربية والإنجليزية"""
    if not text:
        return ""
    text = re.sub(r'\s+', ' ', text)
    text = text.replace('عرض المزيد', '').replace('See more', '')
    return text.strip()


def parse_engagement(text: str) -> int:
    """تحويل '1.2K' أو '3.5 ألف' إلى رقم"""
    if not text:
        return 0
    text = text.strip().lower().replace(',', '')
    multipliers = {'k': 1_000, 'm': 1_000_000, 'ألف': 1_000, 'مليون': 1_000_000}
    for suffix, mult in multipliers.items():
        if suffix in text:
            num = re.search(r'[\d.]+', text)
            return int(float(num.group()) * mult) if num else 0
    num = re.search(r'\d+', text)
    return int(num.group()) if num else 0


# ============ السحب الفعلي ============

async def scrape_page(page_url: str, max_posts: int) -> list[dict]:
    """سحب المنشورات من صفحة فيسبوك عامة"""
    posts = []
    seen_ids = set()

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=CONFIG["headless"],
            args=['--disable-blink-features=AutomationControlled']
        )
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 900},
            user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                       '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale='ar-SA',
        )
        page = await context.new_page()

        # حظر النوافذ المنبثقة لتسجيل الدخول
        await page.add_init_script("""
            window.addEventListener('load', () => {
                const closeButtons = document.querySelectorAll('[aria-label="إغلاق"], [aria-label="Close"]');
                closeButtons.forEach(btn => btn.click());
            });
        """)

        print(f"📡 جاري فتح: {page_url}")
        await page.goto(page_url, wait_until='domcontentloaded', timeout=60000)
        await page.wait_for_timeout(3000)

        # محاولة إغلاق نافذة تسجيل الدخول
        try:
            close_btn = page.locator('[aria-label="إغلاق"], [aria-label="Close"]').first
            if await close_btn.is_visible(timeout=3000):
                await close_btn.click()
                await page.wait_for_timeout(1000)
        except Exception:
            pass

        print("🔄 بدء تمرير الصفحة لتحميل المنشورات...")

        scroll_count = 0
        max_scrolls = max_posts * 2  # حماية من اللانهاية

        while len(posts) < max_posts and scroll_count < max_scrolls:
            # المنشورات في فيسبوك داخل عناصر [role="article"]
            articles = await page.locator('[role="article"]').all()

            for article in articles:
                if len(posts) >= max_posts:
                    break
                try:
                    post_data = await extract_post(article, page_url)
                    if post_data and post_data['post_id'] not in seen_ids:
                        seen_ids.add(post_data['post_id'])
                        posts.append(post_data)
                        print(f"  ✓ منشور #{len(posts)}: {post_data['text'][:60]}...")
                except Exception as e:
                    continue

            # تمرير لأسفل
            await page.evaluate('window.scrollBy(0, 1500)')
            await page.wait_for_timeout(int(CONFIG["scroll_pause"] * 1000))
            scroll_count += 1

        await browser.close()

    return posts


async def extract_post(article, page_url: str) -> dict | None:
    """استخراج بيانات منشور واحد"""
    # النص
    text_locator = article.locator('[data-ad-preview="message"], [data-ad-comet-preview="message"]').first
    try:
        text = await text_locator.inner_text(timeout=2000)
    except Exception:
        try:
            text = await article.locator('div[dir="auto"]').first.inner_text(timeout=2000)
        except Exception:
            text = ""

    text = clean_text(text)
    if not text or len(text) < 5:
        return None

    # الرابط والتاريخ (موجودان في نفس الـ <a> عادة)
    post_url = ""
    timestamp_text = ""
    try:
        link = article.locator('a[href*="/posts/"], a[href*="/photos/"], a[href*="/videos/"], a[href*="story_fbid"]').first
        post_url = await link.get_attribute('href', timeout=2000) or ""
        timestamp_text = await link.inner_text(timeout=2000) or ""
    except Exception:
        pass

    # معرف فريد (من الرابط أو من النص)
    post_id_match = re.search(r'(?:posts|story_fbid|videos|photos)[/=](\d+)', post_url)
    post_id = post_id_match.group(1) if post_id_match else f"hash_{hash(text[:100])}"

    # التفاعلات
    reactions = await safe_extract_number(
        article, '[aria-label*="إعجاب"], [aria-label*="reaction"], span[aria-hidden="true"]'
    )
    comments = await safe_extract_number(
        article, '[aria-label*="تعليق"], [aria-label*="comment"]'
    )
    shares = await safe_extract_number(
        article, '[aria-label*="مشاركة"], [aria-label*="share"]'
    )

    return {
        "post_id": post_id,
        "page_url": page_url,
        "post_url": f"https://www.facebook.com{post_url}" if post_url.startswith('/') else post_url,
        "text": text[:2000],  # حد أعلى للنص
        "timestamp_text": clean_text(timestamp_text),
        "scraped_at": datetime.now().isoformat(),
        "reactions": reactions,
        "comments": comments,
        "shares": shares,
    }


async def safe_extract_number(article, selector: str) -> int:
    """محاولة استخراج رقم تفاعل بأمان"""
    try:
        element = article.locator(selector).first
        text = await element.inner_text(timeout=1000)
        return parse_engagement(text)
    except Exception:
        return 0


# ============ التشغيل والحفظ ============

def save_results(posts: list[dict], output_dir: str):
    """حفظ النتائج كـ JSON و CSV"""
    Path(output_dir).mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # JSON
    json_path = Path(output_dir) / f"posts_{timestamp}.json"
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(posts, f, ensure_ascii=False, indent=2)

    # CSV (للرفع إلى Google Sheets)
    import csv
    csv_path = Path(output_dir) / f"posts_{timestamp}.csv"
    if posts:
        with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=posts[0].keys())
            writer.writeheader()
            writer.writerows(posts)

    print(f"\n💾 تم الحفظ:")
    print(f"   JSON: {json_path}")
    print(f"   CSV:  {csv_path}")
    return str(csv_path), str(json_path)


async def main():
    print("=" * 60)
    print("🚀 Facebook Page Scraper")
    print("=" * 60)
    posts = await scrape_page(CONFIG["page_url"], CONFIG["max_posts"])
    print(f"\n✅ تم جمع {len(posts)} منشور")
    if posts:
        save_results(posts, CONFIG["output_dir"])


if __name__ == "__main__":
    asyncio.run(main())
