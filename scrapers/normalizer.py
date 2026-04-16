"""
Post Normalizer
===============
أدوات تنظيف وتوحيد النصوص والأرقام من مصادر مختلفة
"""

import re
from datetime import datetime, timezone
from typing import Optional


class PostNormalizer:
    """مجموعة دوال static لتنظيف البيانات من أي مصدر"""

    # ------ تنظيف النصوص ------

    @staticmethod
    def clean_text(text: Optional[str]) -> str:
        """تنظيف النصوص العربية والإنجليزية"""
        if not text:
            return ""
        text = str(text)
        # إزالة المسافات الزائدة
        text = re.sub(r"\s+", " ", text)
        # إزالة كلمات "عرض المزيد"
        for noise in ["عرض المزيد", "See more", "See More", "عرض الترجمة", "See Translation"]:
            text = text.replace(noise, "")
        return text.strip()

    @staticmethod
    def truncate(text: str, max_length: int = 2000) -> str:
        """قصّ النص عند الحد الأقصى"""
        if not text:
            return ""
        return text[:max_length]

    # ------ تحليل الأرقام ------

    @staticmethod
    def parse_engagement(value) -> int:
        """
        تحويل '1.2K', '3.5 ألف', '1.5M' إلى رقم.
        يدعم الأرقام العربية والإنجليزية.
        """
        if value is None:
            return 0
        if isinstance(value, (int, float)):
            return int(value)

        text = str(value).strip().lower().replace(",", "").replace("٬", "")

        # تحويل الأرقام العربية
        arabic_nums = "٠١٢٣٤٥٦٧٨٩"
        english_nums = "0123456789"
        trans = str.maketrans(arabic_nums, english_nums)
        text = text.translate(trans)

        multipliers = {
            "k": 1_000, "ك": 1_000, "ألف": 1_000, "الف": 1_000,
            "m": 1_000_000, "م": 1_000_000, "مليون": 1_000_000,
            "b": 1_000_000_000, "مليار": 1_000_000_000,
        }

        for suffix, mult in multipliers.items():
            if suffix in text:
                num_match = re.search(r"[\d.]+", text)
                if num_match:
                    try:
                        return int(float(num_match.group()) * mult)
                    except ValueError:
                        return 0

        num_match = re.search(r"\d+", text)
        return int(num_match.group()) if num_match else 0

    # ------ التواريخ ------

    @staticmethod
    def parse_iso_date(value) -> str:
        """
        تحويل أي تاريخ لـ ISO 8601 UTC.
        يدعم: datetime، timestamp، string بأشكال مختلفة.
        """
        if not value:
            return ""

        if isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            return value.isoformat()

        if isinstance(value, (int, float)):
            # Unix timestamp
            try:
                return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
            except (ValueError, OSError):
                return ""

        if isinstance(value, str):
            # جرّب ISO مباشرة
            try:
                dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.isoformat()
            except ValueError:
                pass

            # جرّب RFC 2822 (مثل "Mon, 16 Apr 2026 10:30:00 +0000")
            try:
                from email.utils import parsedate_to_datetime
                dt = parsedate_to_datetime(value)
                if dt:
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    return dt.isoformat()
            except (TypeError, ValueError):
                pass

        return ""

    # ------ روابط ------

    @staticmethod
    def normalize_fb_url(url: str) -> str:
        """تحويل رابط فيسبوك نسبي لمطلق"""
        if not url:
            return ""
        url = str(url).strip()
        if url.startswith("//"):
            return "https:" + url
        if url.startswith("/"):
            return "https://www.facebook.com" + url
        if url.startswith("http"):
            return url
        return "https://www.facebook.com/" + url.lstrip("/")

    @staticmethod
    def extract_post_id(url: str) -> Optional[str]:
        """استخراج ID المنشور من الرابط"""
        if not url:
            return None
        patterns = [
            r"/posts/(?:pfbid)?([a-zA-Z0-9_-]+)",
            r"/photos/(?:pcb\.)?(\d+)",
            r"/videos/(\d+)",
            r"story_fbid=(\d+)",
            r"/permalink/(\d+)",
        ]
        for pattern in patterns:
            m = re.search(pattern, url)
            if m:
                return m.group(1)
        return None

    # ------ صور ------

    @staticmethod
    def extract_first_image(html_or_obj) -> str:
        """استخراج أول صورة من HTML أو object"""
        if not html_or_obj:
            return ""
        if isinstance(html_or_obj, dict):
            # ترتيب حسب الأولوية لـ RSS feeds
            for key in ["enclosure", "image", "thumbnail", "media_url", "image_url"]:
                val = html_or_obj.get(key)
                if val:
                    if isinstance(val, dict):
                        val = val.get("url") or val.get("@url") or ""
                    if val:
                        return str(val)
        if isinstance(html_or_obj, str):
            m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', html_or_obj)
            if m:
                return m.group(1)
        return ""
