"""
RSS.app Source
==============
يقرأ feeds من rss.app (Developer plan = $16.64/شهر لـ 100 feed)

RSS.app بيعطيك RSS URL مباشر، بس نقرأه.
كما يقدم API للإدارة البرمجية.

طريقة العمل:
  1. أنشئ feed من rss.app (feed لكل صفحة فيسبوك)
  2. احفظ feed URL في pages.json كـ page URL أو في source_config
  3. هذا الـ adapter يقرأه ويحوّله
"""

import asyncio
import xml.etree.ElementTree as ET

import aiohttp

from .base import BaseScraper, UnifiedPost, SourceUnavailableError
from .normalizer import PostNormalizer as N


class RSSAppSource(BaseScraper):
    """قراءة RSS feeds من RSS.app"""

    source_name = "rssapp"

    def __init__(self, config: dict):
        super().__init__(config)
        self.api_key = config.get("api_key", "")
        self.base_url = config.get("base_url", "https://api.rss.app/v1")
        self.timeout = aiohttp.ClientTimeout(total=30)
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Marsad Monitor)",
            "Accept": "application/rss+xml, application/xml",
        }
        if self.api_key:
            self.headers["Authorization"] = f"Bearer {self.api_key}"

    async def health_check(self) -> bool:
        """فحص الوصول لـ rss.app"""
        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as session:
                async with session.get("https://rss.app/", headers=self.headers) as r:
                    return r.status == 200
        except Exception:
            return False

    async def scrape_page(
        self,
        page_url: str,
        page_slug: str,
        page_name: str,
        max_posts: int = 20,
    ) -> list[UnifiedPost]:
        feed_url = self._resolve_feed_url(page_url)
        if not feed_url:
            raise SourceUnavailableError(
                f"[rssapp] الصفحة {page_slug} ما لها RSS feed URL. "
                "أنشئ feed من rss.app وضع الـ feed URL في pages.json."
            )

        print(f"  ⚡ [rssapp] قراءة: {feed_url}")

        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as session:
                async with session.get(feed_url, headers=self.headers) as r:
                    if r.status != 200:
                        raise SourceUnavailableError(f"[rssapp] HTTP {r.status}")
                    xml_text = await r.text()
        except asyncio.TimeoutError as e:
            raise SourceUnavailableError("[rssapp] انتهت مهلة الطلب") from e
        except aiohttp.ClientError as e:
            raise SourceUnavailableError(f"[rssapp] خطأ شبكة: {e}") from e

        return self._parse_rss(xml_text, page_slug, page_name, page_url, max_posts)

    def _resolve_feed_url(self, url_or_feed: str) -> str:
        """
        rss.app feeds عادة على الصيغة:
          https://rss.app/feeds/XXXXXXXX.xml
        """
        url = url_or_feed.strip()
        if not url:
            return ""
        if any(hint in url.lower() for hint in ["rss.app", "/feeds/", ".xml", "/rss"]):
            return url
        return ""

    def _parse_rss(
        self,
        xml_text: str,
        page_slug: str,
        page_name: str,
        page_url: str,
        max_posts: int,
    ) -> list[UnifiedPost]:
        """تحليل RSS (RSS.app بيستخدم RSS 2.0 عادة)"""
        posts: list[UnifiedPost] = []

        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError as e:
            print(f"  ⚠️  خطأ تحليل XML: {e}")
            return posts

        items = root.findall(".//item") or root.findall(
            ".//{http://www.w3.org/2005/Atom}entry"
        )

        for item in items[:max_posts]:
            post = self._parse_item(item, page_slug, page_name, page_url)
            if post and post.is_valid():
                posts.append(post)
                preview = post.text[:50].replace("\n", " ")
                print(f"    ✓ #{len(posts)}: {preview}")

        return posts

    def _parse_item(
        self,
        item: ET.Element,
        page_slug: str,
        page_name: str,
        page_url: str,
    ) -> UnifiedPost | None:
        # RSS.app أحياناً بيعطي النص كـ description، وأحياناً كـ title
        text = ""

        # حاول استخراج النص من content:encoded أو description
        for tag_name in [
            "{http://purl.org/rss/1.0/modules/content/}encoded",
            "description",
            "summary",
            "{http://www.w3.org/2005/Atom}summary",
            "{http://www.w3.org/2005/Atom}content",
        ]:
            el = item.find(tag_name)
            if el is not None and el.text:
                text = self._strip_html(el.text)
                if text and len(text.strip()) >= 5:
                    break

        # Fallback: title
        if not text or len(text.strip()) < 5:
            title_el = item.find("title") or item.find(
                "{http://www.w3.org/2005/Atom}title"
            )
            if title_el is not None and title_el.text:
                text = title_el.text

        text = N.clean_text(text)
        if not text or len(text) < 5:
            return None

        # Link
        post_url = ""
        link_el = item.find("link")
        if link_el is not None:
            post_url = (link_el.text or link_el.get("href", "")).strip()

        # GUID
        guid = ""
        guid_el = item.find("guid") or item.find(
            "{http://www.w3.org/2005/Atom}id"
        )
        if guid_el is not None and guid_el.text:
            guid = guid_el.text

        post_id = self.make_post_id(
            N.extract_post_id(post_url) or guid, text
        )

        # Date
        published_at = ""
        for tag in [
            "pubDate",
            "{http://www.w3.org/2005/Atom}published",
            "{http://www.w3.org/2005/Atom}updated",
            "{http://purl.org/dc/elements/1.1/}date",
        ]:
            el = item.find(tag)
            if el is not None and el.text:
                published_at = N.parse_iso_date(el.text)
                if published_at:
                    break

        # Image
        image_url = ""
        enc = item.find("enclosure")
        if enc is not None:
            image_url = enc.get("url", "")
        if not image_url:
            media = item.find("{http://search.yahoo.com/mrss/}content")
            if media is not None:
                image_url = media.get("url", "")
        if not image_url:
            # احذف HTML أولاً ثم جرب استخراج
            desc_el = item.find("description")
            if desc_el is not None and desc_el.text:
                image_url = N.extract_first_image(desc_el.text)

        return UnifiedPost(
            post_id=post_id,
            page_slug=page_slug,
            page_name=page_name,
            page_url=page_url,
            text=N.truncate(text, 2000),
            post_url=post_url,
            image_url=image_url,
            published_at=published_at,
            scraped_at=self.now_iso(),
            timestamp_text="",
            reactions=0,
            comments=0,
            shares=0,
            source=self.source_name,
        )

    @staticmethod
    def _strip_html(html: str) -> str:
        if not html:
            return ""
        import re as _re
        text = _re.sub(r"<[^>]+>", " ", html)
        for ent, val in {
            "&amp;": "&", "&lt;": "<", "&gt;": ">",
            "&quot;": '"', "&#39;": "'", "&nbsp;": " ",
        }.items():
            text = text.replace(ent, val)
        return text
