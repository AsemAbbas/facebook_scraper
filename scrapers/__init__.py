"""
مَرصَد · Multi-Source Facebook Scraper
=====================================
حزمة تحتوي على جميع الـ sources القابلة للتبديل
"""

from .base import BaseScraper, UnifiedPost
from .normalizer import PostNormalizer

__all__ = ["BaseScraper", "UnifiedPost", "PostNormalizer"]
__version__ = "2.0.0"
