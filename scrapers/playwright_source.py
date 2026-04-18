"""
Playwright Source
=================
السحب المباشر عبر متصفح Chromium (بدون خدمات خارجية)
⚠️ فيسبوك بيكتشفه أحياناً خصوصاً من IPs كلاود مثل GitHub Actions
"""

import asyncio
from typing import Any, Optional

from .base import BaseScraper, UnifiedPost, SourceUnavailableError
from .normalizer import PostNormalizer as N


class PlaywrightSource(BaseScraper):
    """سحب مباشر عبر Chromium Headless"""

    source_name = "playwright"

    def __init__(self, config: dict):
        super().__init__(config)
        self.headless = config.get("headless", True)
        self.scroll_pause = config.get("scroll_pause_seconds", 2.5)
        self.user_agent = config.get(
            "user_agent",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        self.use_mbasic = config.get("use_mbasic", False)
        self.browser_args = config.get("browser_args", [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
        ])

    async def health_check(self) -> bool:
        """تأكد من توفر Playwright"""
        try:
            from playwright.async_api import async_playwright  # noqa: F401
            return True
        except ImportError:
            return False

    async def scrape_page(
        self,
        page_url: str,
        page_slug: str,
        page_name: str,
        max_posts: int = 20,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> list[UnifiedPost]:
        try:
            from playwright.async_api import async_playwright
        except ImportError as e:
            raise SourceUnavailableError(
                "Playwright غير مثبت. شغّل: pip install playwright && playwright install chromium"
            ) from e

        # ملاحظة: Playwright ما بيعطي published_at دقيق،
        # فالـ date filtering في Playwright محدود. نعمل post-fetch filtering.

        # استخدم mbasic إذا طُلب
        if self.use_mbasic and "www.facebook.com" in page_url:
            page_url = page_url.replace("www.facebook.com", "mbasic.facebook.com")

        posts: list[UnifiedPost] = []
        seen_ids: set[str] = set()

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=self.headless,
                args=self.browser_args,
            )

            context = await browser.new_context(
                viewport={"width": 1280, "height": 900},
                user_agent=self.user_agent,
                locale="ar-SA",
            )

            page = await context.new_page()

            try:
                print(f"  📡 [playwright] فتح: {page_url}")
                await page.goto(page_url, wait_until="domcontentloaded", timeout=60000)
                await page.wait_for_timeout(3000)

                await self._close_login_popups(page)

                scroll_count = 0
                max_scrolls = max_posts * 3
                stuck_count = 0
                last_count = 0

                while len(posts) < max_posts and scroll_count < max_scrolls:
                    articles = await page.locator('[role="article"]').all()

                    for article in articles:
                        if len(posts) >= max_posts:
                            break
                        try:
                            post_data = await self._extract_post(
                                article, page_url, page_slug, page_name
                            )
                            if post_data and post_data.post_id not in seen_ids:
                                seen_ids.add(post_data.post_id)
                                posts.append(post_data)
                                preview = post_data.text[:50].replace("\n", " ")
                                print(f"    ✓ #{len(posts)}: {preview}")
                        except Exception:
                            continue

                    # توقف إن ما في تقدم لفترة
                    if len(posts) == last_count:
                        stuck_count += 1
                        if stuck_count >= 3:
                            print(f"    ⏸️  توقف التقدم بعد {len(posts)} منشور")
                            break
                    else:
                        stuck_count = 0
                        last_count = len(posts)

                    await page.evaluate("window.scrollBy(0, 1500)")
                    await page.wait_for_timeout(int(self.scroll_pause * 1000))
                    scroll_count += 1

            finally:
                await browser.close()

        # Date filter (بعض المنشورات published_at قد يكون فاضي)
        posts = self.filter_by_date(posts, date_from, date_to)
        return posts

    async def _close_login_popups(self, page) -> None:
        """محاولة إغلاق نوافذ تسجيل الدخول"""
        selectors = [
            '[aria-label="إغلاق"]',
            '[aria-label="Close"]',
            '[aria-label="Not Now"]',
            '[aria-label="ليس الآن"]',
        ]
        for selector in selectors:
            try:
                btn = page.locator(selector).first
                if await btn.is_visible(timeout=1500):
                    await btn.click()
                    await page.wait_for_timeout(800)
            except Exception:
                continue

    async def _extract_post(
        self,
        article: Any,
        page_url: str,
        page_slug: str,
        page_name: str,
    ) -> UnifiedPost | None:
        """استخراج بيانات منشور واحد من article element"""

        # ========== FILTER 1: skip sidebar / ads / suggestions ==========
        # Check if article is a legit post (not ad/suggestion/sidebar)
        try:
            # Skip sponsored
            sponsored_hints = [
                'Sponsored', 'ممول', 'مموّل', 'إعلان',
                'Suggested for you', 'مقترح لك',
                'People you may know', 'أشخاص قد تعرفهم',
            ]
            article_text = (await article.inner_text(timeout=2000))[:500]
            if any(h.lower() in article_text.lower() for h in sponsored_hints):
                return None
        except Exception:
            pass

        # ========== النص ==========
        text = ""
        for selector in [
            '[data-ad-preview="message"]',
            '[data-ad-comet-preview="message"]',
            'div[dir="auto"]',
        ]:
            try:
                text = await article.locator(selector).first.inner_text(timeout=2000)
                if text and len(text) > 5:
                    break
            except Exception:
                continue

        text = N.clean_text(text)
        if not text or len(text) < 5:
            return None

        # ========== FILTER 2: find post permalink ==========
        # A genuine post MUST have a permalink. If we can't find one → skip.
        post_url = ""
        timestamp_text = ""
        candidate_urls: list[tuple[str, str]] = []  # (href, text)
        try:
            # Collect ALL candidate links inside article
            anchors = article.locator(
                'a[href*="/posts/"], a[href*="/photos/"], a[href*="/videos/"], '
                'a[href*="story_fbid"], a[href*="/permalink/"], a[href*="pfbid"]'
            )
            n = await anchors.count()
            for i in range(min(n, 10)):
                try:
                    href = await anchors.nth(i).get_attribute("href", timeout=800) or ""
                    inner = await anchors.nth(i).inner_text(timeout=500) or ""
                    if href:
                        candidate_urls.append((href, inner))
                except Exception:
                    continue
        except Exception:
            pass

        # Pick the best candidate: prefer one that belongs to the page being scraped
        page_slug_or_id = ""
        try:
            import re as _re
            m = _re.search(r"facebook\.com/([^/?#]+)", page_url)
            if m:
                page_slug_or_id = m.group(1).lower()
        except Exception:
            pass

        best_url = ""
        best_text = ""
        # First pass: URL contains the page slug
        for href, inner in candidate_urls:
            if page_slug_or_id and page_slug_or_id in href.lower():
                best_url = href
                best_text = inner
                break
        # Fallback: first candidate that looks like a permalink
        if not best_url:
            for href, inner in candidate_urls:
                if any(k in href for k in ("/posts/", "pfbid", "story_fbid", "/permalink/")):
                    best_url = href
                    best_text = inner
                    break
        # Fallback: first candidate
        if not best_url and candidate_urls:
            best_url, best_text = candidate_urls[0]

        post_url = N.normalize_fb_url(best_url)
        timestamp_text = best_text

        # FILTER 3: If post has no permalink, it's likely not a real post (skip)
        if not post_url or not any(k in post_url for k in ("/posts/", "pfbid", "story_fbid", "/permalink/", "/videos/", "/photos/")):
            return None

        # FILTER 4: URL must belong to the page (not reshared from elsewhere)
        # BUT: only strict-check when we know page_slug_or_id from URL
        if page_slug_or_id and page_slug_or_id not in post_url.lower():
            # URL is to a different page → this is a shared post or sidebar content
            return None

        # معرّف فريد
        post_id = N.extract_post_id(post_url) or self.make_post_id("", text)

        # ========== الصورة ==========
        image_url = ""
        try:
            imgs = article.locator("img")
            icount = await imgs.count()
            for i in range(min(icount, 5)):
                try:
                    src = await imgs.nth(i).get_attribute("src", timeout=500)
                    if src and "fbcdn" in src and "emoji" not in src and "static" not in src:
                        image_url = src
                        break
                except Exception:
                    continue
        except Exception:
            pass

        # التفاعلات - استخراج من الـ aria-label مباشرة (أدق)
        reactions, comments, shares = await self._extract_engagement(article)

        # كل الميديا (مش بس أول صورة)
        media = await self._extract_all_media(article)

        # روابط خارجية
        external_links = await self._extract_external_links(article, post_url)

        post = UnifiedPost(
            post_id=post_id,
            page_slug=page_slug,
            page_name=page_name,
            page_url=page_url,
            text=N.truncate(text, 2000),
            post_url=post_url,
            image_url=image_url,
            video_url=next((m["url"] for m in media if m.get("type") == "video"), ""),
            media=media,
            published_at="",
            scraped_at=self.now_iso(),
            timestamp_text=N.clean_text(timestamp_text),
            reactions=reactions,
            comments=comments,
            shares=shares,
            external_links=external_links,
            source=self.source_name,
            author_name=page_name,
        )
        post.extract_hashtags()
        post.post_type = post.derive_post_type()
        return post

    async def _extract_all_media(self, article: Any) -> list[dict]:
        """استخراج كل الصور والفيديوهات من المنشور"""
        media = []
        try:
            imgs = article.locator("img")
            count = await imgs.count()
            for i in range(min(count, 8)):
                try:
                    src = await imgs.nth(i).get_attribute("src", timeout=500)
                    if src and "fbcdn" in src and "emoji" not in src:
                        # تأكد ما تكرر
                        if not any(m["url"] == src for m in media):
                            media.append({"type": "image", "url": src,
                                          "thumbnail": "", "width": 0, "height": 0})
                except Exception:
                    continue
        except Exception:
            pass

        try:
            videos = article.locator("video")
            vcount = await videos.count()
            for i in range(min(vcount, 3)):
                try:
                    src = await videos.nth(i).get_attribute("src", timeout=500)
                    if src:
                        media.append({"type": "video", "url": src,
                                      "thumbnail": "", "width": 0, "height": 0})
                except Exception:
                    continue
        except Exception:
            pass

        return media

    async def _extract_external_links(self, article: Any, post_url: str) -> list[str]:
        """استخراج روابط خارجية من المنشور"""
        links = []
        try:
            anchors = article.locator('a[href]')
            count = await anchors.count()
            for i in range(min(count, 20)):
                try:
                    href = await anchors.nth(i).get_attribute("href", timeout=300)
                    if not href:
                        continue
                    # تجاهل روابط فيسبوك الداخلية
                    if "facebook.com" in href and href != post_url:
                        continue
                    if href.startswith("http") and "facebook.com" not in href:
                        if href not in links:
                            links.append(href)
                except Exception:
                    continue
        except Exception:
            pass
        return links[:5]

    async def _extract_engagement(self, article: Any) -> tuple[int, int, int]:
        """
        استخراج التفاعلات من aria-label مباشرة.
        فيسبوك يضع أرقام التفاعل في aria-label بالشكل:
          "12 reactions, 5 comments, 3 shares"
          "12 reactions"
          "Like: 12 people"
        """
        reactions = 0
        comments = 0
        shares = 0

        # جرّب قراءة all aria-labels ذات العلاقة
        try:
            # Reactions: element بعنوان "XX reactions"
            react_els = article.locator(
                'span[aria-label*="reaction" i], span[aria-label*="إعجاب"], '
                'div[aria-label*="reaction" i][role="button"], '
                'div[aria-label*="Like:" i]'
            )
            n = await react_els.count()
            for i in range(min(n, 3)):
                try:
                    label = await react_els.nth(i).get_attribute("aria-label", timeout=500)
                    if label:
                        num = self._extract_first_number(label)
                        if 0 < num < 10_000_000:  # حد عقلاني
                            reactions = max(reactions, num)
                except Exception:
                    continue
        except Exception:
            pass

        # Comments + Shares: نفس التقنية
        try:
            comm_els = article.locator(
                'span[aria-label*="comment" i], span[aria-label*="تعليق"]'
            )
            n = await comm_els.count()
            for i in range(min(n, 3)):
                try:
                    label = await comm_els.nth(i).get_attribute("aria-label", timeout=500)
                    if label:
                        num = self._extract_first_number(label)
                        if 0 < num < 5_000_000:
                            comments = max(comments, num)
                except Exception:
                    continue
        except Exception:
            pass

        try:
            share_els = article.locator(
                'span[aria-label*="share" i], span[aria-label*="مشارك"]'
            )
            n = await share_els.count()
            for i in range(min(n, 3)):
                try:
                    label = await share_els.nth(i).get_attribute("aria-label", timeout=500)
                    if label:
                        num = self._extract_first_number(label)
                        if 0 < num < 1_000_000:
                            shares = max(shares, num)
                except Exception:
                    continue
        except Exception:
            pass

        return reactions, comments, shares

    @staticmethod
    def _extract_first_number(text: str) -> int:
        """استخراج أول رقم من نص (مع دعم K/M)"""
        if not text:
            return 0
        import re as _re
        # حدّد الرقم المقترن بوحدة إن وُجدت
        m = _re.search(r'([\d,.]+)\s*([KMmk]|ألف|مليون)?', text)
        if not m:
            return 0
        try:
            num = float(m.group(1).replace(',', ''))
            unit = (m.group(2) or '').lower()
            if unit in ('k', 'ألف'):
                num *= 1_000
            elif unit in ('m', 'مليون'):
                num *= 1_000_000
            return int(num)
        except (ValueError, AttributeError):
            return 0
