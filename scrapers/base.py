"""
Base Scraper Abstract Class
===========================
كل مصدر (Apify, FetchRSS, ...) يرث من هذا الـ class ويعطي نفس الـ schema
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional


@dataclass
class CommentData:
    """تعليق واحد على منشور"""
    comment_id: str = ""
    author_name: str = ""
    author_url: str = ""
    text: str = ""
    created_at: str = ""
    likes: int = 0
    replies_count: int = 0


@dataclass
class MediaItem:
    """صورة أو فيديو أو مرفق"""
    type: str = "image"  # image | video | gif | external_link
    url: str = ""
    thumbnail: str = ""
    width: int = 0
    height: int = 0
    duration_seconds: int = 0  # للفيديوهات


@dataclass
class UnifiedPost:
    """
    Schema الموحّد لأي منشور، مهما كان المصدر.
    الواجهة (app.js) تعتمد على هذا الشكل فقط.
    """

    # معرّفات
    post_id: str
    page_slug: str
    page_name: str
    page_url: str

    # المحتوى الأساسي
    text: str = ""
    post_url: str = ""

    # الميديا (التوافق مع القديم: image_url + video_url)
    image_url: str = ""               # أول صورة (للتوافق الخلفي)
    video_url: str = ""               # أول فيديو (للتوافق الخلفي)
    media: list[dict] = field(default_factory=list)  # كل الميديا

    # التواريخ
    published_at: str = ""
    scraped_at: str = ""
    timestamp_text: str = ""

    # التفاعلات
    reactions: int = 0
    comments: int = 0
    shares: int = 0

    # تفاصيل التفاعلات (إن توفّرت من المصدر)
    reactions_breakdown: dict = field(default_factory=dict)
    # مثال: {"like": 100, "love": 50, "haha": 5, "wow": 2, "sad": 1, "angry": 0}

    # التعليقات الفعلية (لو المصدر يدعمها مثل Apify)
    comments_data: list[dict] = field(default_factory=list)

    # معلومات الكاتب (إن توفّرت)
    author_name: str = ""
    author_url: str = ""

    # meta
    source: str = "unknown"
    post_type: str = "text"  # text | photo | video | live | event | link
    tags: list[str] = field(default_factory=list)
    hashtags: list[str] = field(default_factory=list)
    mentions: list[str] = field(default_factory=list)
    external_links: list[str] = field(default_factory=list)
    is_pinned: bool = False
    is_sponsored: bool = False
    language: str = ""
    raw: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        """تحويل لـ dict نظيف للتخزين JSON"""
        d = asdict(self)
        d.pop("raw", None)
        return d

    def is_valid(self) -> bool:
        """التحقق من الحد الأدنى من البيانات"""
        return bool(self.post_id and self.text and len(self.text) >= 5)

    def derive_post_type(self) -> str:
        """استنتاج نوع المنشور من الميديا"""
        if self.video_url or any(m.get("type") == "video" for m in self.media):
            return "video"
        if self.image_url or any(m.get("type") == "image" for m in self.media):
            return "photo"
        if self.external_links:
            return "link"
        return "text"

    def extract_hashtags(self) -> None:
        """استخراج الـ hashtags من النص"""
        import re as _re
        if self.text and not self.hashtags:
            self.hashtags = list(set(_re.findall(r"#(\S+)", self.text)))


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
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
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
            date_from: أقدم تاريخ للمنشورات (ISO 8601) - اختياري
            date_to: أحدث تاريخ للمنشورات (ISO 8601) - اختياري

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

    @staticmethod
    def post_in_date_range(
        post: UnifiedPost,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> bool:
        """
        فحص هل المنشور ضمن النطاق الزمني.
        لو ما عنده published_at، يعتبره ضمن النطاق (ما نرفضه).
        """
        if not date_from and not date_to:
            return True
        if not post.published_at:
            return True  # لا نرفض بدون تاريخ

        try:
            post_dt = datetime.fromisoformat(post.published_at.replace("Z", "+00:00"))
        except ValueError:
            return True

        if date_from:
            try:
                from_dt = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
                if from_dt.tzinfo is None:
                    from_dt = from_dt.replace(tzinfo=timezone.utc)
                if post_dt < from_dt:
                    return False
            except ValueError:
                pass

        if date_to:
            try:
                to_dt = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
                if to_dt.tzinfo is None:
                    to_dt = to_dt.replace(tzinfo=timezone.utc)
                if post_dt > to_dt:
                    return False
            except ValueError:
                pass

        return True

    @staticmethod
    def filter_by_date(
        posts: list[UnifiedPost],
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> list[UnifiedPost]:
        """فلترة قائمة منشورات حسب النطاق الزمني"""
        if not date_from and not date_to:
            return posts
        return [p for p in posts if BaseScraper.post_in_date_range(p, date_from, date_to)]

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} enabled={self.enabled} priority={self.priority}>"
