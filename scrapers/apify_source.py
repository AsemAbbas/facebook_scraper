"""
Apify Source
============
يشغّل Apify Actor (facebook-posts-scraper) عبر REST API ويسحب النتائج.
https://apify.com/apify/facebook-posts-scraper

✅ أفضل جودة: residential proxies + تفاعلات + تعليقات
💰 Starter plan: $49/شهر
🆓 Free trial: $5 credits شهرياً

طريقة العمل:
  1. المستخدم ينشئ حساب Apify
  2. يحفظ APIFY_TOKEN كـ GitHub Secret
  3. هذا الـ adapter يشغّل الـ Actor + ينتظر النتيجة + يحوّلها
"""

import asyncio
from typing import Any

import aiohttp

from .base import BaseScraper, UnifiedPost, SourceUnavailableError, RateLimitError
from .normalizer import PostNormalizer as N


APIFY_BASE = "https://api.apify.com/v2"


class ApifySource(BaseScraper):
    """تشغيل Apify Actor عبر API"""

    source_name = "apify"

    def __init__(self, config: dict):
        super().__init__(config)
        self.token = config.get("token", "")
        self.actor_id = config.get("actor_id", "apify/facebook-posts-scraper")
        self.timeout_seconds = config.get("timeout_seconds", 600)
        self.max_retries = config.get("max_retries", 2)

        # Apify يستبدل / بـ ~ في الـ URL
        self.actor_id_url = self.actor_id.replace("/", "~")

        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    async def health_check(self) -> bool:
        """تأكد من صلاحية Apify token"""
        if not self.token:
            return False
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{APIFY_BASE}/users/me",
                    headers=self.headers,
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as r:
                    return r.status == 200
        except Exception:
            return False

    async def scrape_page(
        self,
        page_url: str,
        page_slug: str,
        page_name: str,
        max_posts: int = 20,
    ) -> list[UnifiedPost]:
        if not self.token:
            raise SourceUnavailableError(
                "[apify] APIFY_TOKEN غير موجود. أضفه في GitHub Secrets."
            )

        print(f"  💎 [apify] تشغيل actor للصفحة: {page_url}")

        # 1. شغّل الـ Actor
        run_id = await self._start_run(page_url, max_posts)
        print(f"    ⏳ Run ID: {run_id} - في انتظار الانتهاء...")

        # 2. انتظر حتى ينتهي
        dataset_id = await self._wait_for_completion(run_id)

        # 3. اسحب النتائج
        items = await self._fetch_results(dataset_id)

        # 4. حوّل لـ UnifiedPost
        posts: list[UnifiedPost] = []
        for item in items[:max_posts]:
            post = self._normalize_item(item, page_slug, page_name, page_url)
            if post and post.is_valid():
                posts.append(post)
                preview = post.text[:50].replace("\n", " ")
                print(f"    ✓ #{len(posts)}: {preview}")

        return posts

    # ==================== Apify API Calls ====================

    async def _start_run(self, page_url: str, max_posts: int) -> str:
        """تشغيل actor وإرجاع run_id"""
        input_data = {
            "startUrls": [{"url": page_url}],
            "resultsLimit": max_posts,
            "proxyConfiguration": {
                "useApifyProxy": True,
                "apifyProxyGroups": ["RESIDENTIAL"],
            },
        }

        url = f"{APIFY_BASE}/acts/{self.actor_id_url}/runs"

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=self.headers,
                json=input_data,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as r:
                if r.status == 429:
                    raise RateLimitError("[apify] تم الوصول لحد الطلبات")
                if r.status != 201:
                    body = await r.text()
                    raise SourceUnavailableError(
                        f"[apify] فشل تشغيل actor: HTTP {r.status} - {body[:200]}"
                    )
                data = await r.json()
                return data["data"]["id"]

    async def _wait_for_completion(self, run_id: str) -> str:
        """
        انتظر لحين انتهاء الـ run.
        يرجع dataset_id للنتائج.
        """
        url = f"{APIFY_BASE}/actor-runs/{run_id}"

        elapsed = 0
        poll_interval = 10

        async with aiohttp.ClientSession() as session:
            while elapsed < self.timeout_seconds:
                async with session.get(
                    url,
                    headers=self.headers,
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as r:
                    if r.status != 200:
                        await asyncio.sleep(poll_interval)
                        elapsed += poll_interval
                        continue

                    data = await r.json()
                    status = data["data"]["status"]
                    dataset_id = data["data"]["defaultDatasetId"]

                    if status == "SUCCEEDED":
                        return dataset_id
                    elif status in ("FAILED", "ABORTED", "TIMED_OUT"):
                        raise SourceUnavailableError(
                            f"[apify] run {run_id} انتهى بحالة: {status}"
                        )

                await asyncio.sleep(poll_interval)
                elapsed += poll_interval

        raise SourceUnavailableError(
            f"[apify] انتهت المهلة ({self.timeout_seconds}s) قبل انتهاء الـ run"
        )

    async def _fetch_results(self, dataset_id: str) -> list[dict]:
        """اسحب البنود من dataset"""
        url = f"{APIFY_BASE}/datasets/{dataset_id}/items?clean=true&format=json"

        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers=self.headers,
                timeout=aiohttp.ClientTimeout(total=60),
            ) as r:
                if r.status != 200:
                    raise SourceUnavailableError(
                        f"[apify] فشل سحب النتائج: HTTP {r.status}"
                    )
                return await r.json()

    # ==================== Normalization ====================

    def _normalize_item(
        self,
        item: dict,
        page_slug: str,
        page_name: str,
        page_url: str,
    ) -> UnifiedPost | None:
        """
        Apify facebook-posts-scraper schema (شائع):
        {
          "postId": "...",
          "text": "...",
          "url": "...",
          "time": "2026-04-16T10:30:00.000Z",
          "likes": 1234,
          "comments": 56,
          "shares": 23,
          "media": [{"photo_image": {"uri": "..."}}],
          ...
        }
        """
        text = item.get("text") or item.get("message") or item.get("caption") or ""
        text = N.clean_text(text)

        if not text or len(text) < 5:
            return None

        post_id = str(
            item.get("postId")
            or item.get("id")
            or item.get("post_id")
            or N.extract_post_id(item.get("url", ""))
            or self.make_post_id("", text)
        )

        post_url = item.get("url") or item.get("postUrl") or ""
        post_url = N.normalize_fb_url(post_url)

        # Image
        image_url = ""
        media = item.get("media") or []
        if isinstance(media, list) and media:
            first = media[0]
            if isinstance(first, dict):
                image_url = (
                    first.get("photo_image", {}).get("uri")
                    or first.get("url")
                    or first.get("thumbnail")
                    or ""
                )
        if not image_url:
            image_url = item.get("imageUrl") or item.get("image") or ""

        # Video
        video_url = ""
        if media:
            for m in media if isinstance(media, list) else []:
                if isinstance(m, dict):
                    vu = m.get("video_url") or m.get("playable_url")
                    if vu:
                        video_url = vu
                        break

        # التفاعلات
        reactions = N.parse_engagement(
            item.get("likes")
            or item.get("reactions")
            or item.get("likesCount")
            or item.get("reactionsCount")
        )
        comments = N.parse_engagement(
            item.get("comments")
            or item.get("commentsCount")
            or 0
        )
        shares = N.parse_engagement(
            item.get("shares")
            or item.get("sharesCount")
            or 0
        )

        # التاريخ
        published_at = N.parse_iso_date(
            item.get("time")
            or item.get("timestamp")
            or item.get("publishedAt")
            or item.get("created_time")
        )

        return UnifiedPost(
            post_id=post_id,
            page_slug=page_slug,
            page_name=page_name,
            page_url=page_url,
            text=N.truncate(text, 2000),
            post_url=post_url,
            image_url=image_url,
            video_url=video_url,
            published_at=published_at,
            scraped_at=self.now_iso(),
            timestamp_text="",
            reactions=reactions,
            comments=comments,
            shares=shares,
            source=self.source_name,
        )
