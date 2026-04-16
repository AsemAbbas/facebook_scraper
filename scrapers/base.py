"""
Base Scraper Abstract Class
===========================
كل مصدر (Apify, FetchRSS, ...) يرث من هذا الـ class ويعطي نفس الـ schema
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any


@dataclass
class UnifiedPost:
    """
    Schema الموحّد لأي منشور، مهما كان المصدر.
    الواجهة (app.js) تعتمد على هذا الشكل فقط.
    """

    # معرّفات
    post_id: str                      # معرّف فريد للمنشور
    page_slug: str                    # slug الصفحة (من pages.json)
    page_name: str                    # اسم الصفحة بالعربي
    page_url: str                     # رابط الصفحة الأصلي

    # المحتوى
    text: str = ""                    # نص المنشور
    post_url: str = ""                # رابط المنشور المباشر
    image_url: str = ""               # رابط أول صورة (إن وُجدت)
    video_url: str = ""               # رابط فيديو (إن وُجد)

    # التواريخ
    published_at: str = ""            # وقت النشر (ISO 8601)
    scraped_at: str = ""              # وقت السحب
    timestamp_text: str = ""          # النص الأصلي للوقت ("قبل 3 ساعات")

    # التفاعلات (0 لو المصدر ما يوفرها - مثل RSS)
    reactions: int = 0
    comments: int = 0
    shares: int = 0

    # meta
    source: str = "unknown"           # apify | fetchrss | rssapp | rsshub | playwright
    raw: dict = field(default_factory=dict)  # البيانات الأصلية (للـ debugging)

    def to_dict(self) -> dict:
        """تحويل لـ dict نظيف للتخزين JSON"""
        d = asdict(self)
        # احذف الـ raw في الإخراج النهائي (حجم كبير)
        d.pop("raw", None)
        return d

    def is_valid(self) -> bool:
        """التحقق من الحد الأدنى من البيانات"""
        return bool(self.post_id and self.text and len(self.text) >= 5)


class ScraperError(Exception):
    """خطأ عام في scraping"""
    pass


class SourceUnavailableError(ScraperError):
    """المصدر غير متاح (token مفقود، endpoint down...)"""
    pass


class RateLimitError(ScraperError):
    """تم الوصول لحد الطلبات"""
    pass


class BaseScraper(ABC):
    """
    Abstract base class - كل مصدر يرث منها ويعمل override لـ scrape_page
    """

    # اسم المصدر (apify, fetchrss, ...) - override في subclass
    source_name: str = "base"

    def __init__(self, config: dict):
        """
        Args:
            config: الإعدادات من config.yml لهذا المصدر
        """
        self.config = config
        self.enabled = config.get("enabled", False)
        self.priority = config.get("priority", 99)

    @abstractmethod
    async def scrape_page(
        self,
        page_url: str,
        page_slug: str,
        page_name: str,
        max_posts: int = 20,
    ) -> list[UnifiedPost]:
        """
        سحب منشورات من صفحة واحدة.

        يجب أن يرجع List[UnifiedPost] - حتى لو فاضية.
        يجب أن يرفع SourceUnavailableError إذا المصدر معطّل.

        Args:
            page_url: رابط الصفحة الكامل
            page_slug: slug الصفحة (للتعريف)
            page_name: اسم الصفحة بالعربي
            max_posts: الحد الأقصى للمنشورات

        Returns:
            قائمة من UnifiedPost
        """
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """
        فحص سريع: هل المصدر شغال؟ (token صحيح، API متاحة)
        يُستخدم قبل محاولة scraping فعلية.
        """
        ...

    # ===== Helpers مشتركة =====

    @staticmethod
    def now_iso() -> str:
        """التوقيت الحالي ISO 8601 UTC"""
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def make_post_id(raw_id: str, fallback_text: str = "") -> str:
        """
        إنشاء معرّف فريد للمنشور.
        يستخدم الـ raw_id إن وُجد، وإلا يعمل hash من النص.
        """
        if raw_id:
            return str(raw_id)
        return f"hash_{abs(hash(fallback_text[:100]))}"

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} enabled={self.enabled} priority={self.priority}>"
