"""
Generic RSS / Atom Source
=========================
يقرأ أي RSS أو Atom feed مباشرة من رابطه، بدون أي مزوّد محدد.

طريقة العمل:
  المستخدم يحط رابط RSS كـ page.url، الكود يقرأه مباشرة
  بدون authentication. يدعم:
    - RSS 2.0 (channel/item)
    - Atom (feed/entry)
    - feed مولّد من أي خدمة (FetchRSS, RSS.app, RSSHub, custom, إلخ)

🆓 مجاني - لا يحتاج token ولا API key
✅ يدعم أي RSS feed valid
⚠️ التفاعلات (reactions/comments/shares) عادة 0 لأن RSS ما يحملها
⚠️ الميديا تعتمد على ما يحطه الـ feed (enclosure / media:content / img tags)
"""

import asyncio
import re
import xml.etree.ElementTree as ET
from typing import Optional

import aiohttp

from .base import BaseScraper, UnifiedPost, SourceUnavailableError
from .normalizer import PostNormalizer as N


# Common XML namespaces في RSS feeds
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "media": "http://search.yahoo.com/mrss/",
    "dc": "http://purl.org/dc/elements/1.1/",
    "georss": "http://www.georss.org/georss",
}

ATOM_NS = "{http://www.w3.org/2005/Atom}"
CONTENT_NS = "{http://purl.org/rss/1.0/modules/content/}"
MEDIA_NS = "{http://search.yahoo.com/mrss/}"
DC_NS = "{http://purl.org/dc/elements/1.1/}"


class RSSSource(BaseScraper):
    """قراءة أي RSS / Atom feed عبر URL مباشر"""

    source_name = "rss"

    def __init__(self, config: dict):
        super().__init__(config)
        self.timeout = aiohttp.ClientTimeout(total=int(config.get("timeout_seconds", 30)))
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Marsad/5.4) RSS Reader",
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        }

    async def health_check(self) -> bool:
        """ما في endpoint health مركزي - الـ source صالح طالما الـ URL يقدر يجيب RSS"""
        return True

    @staticmethod
    def looks_like_rss_url(url: str) -> bool:
        """
        يحدد إذا كان الـ URL على الأرجح RSS feed (للـ auto-routing).
        أي URL مش facebook.com يعتبر RSS تلقائياً.
        """
        if not url:
            return False
        u = url.lower().strip()
        if "facebook.com" in u or "fb.com" in u or "fbcdn.net" in u:
            return False
        # علامات RSS واضحة
        if any(hint in u for hint in [
            "/rss", ".xml", "/feed", "feed.", "atom.xml",
            "rsshub", "fetchrss.com", "rss.app",
        ]):
            return True
        # أي URL غير facebook → نفترض RSS
        return True

    async def scrape_page(
        self,
        page_url: str,
        page_slug: str,
        page_name: str,
        max_posts: int = 20,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> list[UnifiedPost]:
        if not page_url:
            raise SourceUnavailableError("[rss] الصفحة بدون رابط feed")

        feed_url = page_url.strip()
        print(f"  📡 [rss] قراءة: {feed_url}")

        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as session:
                async with session.get(feed_url, headers=self.headers, allow_redirects=True) as r:
                    if r.status != 200:
                        raise SourceUnavailableError(f"[rss] HTTP {r.status} من {feed_url}")
                    xml_text = await r.text()
        except asyncio.TimeoutError as e:
            raise SourceUnavailableError("[rss] انتهت مهلة الطلب") from e
        except aiohttp.ClientError as e:
            raise SourceUnavailableError(f"[rss] خطأ شبكة: {e}") from e

        posts = self._parse_feed(xml_text, page_slug, page_name, page_url, max_posts * 2)
        posts = self.filter_by_date(posts, date_from, date_to)
        return posts[:max_posts]

    # ==================== Parsing ====================

    def _parse_feed(
        self,
        xml_text: str,
        page_slug: str,
        page_name: str,
        page_url: str,
        max_items: int,
    ) -> list[UnifiedPost]:
        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError as e:
            print(f"  ⚠️  [rss] فشل parse XML: {e}")
            return []

        # RSS 2.0: channel/item   |   Atom: feed/entry
        items = root.findall(".//item") or root.findall(f".//{ATOM_NS}entry")

        results: list[UnifiedPost] = []
        for item in items[:max_items]:
            try:
                post = self._parse_item(item, page_slug, page_name, page_url)
                if post and post.is_valid():
                    results.append(post)
            except Exception as e:
                print(f"  ⚠️  [rss] فشل parse item: {e}")
                continue

        return results

    def _parse_item(
        self,
        item: ET.Element,
        page_slug: str,
        page_name: str,
        page_url: str,
    ) -> Optional[UnifiedPost]:
        # ---- النص: نجرّب content:encoded ثم description ثم summary ثم title ----
        text_html = ""
        for tag in (f"{CONTENT_NS}encoded", "description", f"{ATOM_NS}content",
                    "content", f"{ATOM_NS}summary", "summary"):
            el = item.find(tag)
            if el is not None and (el.text or "").strip():
                text_html = el.text
                break

        text = self._strip_html(text_html)
        text = N.clean_text(text)

        if len(text) < 5:
            # نجرّب نستخدم العنوان كنص
            for tag in ("title", f"{ATOM_NS}title"):
                el = item.find(tag)
                if el is not None and (el.text or "").strip():
                    text = N.clean_text(el.text)
                    break

        if len(text) < 5:
            return None

        # ---- الرابط ----
        post_url = ""
        link_el = item.find("link")
        if link_el is not None:
            post_url = ((link_el.text or "") or link_el.get("href", "")).strip()
        if not post_url:
            for atom_link in item.findall(f"{ATOM_NS}link"):
                href = atom_link.get("href", "")
                rel = atom_link.get("rel", "")
                if href and rel in ("", "alternate"):
                    post_url = href
                    break

        # ---- GUID ----
        guid = ""
        for tag in ("guid", f"{ATOM_NS}id"):
            el = item.find(tag)
            if el is not None and (el.text or "").strip():
                guid = el.text.strip()
                break

        # هوية مستقرة - فضّل الـ permalink/pfbid، fallback إلى guid، ثم hash النص
        post_id = self.make_post_id(
            N.extract_post_id(post_url) or guid,
            text,
        )

        # ---- التاريخ ----
        published_at = ""
        for tag in ("pubDate", f"{ATOM_NS}published", f"{ATOM_NS}updated", f"{DC_NS}date"):
            el = item.find(tag)
            if el is not None and (el.text or "").strip():
                parsed = N.parse_iso_date(el.text)
                if parsed:
                    published_at = parsed
                    break

        # ---- الميديا ----
        image_url = ""
        video_url = ""
        media_items: list[dict] = []

        # 1. enclosure (RSS standard)
        for enc in item.findall("enclosure"):
            url = enc.get("url", "")
            mime = (enc.get("type") or "").lower()
            if not url:
                continue
            if "video" in mime or url.lower().endswith((".mp4", ".mov", ".webm")):
                video_url = video_url or url
                media_items.append({"type": "video", "url": url, "thumbnail": "", "width": 0, "height": 0, "duration_seconds": 0})
            else:
                image_url = image_url or url
                media_items.append({"type": "image", "url": url, "thumbnail": url, "width": 0, "height": 0, "duration_seconds": 0})

        # 2. media:content (Yahoo Media RSS)
        for m in item.findall(f"{MEDIA_NS}content"):
            url = m.get("url", "")
            if not url:
                continue
            mime = (m.get("type") or "").lower()
            mtype = "video" if "video" in mime else "image"
            if mtype == "video" and not video_url:
                video_url = url
            if mtype == "image" and not image_url:
                image_url = url
            media_items.append({
                "type": mtype, "url": url, "thumbnail": m.get("thumbnail") or url,
                "width": int(m.get("width") or 0),
                "height": int(m.get("height") or 0),
                "duration_seconds": int(m.get("duration") or 0),
            })

        # 3. media:thumbnail
        for thumb in item.findall(f"{MEDIA_NS}thumbnail"):
            url = thumb.get("url", "")
            if url and not image_url:
                image_url = url

        # 4. صور من HTML داخل description
        if text_html:
            for img_url in re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', text_html):
                if not image_url:
                    image_url = img_url
                # أضف للقائمة لو مش موجود
                if not any(m["url"] == img_url for m in media_items):
                    media_items.append({
                        "type": "image", "url": img_url, "thumbnail": img_url,
                        "width": 0, "height": 0, "duration_seconds": 0,
                    })

        # ---- إنشاء الـ UnifiedPost ----
        post = UnifiedPost(
            post_id=post_id,
            page_slug=page_slug,
            page_name=page_name,
            page_url=page_url,
            text=N.truncate(text, 2000),
            post_url=post_url,
            image_url=image_url,
            video_url=video_url,
            media=media_items,
            published_at=published_at,
            scraped_at=self.now_iso(),
            timestamp_text="",
            reactions=0,    # RSS عادة ما بيوفر تفاعلات
            comments=0,
            shares=0,
            source=self.source_name,
        )
        post.extract_hashtags()
        post.post_type = post.derive_post_type()
        return post

    @staticmethod
    def _strip_html(html: str) -> str:
        """إزالة HTML tags + decode entities"""
        if not html:
            return ""
        # احذف tags
        text = re.sub(r"<[^>]+>", " ", html)
        # entities شائعة
        entities = {
            "&amp;": "&", "&lt;": "<", "&gt;": ">",
            "&quot;": '"', "&apos;": "'", "&#39;": "'",
            "&nbsp;": " ", "&hellip;": "…", "&mdash;": "—",
            "&ndash;": "–", "&ldquo;": "“", "&rdquo;": "”",
        }
        for k, v in entities.items():
            text = text.replace(k, v)
        # numeric entities &#1234;
        text = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), text)
        text = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), text)
        # normalize whitespace
        text = re.sub(r"\s+", " ", text).strip()
        return text
