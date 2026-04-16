"""
مَرصَد · Main Orchestrator
==========================
السكريبت الرئيسي: يقرأ config.yml + pages.json،
ويدير السحب عبر المصادر المتعددة مع fallback تلقائي.

الاستخدام:
    python scripts/run.py               # تشغيل كل الصفحات
    python scripts/run.py --slug aljazeera  # صفحة واحدة
    python scripts/run.py --source apify    # إجبار مصدر محدد
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# يسمح بتشغيل السكريبت من أي مكان
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    import yaml
except ImportError:
    print("❌ PyYAML غير مثبت. شغّل: pip install pyyaml")
    sys.exit(1)

from scrapers.base import BaseScraper, UnifiedPost, SourceUnavailableError
from scrapers.apify_source import ApifySource
from scrapers.fetchrss_source import FetchRSSSource
from scrapers.rssapp_source import RSSAppSource
from scrapers.rsshub_source import RSSHubSource
from scrapers.playwright_source import PlaywrightSource


# خريطة أسماء المصادر لـ classes
SOURCE_REGISTRY: dict[str, type[BaseScraper]] = {
    "apify": ApifySource,
    "fetchrss": FetchRSSSource,
    "rssapp": RSSAppSource,
    "rsshub": RSSHubSource,
    "playwright": PlaywrightSource,
}


class MarsadOrchestrator:
    """المنظّم الرئيسي - يدير كل المصادر والصفحات"""

    def __init__(self, config_path: Path, pages_path: Path):
        self.config = self._load_config(config_path)
        self.pages = self._load_pages(pages_path)
        self.output_dir = PROJECT_ROOT / self.config.get("output", {}).get("dir", "web/data")
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # بناء instances لكل المصادر (بترتيب الأولوية)
        self.sources: list[BaseScraper] = self._build_sources()

        # إعدادات fallback
        fb = self.config.get("fallback", {})
        self.fallback_enabled = fb.get("enabled", True)
        self.max_attempts = fb.get("max_attempts", 3)
        self.retry_delay = fb.get("retry_delay_seconds", 5)

        # keep_history
        self.keep_history = self.config.get("output", {}).get("keep_history", 200)

    # ==================== Loading ====================

    @staticmethod
    def _load_config(path: Path) -> dict:
        """قراءة config.yml مع استبدال ${ENV_VAR}"""
        text = path.read_text(encoding="utf-8")

        # استبدل ${VAR_NAME} بقيم environment
        def replacer(match: re.Match) -> str:
            var_name = match.group(1)
            return os.environ.get(var_name, "")

        text = re.sub(r"\$\{([A-Z_][A-Z0-9_]*)\}", replacer, text)
        return yaml.safe_load(text)

    @staticmethod
    def _load_pages(path: Path) -> list[dict]:
        """قراءة pages.json"""
        data = json.loads(path.read_text(encoding="utf-8"))
        return [p for p in data.get("pages", []) if p.get("enabled", True)]

    def _build_sources(self) -> list[BaseScraper]:
        """بناء instances لكل المصادر المفعّلة، مرتبة حسب الأولوية"""
        sources: list[BaseScraper] = []
        for src_config in self.config.get("sources", []):
            name = src_config.get("name", "")
            if not src_config.get("enabled"):
                continue
            scraper_cls = SOURCE_REGISTRY.get(name)
            if not scraper_cls:
                print(f"⚠️  مصدر غير معروف: {name}")
                continue
            sources.append(scraper_cls(src_config))
        # الأقل priority = الأعلى أولوية
        sources.sort(key=lambda s: s.priority)
        return sources

    # ==================== Main Flow ====================

    async def run(self, slug_filter: str | None = None, force_source: str | None = None) -> None:
        """الـ entry point الرئيسي"""
        self._print_banner()

        if not self.sources:
            print("❌ لا يوجد مصدر مفعّل! فعّل مصدر واحد على الأقل في config.yml")
            sys.exit(1)

        print(f"🔌 المصادر المفعّلة (حسب الأولوية):")
        for s in self.sources:
            print(f"   [{s.priority}] {s.source_name}")
        print()

        # فلترة الصفحات
        target_pages = self.pages
        if slug_filter:
            target_pages = [p for p in self.pages if p["slug"] == slug_filter]
            if not target_pages:
                print(f"❌ slug غير موجود: {slug_filter}")
                sys.exit(1)

        print(f"📄 سحب {len(target_pages)} صفحة\n")

        # ملخص التشغيل
        summary: dict[str, Any] = {
            "last_run": datetime.now(timezone.utc).isoformat(),
            "pages": [],
            "sources_used": [],
            "total_new_posts": 0,
        }

        # سحب كل صفحة
        for page in target_pages:
            print(f"{'=' * 60}")
            print(f"📌 {page['name']} ({page['slug']})")
            print(f"{'=' * 60}")

            result = await self._scrape_single_page(page, force_source)
            summary["pages"].append(result)

            if result.get("source_used") and result["source_used"] not in summary["sources_used"]:
                summary["sources_used"].append(result["source_used"])

            summary["total_new_posts"] += result.get("new_posts", 0)
            print()

        # احفظ index
        self._save_index(summary)
        self._print_final_summary(summary)

    async def _scrape_single_page(
        self,
        page: dict,
        force_source: str | None,
    ) -> dict:
        """سحب صفحة واحدة مع fallback"""
        slug = page["slug"]
        name = page["name"]
        url = page["url"]
        max_posts = page.get("max_posts", 20)
        preferred = page.get("source", "auto")  # auto أو اسم مصدر

        # تحديد أي المصادر نجرب
        candidates = self._select_sources_for_page(preferred, force_source)

        if not candidates:
            return {
                "slug": slug, "name": name, "url": url,
                "status": "error", "error": "لا يوجد مصدر متاح",
                "total_posts": 0, "new_posts": 0,
            }

        # جرّب كل مصدر
        attempts = 0
        last_error = ""

        for source in candidates:
            if attempts >= self.max_attempts:
                break
            attempts += 1

            try:
                new_posts = await source.scrape_page(url, slug, name, max_posts)

                if not new_posts:
                    print(f"  ⚠️  {source.source_name}: ما رجع أي منشور")
                    last_error = "لم يتم سحب أي منشور"
                    if self.fallback_enabled and attempts < len(candidates):
                        await asyncio.sleep(self.retry_delay)
                        continue
                    # ما في fallback وما في نتائج → سجّل كفشل
                    return {
                        "slug": slug, "name": name, "url": url,
                        "status": "empty",
                        "source_used": source.source_name,
                        "total_posts": 0, "new_posts": 0,
                    }

                # دمج مع الموجود
                merged = self._merge_posts(slug, new_posts)

                # احفظ
                self._save_page_data(slug, name, url, merged)

                new_count = sum(
                    1 for p in new_posts
                    if not any(e.post_id == p.post_id for e in merged[len(new_posts):])
                )

                print(f"\n✅ {source.source_name}: {len(new_posts)} منشور سُحب، {len(merged)} إجمالي")

                return {
                    "slug": slug, "name": name, "url": url,
                    "status": "success",
                    "source_used": source.source_name,
                    "total_posts": len(merged),
                    "new_posts": new_count,
                    "last_updated": datetime.now(timezone.utc).isoformat(),
                }

            except SourceUnavailableError as e:
                print(f"  ⚠️  {source.source_name} غير متاح: {e}")
                last_error = str(e)
                if self.fallback_enabled:
                    await asyncio.sleep(self.retry_delay)
                    continue
            except Exception as e:
                print(f"  ❌ {source.source_name} خطأ غير متوقع: {e}")
                last_error = str(e)
                if self.fallback_enabled:
                    await asyncio.sleep(self.retry_delay)
                    continue

        # كل المحاولات فشلت
        return {
            "slug": slug, "name": name, "url": url,
            "status": "error",
            "error": last_error or "فشلت كل المحاولات",
            "total_posts": 0, "new_posts": 0,
        }

    def _select_sources_for_page(
        self,
        preferred: str,
        force_source: str | None,
    ) -> list[BaseScraper]:
        """
        اختيار المصادر المناسبة لصفحة معينة.
        - force_source: مصدر محدد إجبارياً (من CLI)
        - preferred == "auto": كل المصادر حسب الأولوية
        - preferred == اسم مصدر: هذا المصدر أولاً، ثم الباقي كـ fallback
        """
        if force_source:
            return [s for s in self.sources if s.source_name == force_source]

        if preferred and preferred != "auto":
            primary = [s for s in self.sources if s.source_name == preferred]
            fallbacks = [s for s in self.sources if s.source_name != preferred]
            return primary + (fallbacks if self.fallback_enabled else [])

        return list(self.sources)

    # ==================== Data Management ====================

    def _merge_posts(self, slug: str, new_posts: list[UnifiedPost]) -> list[UnifiedPost]:
        """دمج المنشورات الجديدة مع الموجودة (منع التكرار)"""
        file_path = self.output_dir / f"{slug}.json"
        existing: list[dict] = []
        if file_path.exists():
            try:
                data = json.loads(file_path.read_text(encoding="utf-8"))
                existing = data.get("posts", [])
            except Exception:
                existing = []

        existing_ids = {p["post_id"] for p in existing}

        # المنشورات الجديدة (غير المكررة) أولاً
        truly_new = [p for p in new_posts if p.post_id not in existing_ids]
        new_ids = {p.post_id for p in truly_new}

        # الاحتفاظ بالموجود (ما عدا المكررات في new)
        kept_existing = [p for p in existing if p["post_id"] not in new_ids]

        # دمج: جديد أولاً، ثم القديم
        merged_dicts = [p.to_dict() for p in truly_new] + kept_existing

        # قص التاريخ حسب الـ limit
        return [
            UnifiedPost(**self._safe_post(p)) if isinstance(p, dict) else p
            for p in merged_dicts[:self.keep_history]
        ]

    @staticmethod
    def _safe_post(d: dict) -> dict:
        """تأكد من وجود كل الحقول المطلوبة"""
        defaults = {
            "post_id": "", "page_slug": "", "page_name": "", "page_url": "",
            "text": "", "post_url": "", "image_url": "", "video_url": "",
            "published_at": "", "scraped_at": "", "timestamp_text": "",
            "reactions": 0, "comments": 0, "shares": 0,
            "source": "unknown",
        }
        return {**defaults, **{k: v for k, v in d.items() if k in defaults}}

    def _save_page_data(
        self,
        slug: str,
        name: str,
        url: str,
        posts: list[UnifiedPost],
    ) -> None:
        """حفظ بيانات صفحة في web/data/{slug}.json"""
        data = {
            "page_slug": slug,
            "page_name": name,
            "page_url": url,
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "total_posts": len(posts),
            "posts": [p.to_dict() for p in posts],
        }
        file_path = self.output_dir / f"{slug}.json"
        file_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _save_index(self, summary: dict) -> None:
        """حفظ index.json - الواجهة تقرأه"""
        index_file = self.output_dir / self.config.get("output", {}).get("index_file", "index.json")
        index_file.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ==================== UI ====================

    def _print_banner(self) -> None:
        print()
        print("=" * 60)
        print("  🔍 مَرصَد · Facebook Pages Monitor v2.0")
        print("=" * 60)
        print()

    def _print_final_summary(self, summary: dict) -> None:
        print("=" * 60)
        print("  🏁 ملخص التشغيل")
        print("=" * 60)

        success = sum(1 for p in summary["pages"] if p["status"] == "success")
        failed = sum(1 for p in summary["pages"] if p["status"] == "error")
        empty = sum(1 for p in summary["pages"] if p["status"] == "empty")

        print(f"  ✅ نجحت: {success}")
        print(f"  ❌ فشلت: {failed}")
        print(f"  ⚪ فارغة: {empty}")
        print(f"  📊 منشورات جديدة: {summary['total_new_posts']}")
        print(f"  🔌 المصادر المستخدمة: {', '.join(summary['sources_used']) or 'لا شيء'}")
        print()
        print(f"  📁 النتائج في: {self.output_dir}")
        print()


# ==================== CLI ====================

def main():
    parser = argparse.ArgumentParser(description="مَرصَد - سحب منشورات صفحات فيسبوك")
    parser.add_argument("--slug", help="سحب صفحة محددة فقط")
    parser.add_argument("--source", help="إجبار مصدر محدد (apify/fetchrss/rssapp/rsshub/playwright)")
    parser.add_argument(
        "--config",
        default=str(PROJECT_ROOT / "config.yml"),
        help="مسار config.yml",
    )
    parser.add_argument(
        "--pages",
        default=str(PROJECT_ROOT / "pages.json"),
        help="مسار pages.json",
    )
    args = parser.parse_args()

    config_path = Path(args.config)
    pages_path = Path(args.pages)

    if not config_path.exists():
        print(f"❌ config.yml غير موجود: {config_path}")
        sys.exit(1)
    if not pages_path.exists():
        print(f"❌ pages.json غير موجود: {pages_path}")
        sys.exit(1)

    orchestrator = MarsadOrchestrator(config_path, pages_path)
    asyncio.run(orchestrator.run(
        slug_filter=args.slug,
        force_source=args.source,
    ))


if __name__ == "__main__":
    main()
