"""
RSSHub Source
=============
RSSHub هو خدمة RSS مفتوحة المصدر. تقدر تستخدم:
  - الـ instance العامة (rsshub.app) - مجاني لكن محدود
  - Self-hosted - مجاني وبدون حدود (VPS أو Docker)

https://docs.rsshub.app/en/routes/social-media#facebook

Facebook Routes:
  /facebook/page/{id}     - صفحة محددة
  /facebook/group/{id}    - مجموعة
"""

import asyncio
import xml.etree.ElementTree as ET
from typing import Optional
from urllib.parse import urlparse

import aiohttp

from .base import BaseScraper, UnifiedPost, SourceUnavailableError
from .normalizer import PostNormalizer as N


class RSSHubSource(BaseScraper):
    """قراءة feeds من RSSHub"""

    source_name = "rsshub"

    def __init__(self, config: dict):
        super().__init__(config)
        self.base_url = config.get("base_url", "https://rsshub.app").rstrip("/")
        self.access_key = config.get("access_key", "")
        self.timeout = aiohttp.ClientTimeout(total=45)
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Marsad Monitor)",
            "Accept": "application/rss+xml, application/xml",
        }

    async def health_check(self) -> bool:
        """فحص الوصول لـ RSSHub instance"""
        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as session:
                async with session.get(self.base_url, headers=self.headers) as r:
                    return r.status == 200
        except Exception:
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
        # حوّل Facebook URL لـ RSSHub route
        feed_url = self._build_rsshub_url(page_url)

        if not feed_url:
            raise SourceUnavailableError(
                f"[rsshub] ما قدرت استخرج page_id من: {page_url}"
            )

        print(f"  🏠 [rsshub] قراءة: {feed_url}")

        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as session:
                async with session.get(feed_url, headers=self.headers) as r:
                    if r.status != 200:
                        raise SourceUnavailableError(
                            f"[rsshub] HTTP {r.status}"
                        )
                    xml_text = await r.text()
        except asyncio.TimeoutError as e:
            raise SourceUnavailableError("[rsshub] انتهت مهلة الطلب") from e
        except aiohttp.ClientError as e:
            raise SourceUnavailableError(f"[rsshub] خطأ شبكة: {e}") from e

        posts = self._parse_rss(xml_text, page_slug, page_name, page_url, max_posts * 2)
        posts = self.filter_by_date(posts, date_from, date_to)
        return posts[:max_posts]

    def _build_rsshub_url(self, fb_url: str) -> str:
        """
        يحوّل Facebook URL لـ RSSHub route.
        https://www.facebook.com/aljazeerachannel → https://rsshub.app/facebook/page/aljazeerachannel
        """
        if not fb_url:
            return ""

        # لو المستخدم حط URL جاهز لـ RSSHub
        if "rsshub" in fb_url or "/facebook/page/" in fb_url:
            return fb_url

        parsed = urlparse(fb_url)
        if "facebook.com" not in parsed.netloc:
            return ""

        # استخرج page_id من الـ path
        path = parsed.path.strip("/")
        if not path:
            return ""

        # أول segment هو عادة الـ page name/id
        page_id = path.split("/")[0]

        url = f"{self.base_url}/facebook/page/{page_id}"
        if self.access_key:
            url += f"?key={self.access_key}"

        return url

    def _parse_rss(
        self,
        xml_text: str,
        page_slug: str,
        page_name: str,
        page_url: str,
        max_posts: int,
    ) -> list[UnifiedPost]:
        """تحليل RSS من RSSHub (يستخدم Atom أو RSS 2.0)"""
        posts: list[UnifiedPost] = []

        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError as e:
            print(f"  ⚠️  خطأ XML: {e}")
            return posts

        # RSSHub عادة يستخدم Atom
        items = root.findall(".//{http://www.w3.org/2005/Atom}entry")
        if not items:
            items = root.findall(".//item")

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
        # Content أو Description
        text = ""
        for tag in [
            "{http://www.w3.org/2005/Atom}content",
            "{http://www.w3.org/2005/Atom}summary",
            "{http://purl.org/rss/1.0/modules/content/}encoded",
            "description",
            "summary",
        ]:
            el = item.find(tag)
            if el is not None and el.text:
                text = self._strip_html(el.text)
                if text and len(text.strip()) >= 5:
                    break

        if not text or len(text) < 5:
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
        for tag in ["link", "{http://www.w3.org/2005/Atom}link"]:
            el = item.find(tag)
            if el is not None:
                post_url = (el.text or el.get("href", "")).strip()
                if post_url:
                    break
        post_url = N.normalize_fb_url(post_url) if "facebook.com" in post_url else post_url

        # GUID
        guid_el = item.find("guid") or item.find("{http://www.w3.org/2005/Atom}id")
        guid = guid_el.text if guid_el is not None and guid_el.text else ""

        post_id = self.make_post_id(
            N.extract_post_id(post_url) or guid, text
        )

        # Date
        published_at = ""
        for tag in [
            "pubDate",
            "{http://www.w3.org/2005/Atom}published",
            "{http://www.w3.org/2005/Atom}updated",
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
            # RSSHub أحياناً يحط الصورة في description
            desc_el = item.find("description") or item.find(
                "{http://www.w3.org/2005/Atom}content"
            )
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
