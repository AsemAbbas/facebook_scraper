"""
Marsad — Post Classification Module
====================================
يصنّف منشورات فيسبوك تلقائياً عبر OpenAI GPT.
"""

from .openai_classifier import classify_posts, CATEGORIES, ClassifierError

__all__ = ["classify_posts", "CATEGORIES", "ClassifierError"]
