"""
Telegram Notification Script
============================
يفحص المنشورات الجديدة بعد كل تشغيل ويرسل تنبيه Telegram للعالية التفاعل
أو التي تحتوي كلمات مفتاحية معينة.

يُشغّل بعد scripts/run.py في GitHub Actions.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import aiohttp
import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class TelegramNotifier:
    """إرسال تنبيهات للمنشورات الجديدة عبر Telegram Bot API"""

    def __init__(self):
        self.config = self._load_config()
        tg = self.config.get("alerts", {}).get("telegram", {})

        self.enabled = tg.get("enabled", False)
        self.bot_token = self._resolve_env(tg.get("bot_token", ""))
        self.chat_id = self._resolve_env(tg.get("chat_id", ""))
        self.threshold = int(tg.get("high_engagement_threshold", 5000))
        self.keywords = tg.get("keywords", []) or []

        self.data_dir = PROJECT_ROOT / self.config.get("output", {}).get("dir", "web/data")
        self.alerted_file = PROJECT_ROOT / ".alerted_posts.json"

    @staticmethod
    def _load_config() -> dict:
        """قراءة config.yml مع استبدال ${ENV_VAR}"""
        path = PROJECT_ROOT / "config.yml"
        text = path.read_text(encoding="utf-8")

        def replacer(m: re.Match) -> str:
            return os.environ.get(m.group(1), "")

        text = re.sub(r"\$\{([A-Z_][A-Z0-9_]*)\}", replacer, text)
        return yaml.safe_load(text)

    @staticmethod
    def _resolve_env(val: str) -> str:
        """للحالات اللي ما تحل فيها البيئة تلقائياً"""
        if not val:
            return ""
        val = str(val)
        if val.startswith("${") and val.endswith("}"):
            return os.environ.get(val[2:-1], "")
        return val

    def _load_alerted_ids(self) -> set[str]:
        """المعرّفات اللي صار إرسال تنبيه عنها (عشان ما نكرر)"""
        if not self.alerted_file.exists():
            return set()
        try:
            data = json.loads(self.alerted_file.read_text(encoding="utf-8"))
            # احتفظ بآخر 500 فقط
            return set(data.get("ids", [])[-500:])
        except Exception:
            return set()

    def _save_alerted_ids(self, ids: set[str]) -> None:
        """حفظ المعرفات (آخر 500)"""
        data = {
            "ids": list(ids)[-500:],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self.alerted_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _find_matching_posts(self) -> list[dict]:
        """يمسح كل ملفات web/data/*.json ويرجع المنشورات المستحقة للتنبيه"""
        if not self.data_dir.exists():
            return []

        alerted_ids = self._load_alerted_ids()
        matches: list[dict] = []

        # فقط المنشورات من آخر 24 ساعة
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

        for json_file in self.data_dir.glob("*.json"):
            if json_file.name == "index.json":
                continue

            try:
                data = json.loads(json_file.read_text(encoding="utf-8"))
            except Exception:
                continue

            for post in data.get("posts", []):
                pid = post.get("post_id", "")
                if not pid or pid in alerted_ids:
                    continue

                # فحص الوقت
                scraped = post.get("scraped_at", "")
                if scraped:
                    try:
                        dt = datetime.fromisoformat(scraped.replace("Z", "+00:00"))
                        if dt < cutoff:
                            continue
                    except Exception:
                        pass

                # فحص الشروط
                reactions = int(post.get("reactions") or 0)
                text = str(post.get("text") or "")

                matched_reason = None

                # شرط 1: تفاعل عالي
                if reactions >= self.threshold:
                    matched_reason = f"تفاعل عالي ({reactions:,})"

                # شرط 2: كلمة مفتاحية
                if not matched_reason and self.keywords:
                    for kw in self.keywords:
                        if kw and kw in text:
                            matched_reason = f"ظهور كلمة: {kw}"
                            break

                if matched_reason:
                    post["_reason"] = matched_reason
                    matches.append(post)

        return matches

    async def send(self) -> None:
        """الـ entry point"""
        if not self.enabled:
            print("ℹ️  Telegram alerts غير مفعّلة")
            return

        if not self.bot_token or not self.chat_id:
            print("⚠️  Telegram bot_token أو chat_id مفقود")
            return

        matches = self._find_matching_posts()

        if not matches:
            print("✅ ما في منشورات جديدة تستحق تنبيه")
            return

        print(f"📨 إرسال تنبيهات لـ {len(matches)} منشور...")

        alerted_ids = self._load_alerted_ids()

        async with aiohttp.ClientSession() as session:
            for post in matches:
                try:
                    await self._send_one(session, post)
                    alerted_ids.add(post["post_id"])
                    # تأخير صغير بين الرسائل (rate limit)
                    await asyncio.sleep(0.5)
                except Exception as e:
                    print(f"  ⚠️  فشل إرسال تنبيه: {e}")

        self._save_alerted_ids(alerted_ids)
        print(f"✅ تم إرسال {len(matches)} تنبيه")

    async def _send_one(self, session: aiohttp.ClientSession, post: dict) -> None:
        """إرسال رسالة واحدة"""
        url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"

        text = self._format_message(post)

        payload = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": False,
        }

        async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=15)) as r:
            if r.status != 200:
                body = await r.text()
                raise Exception(f"HTTP {r.status}: {body[:200]}")

    def _format_message(self, post: dict) -> str:
        """تنسيق رسالة HTML"""
        reason = post.get("_reason", "تنبيه")
        page_name = self._escape_html(post.get("page_name", ""))
        text = self._escape_html(post.get("text", ""))[:500]
        reactions = int(post.get("reactions") or 0)
        comments = int(post.get("comments") or 0)
        shares = int(post.get("shares") or 0)
        post_url = post.get("post_url", "")
        source = post.get("source", "unknown")

        source_icons = {
            "apify": "💎", "fetchrss": "🪶", "rssapp": "⚡",
            "rsshub": "🏠", "playwright": "🎭",
        }
        src_icon = source_icons.get(source, "📰")

        msg_parts = [
            f"🚨 <b>{reason}</b>",
            "",
            f"📌 <b>{page_name}</b> {src_icon}",
            "",
            f"<i>{text}{'...' if len(post.get('text', '')) > 500 else ''}</i>",
            "",
        ]

        # الإحصاءات لو متوفرة
        if reactions or comments or shares:
            stats = []
            if reactions:
                stats.append(f"❤️ {reactions:,}")
            if comments:
                stats.append(f"💬 {comments:,}")
            if shares:
                stats.append(f"↗️ {shares:,}")
            msg_parts.append(" · ".join(stats))
            msg_parts.append("")

        if post_url:
            msg_parts.append(f'🔗 <a href="{post_url}">عرض المنشور</a>')

        return "\n".join(msg_parts)

    @staticmethod
    def _escape_html(s: str) -> str:
        """Escape HTML لـ Telegram"""
        if not s:
            return ""
        return (
            str(s)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )


def main():
    notifier = TelegramNotifier()
    asyncio.run(notifier.send())


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"❌ Telegram notify failed: {e}")
        # Exit 0 عشان ما نفشل الـ workflow لو Telegram فقط فشل
        sys.exit(0)
