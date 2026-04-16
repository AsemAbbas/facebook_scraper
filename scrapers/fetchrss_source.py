"""
FetchRSS Source
===============
يقرأ feeds من fetchrss.com (الخدمة الأرخص - $9.95/شهر لـ 100 feed)

⚠️ FetchRSS بيحدد تحديث Facebook feeds كل 3-6 ساعات (قيد من فيسبوك).
⚠️ ما بيعطي تفاعلات دقيقة (reactions/comments=0).

طريقة العمل:
  1. المستخدم ينشئ RSS feed لكل صفحة في لوحة FetchRSS يدوياً
  2. يحفظ feed_id في pages.json تحت "source_config"
  3. هذا الـ adapter يقرأ الـ RSS ويحوّله للـ unified schema
"""

import asyncio
import xml.etree.ElementTree as ET
from urllib.parse import quote, urljoin

import aiohttp

from .base import BaseScraper, UnifiedPost, SourceUnavailableError
from .normalizer import PostNormalizer as N


# XML namespaces شائعة في RSS
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "media": "http://search.yahoo.com/mrss/",
    "dc": "http://purl.org/dc/elements/1.1/",
}


class FetchRSSSource(BaseScraper):
    """قراءة RSS feeds من FetchRSS.com"""

    source_name = "fetchrss"

    def __init__(self, config: dict):
        super().__init__(config)
        self.api_key = config.get("api_key", "")
        self.base_url = config.get("base_url", "https://fetchrss.com/rss")

        # إعدادات الـ request
        self.timeout = aiohttp.ClientTimeout(total=30)
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Marsad Monitor) RSS Reader/2.0",
            "Accept": "application/rss+xml, application/xml, text/xml",
        }

    async def health_check(self) -> bool:
        """تأكد من قابلية الوصول لـ FetchRSS"""
        if not self.api_key:
            return False
        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as session:
                async with session.get("https://fetchrss.com/", headers=self.headers) as r:
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
        """
        يحتاج الـ page أن يكون فيه "source_config.fetchrss_feed_id" في pages.json
        أو نستخدم page_url كـ feed URL مباشر.
        """
        # تحديد Feed URL
        feed_url = self._resolve_feed_url(page_url)

        if not feed_url:
            raise SourceUnavailableError(
                f"[fetchrss] الصفحة {page_slug} ما لها feed_url. "
                "أنشئ RSS feed من fetchrss.com وضع الـ feed URL في pages.json."
            )

        print(f"  🪶 [fetchrss] قراءة: {feed_url}")

        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as session:
                async with session.get(feed_url, headers=self.headers) as r:
                    if r.status != 200:
                        raise SourceUnavailableError(
                            f"[fetchrss] HTTP {r.status}"
                        )
                    xml_text = await r.text()
        except asyncio.TimeoutError as e:
            raise SourceUnavailableError("[fetchrss] انتهت مهلة الطلب") from e
        except aiohttp.ClientError as e:
            raise SourceUnavailableError(f"[fetchrss] خطأ شبكة: {e}") from e

        return self._parse_rss(xml_text, page_slug, page_name, page_url, max_posts)

    def _resolve_feed_url(self, page_url_or_feed: str) -> str:
        """
        إذا الـ URL هو feed مباشر (rss/xml) → استخدمه.
        إذا كان Facebook URL → المستخدم يجب أن يضعه كـ feed URL.
        """
        url = page_url_or_feed.strip()
        if not url:
            return ""
        # Feed مباشر
        if any(hint in url.lower() for hint in ["fetchrss.com", "/rss", ".xml", "feed"]):
            return url
        # ما عنا feed_url، نتوقع إن المستخدم عمله
        return ""

    def _parse_rss(
        self,
        xml_text: str,
        page_slug: str,
        page_name: str,
        page_url: str,
        max_posts: int,
    ) -> list[UnifiedPost]:
        """تحليل RSS XML وتحويله لـ UnifiedPost"""
        posts: list[UnifiedPost] = []

        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError as e:
            print(f"  ⚠️  خطأ في تحليل RSS: {e}")
            return posts

        # RSS 2.0: channel/item
        # Atom: feed/entry
        items = root.findall(".//item") or root.findall(".//atom:entry", NS)

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
        """تحليل <item> أو <entry> واحد"""
        # النص (description/content)
        text = ""
        for tag in ["description", "{http://purl.org/rss/1.0/modules/content/}encoded", "content", "summary", "{http://www.w3.org/2005/Atom}summary"]:
            el = item.find(tag) if tag.startswith("{") else item.find(tag)
            if el is not None and el.text:
                text = el.text
                break

        # إذا content فيه HTML → استخراج النص
        text = self._strip_html(text)
        text = N.clean_text(text)

        if not text or len(text) < 5:
            # جرب title
            title_el = item.find("title") or item.find("{http://www.w3.org/2005/Atom}title")
            if title_el is not None and title_el.text:
                text = N.clean_text(title_el.text)

        if not text or len(text) < 5:
            return None

        # الرابط
        post_url = ""
        link_el = item.find("link")
        if link_el is not None:
            post_url = (link_el.text or link_el.get("href", "")).strip()
        if not post_url:
            atom_link = item.find("{http://www.w3.org/2005/Atom}link")
            if atom_link is not None:
                post_url = atom_link.get("href", "")

        # GUID (معرّف)
        guid = ""
        guid_el = item.find("guid") or item.find("{http://www.w3.org/2005/Atom}id")
        if guid_el is not None and guid_el.text:
            guid = guid_el.text

        post_id = self.make_post_id(
            N.extract_post_id(post_url) or guid, text
        )

        # التاريخ
        published_at = ""
        for tag in ["pubDate", "{http://www.w3.org/2005/Atom}published", "{http://www.w3.org/2005/Atom}updated"]:
            el = item.find(tag) if tag.startswith("{") else item.find(tag)
            if el is not None and el.text:
                published_at = N.parse_iso_date(el.text)
                if published_at:
                    break

        # صورة (من enclosure أو media:content)
        image_url = ""
        enc = item.find("enclosure")
        if enc is not None:
            image_url = enc.get("url", "")
        if not image_url:
            media = item.find("{http://search.yahoo.com/mrss/}content")
            if media is not None:
                image_url = media.get("url", "")
        if not image_url:
            # جرّب استخراج من description
            image_url = N.extract_first_image(text)

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
            reactions=0,  # RSS ما بيعطي تفاعلات
            comments=0,
            shares=0,
            source=self.source_name,
        )

    @staticmethod
    def _strip_html(html: str) -> str:
        """إزالة HTML tags من النص"""
        if not html:
            return ""
        import re as _re
        # احذف tags
        text = _re.sub(r"<[^>]+>", " ", html)
        # استبدل entities شائعة
        entities = {
            "&amp;": "&", "&lt;": "<", "&gt;": ">",
            "&quot;": '"', "&#39;": "'", "&nbsp;": " ",
        }
        for ent, val in entities.items():
            text = text.replace(ent, val)
        return text
