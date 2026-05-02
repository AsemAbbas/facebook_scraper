"""
Arabic Text Normalization
=========================
يطبّع النصوص العربية لمطابقة موحّدة في البحث والكلمات المفتاحية.

المبدأ: نطبّع كل من نص المنشور ونص الكلمة المفتاحية بنفس القواعد، ثم
نطابقهم. النتيجة: "أسرى" و "اسرى" و "الأسرى" كلها تعتبر نفس الكلمة.

قواعد التطبيع:
  1. إزالة التشكيل (حركات الفتحة، الكسرة، الضمة، الشدة، السكون...)
  2. توحيد الألف بكل أشكالها → ا
       (ا، أ، إ، آ، ٱ → ا)
  3. توحيد الياء → ي  (ي، ى، ئ → ي)
  4. توحيد التاء المربوطة والهاء → ه  (ة، ه → ه)
  5. توحيد الواو → و  (و، ؤ → و)
  6. توحيد الكاف → ك  (ك، ﻙ → ك)
  7. حذف التطويل (ـ)
  8. توحيد المسافات (whitespace → space واحدة)
  9. lowercase للحروف اللاتينية المختلطة
 10. إزالة "ال" البادئة من أول الكلمة المفتاحية لمطابقة مع/بدون أداة التعريف

ملاحظة: نطبق التطبيع متناظرياً (نفس القواعد) على الكلمة وعلى نص المنشور،
فأي اختلاف في الكتابة الأصلية يتلاشى. تفاصيل النحو لا تهمنا — يهمنا
المطابقة العملية.
"""

import re
from typing import Optional


# ===========================================================================
# Regex patterns (compiled once)
# ===========================================================================

# التشكيل (حركات): U+0610 to U+061A و U+064B to U+065F و U+0670 (ألف خنجرية)
_DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭ]")

# الألف بكل أشكالها → ا
_ALIF_VARIANTS = re.compile(r"[آأإٱ]")  # آ أ إ ٱ

# الياء بكل أشكالها → ي  (ى ئ → ي)
_YAA_VARIANTS = re.compile(r"[ىئ]")  # ى ئ

# التاء المربوطة → ه
_TAA_MARBUTA = "ة"   # ة

# الواو الهمزة → و
_WAW_HAMZA = "ؤ"     # ؤ

# الكاف الفارسية → ك
_KAF_VARIANTS = re.compile(r"[کﮎﮏ]")  # ک

# التطويل (kashida) — يُستخدم للزخرفة
_TATWEEL = "ـ"

# whitespace متعدد
_MULTI_SPACE = re.compile(r"\s+")

# punctuation عربي + لاتيني (نحوّلها لمسافة لتسهيل المطابقة)
_PUNCT = re.compile(r"[،؛؟!\.\,\;\:\?\!\(\)\[\]\{\}\"'`~@#$%\^&\*\-_+=<>/\\|]")

# "ال" البادئة (definite article)
_AL_PREFIX = re.compile(r"^ال")


# ===========================================================================
# Public API
# ===========================================================================

def normalize(text: Optional[str]) -> str:
    """
    تطبيع نص عربي للمقارنة.

    لا تستخدمها لعرض النص — فقط للمقارنة الداخلية في DB أو memory.
    """
    if not text:
        return ""
    s = str(text)

    # 1. إزالة التشكيل
    s = _DIACRITICS.sub("", s)

    # 2. حذف التطويل
    s = s.replace(_TATWEEL, "")

    # 3. توحيد الألف
    s = _ALIF_VARIANTS.sub("ا", s)  # → ا

    # 4. توحيد الياء
    s = _YAA_VARIANTS.sub("ي", s)  # → ي

    # 5. توحيد التاء المربوطة
    s = s.replace(_TAA_MARBUTA, "ه")  # ة → ه

    # 6. توحيد الواو الهمزة
    s = s.replace(_WAW_HAMZA, "و")  # ؤ → و

    # 7. توحيد الكاف
    s = _KAF_VARIANTS.sub("ك", s)  # → ك

    # 8. lowercase للحروف اللاتينية
    s = s.lower()

    # 9. تحويل علامات الترقيم لمسافة (للمطابقة عبر الحدود)
    s = _PUNCT.sub(" ", s)

    # 10. توحيد المسافات
    s = _MULTI_SPACE.sub(" ", s).strip()

    return s


def normalize_keyword(text: Optional[str]) -> str:
    """
    تطبيع كلمة مفتاحية. مماثل لـ normalize() لكن يحذف "ال" البادئة
    لأن الكلمة "أسرى" يجب أن تطابق "الأسرى" في المنشور.

    مثال:
      "الأسرى"  → "اسرى"  (حذف ال + توحيد الألف)
      "أسرى"    → "اسرى"
      "اسرى"    → "اسرى"
    كل الأشكال تعطي نفس النتيجة → مطابقة موحّدة.
    """
    s = normalize(text)
    if not s:
        return ""
    # حذف "ال" البادئة من أول الكلمة المفتاحية فقط (مرة واحدة)
    s = _AL_PREFIX.sub("", s)
    return s.strip()


def keyword_matches(post_text: Optional[str], keyword: Optional[str],
                    mode: str = "contains") -> bool:
    """
    فحص هل المنشور يحتوي الكلمة المفتاحية بعد التطبيع.

    mode:
      contains — الكلمة موجودة كـ substring في النص (الافتراضي)
      exact    — النص بالكامل يساوي الكلمة
      hashtag  — الكلمة بعد # في النص
    """
    if not post_text or not keyword:
        return False
    norm_post = normalize(post_text)
    norm_kw = normalize_keyword(keyword)
    if not norm_kw:
        return False

    if mode == "exact":
        return norm_post == norm_kw or norm_post == "ال" + norm_kw
    if mode == "hashtag":
        # # علامة الترقيم تحوّلت لمسافة في normalize، فنبحث عن مسافة + الكلمة
        return norm_kw in norm_post  # بعد التطبيع تكون كأنها contains
    # contains
    return norm_kw in norm_post


# ===========================================================================
# Self-test
# ===========================================================================

if __name__ == "__main__":
    cases = [
        # (post_text, keyword, expected_match)
        ("الأسرى الفلسطينيون في السجون", "أسرى", True),
        ("الأسرى الفلسطينيون في السجون", "اسرى", True),
        ("الأسرى الفلسطينيون في السجون", "الأسرى", True),
        ("أَسْرَى محرّرون", "أسرى", True),  # مع تشكيل
        ("القُدْس عاصمتنا", "القدس", True),
        ("القُدْس عاصمتنا", "قدس", True),
        ("غزّة تصمد", "غزة", True),
        ("إيران تتحدّى", "ايران", True),
        ("الاستيطان غير شرعي", "استيطان", True),
        ("مستوطنين جدد", "مستوطنون", False),  # جذر مختلف
        ("منشور عادي", "أسرى", False),
    ]
    print("Arabic normalization self-test:")
    all_pass = True
    for post, kw, expected in cases:
        actual = keyword_matches(post, kw)
        status = "✓" if actual == expected else "✗"
        if actual != expected:
            all_pass = False
        print(f"  {status} keyword='{kw}' in post='{post[:30]}...' → {actual} (expected {expected})")
        if actual != expected:
            print(f"    norm_post='{normalize(post)}'")
            print(f"    norm_kw='{normalize_keyword(kw)}'")
    print("ALL PASS" if all_pass else "SOME FAILED")
