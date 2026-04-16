"""
مَرصَد · Local Runner
=====================
يشغّل السحب محلياً ويدفع البيانات تلقائياً للريبو على GitHub.

الحل البديل لما GitHub Actions يكون معطّل (billing/quota):
  1. يشغّل scripts/run.py
  2. يعمل git add web/data/
  3. يعمل commit + push

الاستخدام:
    python scripts/local_run.py                  # كل الصفحات
    python scripts/local_run.py --slug aljazeera # صفحة واحدة
    python scripts/local_run.py --no-push        # سحب فقط، بدون push
    python scripts/local_run.py --loop 360       # كرر كل 360 دقيقة (6 ساعات)
"""

from __future__ import annotations

import argparse
import asyncio
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from scripts.run import MarsadOrchestrator


def run_git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    """ينفّذ أمر git في مجلد المشروع"""
    return subprocess.run(
        ["git", *args],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=check,
        encoding="utf-8",
        errors="replace",
    )


def has_uncommitted_data() -> bool:
    """هل في تغييرات في web/data/ غير مدفوعة؟"""
    try:
        result = run_git("status", "--porcelain", "web/data/", check=False)
        return bool(result.stdout.strip())
    except subprocess.CalledProcessError:
        return False


def commit_and_push() -> bool:
    """commit + push البيانات الجديدة. يرجع True لو نجح push."""
    if not has_uncommitted_data():
        print("  ℹ️  لا توجد تغييرات جديدة في web/data/")
        return False

    timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ")
    msg = f"data: local scrape · {timestamp}"

    try:
        run_git("add", "web/data/")
        run_git("commit", "-m", msg)
        print(f"  📝 commit: {msg}")
    except subprocess.CalledProcessError as e:
        print(f"  ❌ فشل commit: {e.stderr}")
        return False

    try:
        result = run_git("push", check=False)
        if result.returncode != 0:
            print(f"  ⚠️  فشل push:\n{result.stderr}")
            return False
        print("  🚀 push نجح - البيانات الآن على GitHub")
        return True
    except subprocess.CalledProcessError as e:
        print(f"  ❌ فشل push: {e.stderr}")
        return False


async def run_once(slug: str | None = None, source: str | None = None,
                    date_from: str | None = None, date_to: str | None = None,
                    push: bool = True) -> None:
    """تشغيل واحد للسحب + push اختياري"""
    config = PROJECT_ROOT / "config.yml"
    pages = PROJECT_ROOT / "pages.json"

    orchestrator = MarsadOrchestrator(config, pages)
    await orchestrator.run(
        slug_filter=slug,
        force_source=source,
        date_from=date_from,
        date_to=date_to,
    )

    if push:
        print("\n" + "=" * 60)
        print("  📤 رفع البيانات لـ GitHub")
        print("=" * 60)
        commit_and_push()


def loop_run(interval_min: int, **kwargs) -> None:
    """يعيد التشغيل كل X دقيقة"""
    cycle = 0
    while True:
        cycle += 1
        start = time.time()
        print(f"\n{'=' * 60}")
        print(f"  🔄 دورة #{cycle} · {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        print(f"{'=' * 60}\n")

        try:
            asyncio.run(run_once(**kwargs))
        except Exception as e:
            print(f"  ❌ فشل الـ run: {e}")

        elapsed = time.time() - start
        sleep_for = max(60, interval_min * 60 - int(elapsed))
        next_run = datetime.fromtimestamp(time.time() + sleep_for)
        print(f"\n  💤 الدورة القادمة: {next_run.strftime('%Y-%m-%d %H:%M')} "
              f"(بعد {sleep_for // 60} دقيقة)")
        try:
            time.sleep(sleep_for)
        except KeyboardInterrupt:
            print("\n  🛑 تم الإيقاف بواسطة المستخدم")
            sys.exit(0)


def main():
    parser = argparse.ArgumentParser(
        description="مَرصَد - السحب المحلي + push تلقائي",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--slug", help="سحب صفحة واحدة فقط")
    parser.add_argument("--source", help="إجبار مصدر")
    parser.add_argument("--date-from", help="من تاريخ (YYYY-MM-DD)")
    parser.add_argument("--date-to", help="إلى تاريخ (YYYY-MM-DD)")
    parser.add_argument("--no-push", action="store_true", help="سحب فقط، بدون push")
    parser.add_argument("--loop", type=int, metavar="MINUTES",
                        help="كرر كل X دقيقة (مثال: --loop 360 = كل 6 ساعات)")
    args = parser.parse_args()

    kwargs = dict(
        slug=args.slug,
        source=args.source,
        date_from=args.date_from,
        date_to=args.date_to,
        push=not args.no_push,
    )

    if args.loop:
        print(f"🔁 تشغيل دوري كل {args.loop} دقيقة (اضغط Ctrl+C للإيقاف)")
        loop_run(args.loop, **kwargs)
    else:
        asyncio.run(run_once(**kwargs))


if __name__ == "__main__":
    main()
