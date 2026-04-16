"""
Facebook Pages Scraper - GitHub Actions Edition
================================================
يسحب منشورات من عدة صفحات فيسبوك عامة ويحفظها كـ JSON
لتُعرض في الواجهة عبر GitHub Pages.
"""

import asyncio
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright

# مسارات الإخراج
DATA_DIR = Path(__file__).parent.parent / "web" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

CONFIG_FILE = Path(__file__).parent.parent / "pages.json"


def clean_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r'\s+', ' ', text)
    text = text.replace('عرض المزيد', '').replace('See more', '').replace('See More', '')
    return text.strip()


def parse_engagement(text: str) -> int:
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


async def extract_post(article, page_url: str) -> dict | None:
    """استخراج بيانات منشور واحد"""
    try:
        text_locator = article.locator(
            '[data-ad-preview="message"], [data-ad-comet-preview="message"]'
        ).first
        text = await text_locator.inner_text(timeout=2000)
    except Exception:
        try:
            text = await article.locator('div[dir="auto"]').first.inner_text(timeout=2000)
        except Exception:
            text = ""

    text = clean_text(text)
    if not text or len(text) < 5:
        return None

    post_url = ""
    timestamp_text = ""
    try:
        link = article.locator(
            'a[href*="/posts/"], a[href*="/photos/"], a[href*="/videos/"], a[href*="story_fbid"]'
        ).first
        post_url = await link.get_attribute('href', timeout=2000) or ""
        timestamp_text = await link.inner_text(timeout=2000) or ""
    except Exception:
        pass

    post_id_match = re.search(r'(?:posts|story_fbid|videos|photos)[/=](\d+)', post_url)
    post_id = post_id_match.group(1) if post_id_match else f"hash_{abs(hash(text[:100]))}"

    # استخراج التفاعلات
    reactions, comments, shares = 0, 0, 0
    try:
        spans = await article.locator('span').all_inner_texts()
        for span in spans:
            span_lower = span.lower()
            if any(k in span_lower for k in ['تعليق', 'comment']):
                comments = max(comments, parse_engagement(span))
            elif any(k in span_lower for k in ['مشاركة', 'share']):
                shares = max(shares, parse_engagement(span))
    except Exception:
        pass

    try:
        reactions_el = article.locator('[aria-label*="reaction"], [aria-label*="إعجاب"]').first
        reactions = parse_engagement(await reactions_el.inner_text(timeout=1000))
    except Exception:
        pass

    return {
        "post_id": post_id,
        "post_url": f"https://www.facebook.com{post_url}" if post_url.startswith('/') else post_url,
        "text": text[:2000],
        "timestamp_text": clean_text(timestamp_text),
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "reactions": reactions,
        "comments": comments,
        "shares": shares,
    }


async def scrape_page(page_url: str, page_name: str, max_posts: int = 20) -> list[dict]:
    """سحب منشورات صفحة واحدة"""
    posts = []
    seen_ids = set()

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--disable-blink-features=AutomationControlled', '--no-sandbox']
        )
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 900},
            user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                       '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale='ar-SA',
        )
        page = await context.new_page()

        print(f"📡 [{page_name}] فتح: {page_url}")
        try:
            await page.goto(page_url, wait_until='domcontentloaded', timeout=60000)
        except Exception as e:
            print(f"⚠️  فشل فتح الصفحة: {e}")
            await browser.close()
            return []

        await page.wait_for_timeout(3000)

        # محاولة إغلاق نوافذ تسجيل الدخول
        for selector in ['[aria-label="إغلاق"]', '[aria-label="Close"]']:
            try:
                btn = page.locator(selector).first
                if await btn.is_visible(timeout=1500):
                    await btn.click()
                    await page.wait_for_timeout(800)
            except Exception:
                pass

        scroll_count = 0
        max_scrolls = max_posts * 3

        while len(posts) < max_posts and scroll_count < max_scrolls:
            articles = await page.locator('[role="article"]').all()
            for article in articles:
                if len(posts) >= max_posts:
                    break
                try:
                    post_data = await extract_post(article, page_url)
                    if post_data and post_data['post_id'] not in seen_ids:
                        seen_ids.add(post_data['post_id'])
                        post_data['page_name'] = page_name
                        post_data['page_url'] = page_url
                        posts.append(post_data)
                        preview = post_data['text'][:50].replace('\n', ' ')
                        print(f"  ✓ #{len(posts)}: {preview}...")
                except Exception:
                    continue

            await page.evaluate('window.scrollBy(0, 1500)')
            await page.wait_for_timeout(2500)
            scroll_count += 1

        await browser.close()

    return posts


def merge_with_existing(page_slug: str, new_posts: list[dict]) -> list[dict]:
    """دمج المنشورات الجديدة مع الموجودة، مع منع التكرار"""
    file_path = DATA_DIR / f"{page_slug}.json"
    existing = []
    if file_path.exists():
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                existing = json.load(f).get('posts', [])
        except Exception:
            existing = []

    existing_ids = {p['post_id'] for p in existing}
    truly_new = [p for p in new_posts if p['post_id'] not in existing_ids]
    merged = truly_new + existing

    # احتفظ بآخر 200 منشور فقط
    return merged[:200]


async def main():
    if not CONFIG_FILE.exists():
        print(f"❌ ملف الإعدادات غير موجود: {CONFIG_FILE}")
        sys.exit(1)

    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        config = json.load(f)

    pages = config.get('pages', [])
    print(f"🚀 بدء سحب {len(pages)} صفحة\n")

    summary = {
        "last_run": datetime.utcnow().isoformat() + "Z",
        "pages": []
    }

    for page in pages:
        slug = page['slug']
        url = page['url']
        name = page.get('name', slug)
        max_posts = page.get('max_posts', 20)

        print(f"\n{'=' * 60}")
        print(f"📄 {name}")
        print(f"{'=' * 60}")

        try:
            new_posts = await scrape_page(url, name, max_posts)
            merged = merge_with_existing(slug, new_posts)

            output = {
                "page_name": name,
                "page_url": url,
                "page_slug": slug,
                "last_updated": datetime.utcnow().isoformat() + "Z",
                "total_posts": len(merged),
                "posts": merged,
            }

            with open(DATA_DIR / f"{slug}.json", 'w', encoding='utf-8') as f:
                json.dump(output, f, ensure_ascii=False, indent=2)

            new_count = len([p for p in new_posts if p['post_id'] not in
                           {x['post_id'] for x in merged[len(new_posts):]}])

            summary["pages"].append({
                "slug": slug,
                "name": name,
                "url": url,
                "total_posts": len(merged),
                "new_posts": len(new_posts),
                "last_updated": output["last_updated"],
                "status": "success"
            })

            print(f"\n✅ {name}: {len(new_posts)} منشور جديد، الإجمالي {len(merged)}")

        except Exception as e:
            print(f"\n❌ خطأ في {name}: {e}")
            summary["pages"].append({
                "slug": slug,
                "name": name,
                "url": url,
                "status": "error",
                "error": str(e)
            })

    # ملف ملخص يقرأه الموقع لمعرفة الصفحات المتاحة
    with open(DATA_DIR / "index.json", 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(f"\n{'=' * 60}")
    print(f"🏁 انتهى. الملخص في {DATA_DIR / 'index.json'}")


if __name__ == "__main__":
    asyncio.run(main())
