"""
Apify Source
============
يشغّل Apify Actor عبر REST API ويسحب النتائج.

المصدر الافتراضي: https://apify.com/curious_coder/facebook-post-scraper
✅ جودة ممتازة + يدعم pages/groups/search/profiles
💰 ~$5 per 1000 posts
🆓 Free trial: $5 credits شهرياً من Apify

يدعم أيضاً apify/facebook-posts-scraper (بـ input schema مختلف)
الكود يكتشف الـ schema المناسب حسب الـ actor_id.

طريقة العمل:
  1. المستخدم ينشئ حساب Apify ويأخذ token
  2. يضع Apify token في إعدادات المصدر من الواجهة
  3. هذا الـ adapter يشغّل الـ Actor + ينتظر النتيجة + يحوّلها
"""

import asyncio
from typing import Any

import aiohttp

from typing import Optional

from .base import BaseScraper, UnifiedPost, SourceUnavailableError, RateLimitError
from .normalizer import PostNormalizer as N


APIFY_BASE = "https://api.apify.com/v2"

# الافتراضي: curious_coder/facebook-post-scraper (أحدث + أرخص + يدعم groups + profiles)
DEFAULT_ACTOR_ID = "curious_coder/facebook-post-scraper"


class ApifySource(BaseScraper):
    """تشغيل Apify Actor عبر API"""

    source_name = "apify"

    def __init__(self, config: dict):
        super().__init__(config)
        self.token = config.get("token", "")
        self.actor_id = config.get("actor_id") or DEFAULT_ACTOR_ID
        self.timeout_seconds = config.get("timeout_seconds", 600)
        self.max_retries = config.get("max_retries", 2)

        # Apify يستبدل / بـ ~ في الـ URL
        self.actor_id_url = self.actor_id.replace("/", "~")

        # curious_coder و apify/facebook-posts-scraper يستعملان input schema مختلف.
        # نميّز بحسب الـ actor_id ونولّد الـ input المناسب.
        self.is_curious_coder = self.actor_id.startswith("curious_coder/")

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
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> list[UnifiedPost]:
        if not self.token:
            raise SourceUnavailableError(
                "[apify] APIFY_TOKEN غير موجود. أضفه في GitHub Secrets."
            )

        print(f"  💎 [apify] تشغيل actor للصفحة: {page_url}")
        if date_from or date_to:
            print(f"     📅 نطاق التاريخ: {date_from or '—'} → {date_to or '—'}")

        # 1. شغّل الـ Actor (مع date range لو مدعوم)
        run_id = await self._start_run(page_url, max_posts, date_from, date_to)
        print(f"    ⏳ Run ID: {run_id} - في انتظار الانتهاء...")

        # 2. انتظر حتى ينتهي
        dataset_id = await self._wait_for_completion(run_id)

        # 3. اسحب النتائج
        items = await self._fetch_results(dataset_id)

        # 4. حوّل لـ UnifiedPost + فلترة التاريخ
        posts: list[UnifiedPost] = []
        for item in items[:max_posts * 2]:  # اسحب ضعف العدد لأن فيه فلترة
            post = self._normalize_item(item, page_slug, page_name, page_url)
            if post and post.is_valid():
                if self.post_in_date_range(post, date_from, date_to):
                    posts.append(post)
                    preview = post.text[:50].replace("\n", " ")
                    print(f"    ✓ #{len(posts)}: {preview}")
                    if len(posts) >= max_posts:
                        break

        return posts

    # ==================== Apify API Calls ====================

    async def _start_run(
        self,
        page_url: str,
        max_posts: int,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> str:
        """تشغيل actor وإرجاع run_id"""
        # خيارات متقدمة من config
        max_comments = self.config.get("max_comments_per_post", 10)
        include_comments = self.config.get("include_comments", True)
        include_reactions_breakdown = self.config.get("include_reactions_breakdown", True)

        if self.is_curious_coder:
            # curious_coder/facebook-post-scraper input schema
            # https://apify.com/curious_coder/facebook-post-scraper/input-schema
            #
            # Required: urls (array of strings)
            # Optional: count, outputFormat, sortType, scrapePhotos, cookie,
            #           minDelay (>=1), maxDelay (>=10), scrapeUntil, proxy
            #
            # ملاحظة: الـ actor بيفرض maxDelay>=10 ثواني (rate-limit protection)
            # ومنه ما نحدد minDelay/maxDelay بنفسنا — نخليها على الـ defaults
            # (1 و 10) إلا إذا المستخدم override من config.
            input_data = {
                "urls": [page_url],           # array of strings
                "count": max_posts,           # not resultsLimit
                "outputFormat": "simple",     # flat structure - أسهل للمعالجة
                "sortType": "new_posts",      # الأحدث أولاً
                "scrapePhotos": False,        # يزيد التكلفة وعدنا ميديا من attachments
            }

            # override اختياري من config
            user_min = self.config.get("min_delay")
            user_max = self.config.get("max_delay")
            if isinstance(user_min, int) and user_min >= 1:
                input_data["minDelay"] = user_min
            if isinstance(user_max, int) and user_max >= 10:
                input_data["maxDelay"] = user_max

            if date_from:
                input_data["scrapeUntil"] = date_from
            # cookie/proxy اختيارية — يتركها فاضية افتراضياً
            cookie_val = self.config.get("cookie")
            if cookie_val:
                input_data["cookie"] = cookie_val
        else:
            # apify/facebook-posts-scraper legacy schema
            input_data = {
                "startUrls": [{"url": page_url}],
                "resultsLimit": max_posts,
                "proxyConfiguration": {
                    "useApifyProxy": True,
                    "apifyProxyGroups": ["RESIDENTIAL"],
                },
            }
            if include_comments and max_comments > 0:
                input_data["commentsLimit"] = max_comments
            if include_reactions_breakdown:
                input_data["likedBy"] = False
                input_data["reactions"] = True
            if date_from:
                input_data["onlyPostsNewerThan"] = date_from
            if date_to:
                input_data["onlyPostsOlderThan"] = date_to

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
                        f"[apify] فشل تشغيل actor {self.actor_id}: HTTP {r.status} - {body[:200]}"
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
        تحويل Apify item إلى UnifiedPost.
        يدعم كلا schema:
          - curious_coder/facebook-post-scraper: text, createdAt, reactionCount,
            commentCount, shareCount, user.{id,name,url}, attachments, topComments
          - apify/facebook-posts-scraper: message/text, time/timestamp, likes,
            comments, media, commentsData
        """
        # النص
        text = (
            item.get("text")
            or item.get("message")
            or item.get("caption")
            or item.get("content")
            or ""
        )
        text = N.clean_text(text)

        if not text or len(text) < 5:
            return None

        # المعرّف
        post_id = str(
            item.get("postId")
            or item.get("id")
            or item.get("post_id")
            or item.get("facebookId")
            or N.extract_post_id(item.get("url", "") or item.get("postUrl", ""))
            or self.make_post_id("", text)
        )

        # الرابط
        post_url = item.get("url") or item.get("postUrl") or item.get("link") or ""
        post_url = N.normalize_fb_url(post_url)

        # الميديا — attachments (curious_coder) أو media (apify/official)
        media_items: list[dict] = []
        raw_media = item.get("attachments") or item.get("media") or []
        if isinstance(raw_media, list):
            for m in raw_media:
                if isinstance(m, str):
                    # curious_coder attachments ممكن يكونوا strings (روابط مباشرة)
                    if m.startswith("http"):
                        media_items.append({
                            "type": "video" if any(ext in m.lower() for ext in (".mp4", ".mov", ".webm")) else "image",
                            "url": m,
                            "thumbnail": m,
                            "width": 0, "height": 0, "duration_seconds": 0,
                        })
                    continue
                if not isinstance(m, dict):
                    continue
                media_url = (
                    m.get("photo_image", {}).get("uri") if isinstance(m.get("photo_image"), dict) else None
                ) or m.get("url") or m.get("src") or m.get("image") or m.get("thumbnail") or ""
                if not media_url:
                    continue
                video_candidate = (
                    m.get("video_url") or m.get("playable_url") or m.get("videoUrl")
                )
                m_type = m.get("type") or ("video" if video_candidate else "image")
                actual_url = video_candidate or media_url
                media_items.append({
                    "type": m_type,
                    "url": actual_url,
                    "thumbnail": m.get("thumbnail") or m.get("thumbnailUrl") or media_url,
                    "width": int(m.get("width") or 0),
                    "height": int(m.get("height") or 0),
                    "duration_seconds": int(m.get("duration") or m.get("durationSeconds") or 0),
                })

        image_url = next((m["url"] for m in media_items if m["type"] == "image"), "")
        if not image_url:
            image_url = item.get("imageUrl") or item.get("image") or item.get("thumbnail") or ""

        video_url = next((m["url"] for m in media_items if m["type"] == "video"), "")

        # التفاعلات — curious_coder يستخدم reactionCount/commentCount/shareCount
        reactions = N.parse_engagement(
            item.get("reactionCount")
            or item.get("reactionsCount")
            or item.get("likes")
            or item.get("reactions")
            or item.get("likesCount")
            or 0
        )
        comments = N.parse_engagement(
            item.get("commentCount")
            or item.get("commentsCount")
            or item.get("comments")
            or 0
        )
        shares = N.parse_engagement(
            item.get("shareCount")
            or item.get("sharesCount")
            or item.get("shares")
            or 0
        )

        # تفاصيل التفاعلات (إن وُجدت)
        reactions_breakdown = {}
        rb = (
            item.get("reactionsBreakdown")
            or item.get("reactions_breakdown")
            or item.get("reactionDistribution")
            or {}
        )
        if isinstance(rb, dict):
            for k in ("like", "love", "haha", "wow", "sad", "angry", "care"):
                if k in rb:
                    reactions_breakdown[k] = int(rb[k] or 0)

        # التعليقات — curious_coder يستخدم topComments
        comments_data: list[dict] = []
        raw_comments = (
            item.get("topComments")
            or item.get("commentsData")
            or item.get("comments_data")
            or []
        )
        if isinstance(raw_comments, list):
            for c in raw_comments[:50]:
                if not isinstance(c, dict):
                    continue
                c_user = c.get("user") or c.get("author") or {}
                comments_data.append({
                    "comment_id": str(c.get("id") or c.get("commentId") or ""),
                    "author_name": str(
                        (c_user.get("name") if isinstance(c_user, dict) else "")
                        or c.get("authorName")
                        or c.get("name")
                        or ""
                    ),
                    "author_url": str(
                        (c_user.get("url") if isinstance(c_user, dict) else "")
                        or c.get("authorUrl")
                        or c.get("profileUrl")
                        or ""
                    ),
                    "text": N.clean_text(c.get("text") or c.get("message") or c.get("body") or ""),
                    "created_at": N.parse_iso_date(
                        c.get("createdAt") or c.get("date") or c.get("created_time")
                    ),
                    "likes": int(c.get("reactionCount") or c.get("likesCount") or c.get("likes") or 0),
                    "replies_count": int(c.get("repliesCount") or c.get("replyCount") or 0),
                })

        # التاريخ — curious_coder يستخدم createdAt كـ unix timestamp
        raw_date = (
            item.get("createdAt")
            or item.get("created_at")
            or item.get("time")
            or item.get("timestamp")
            or item.get("publishedAt")
            or item.get("created_time")
        )
        if isinstance(raw_date, (int, float)):
            # Unix timestamp → ISO
            from datetime import datetime, timezone
            try:
                ts = float(raw_date)
                # إذا كان بالـ milliseconds (13 digit) حوّله
                if ts > 1e12:
                    ts /= 1000
                published_at = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            except Exception:
                published_at = ""
        else:
            published_at = N.parse_iso_date(raw_date) if raw_date else ""

        # الكاتب — curious_coder يضع في user.{name,url,id}
        author_name = page_name
        author_url = page_url
        author_obj = item.get("user") or item.get("author") or item.get("owner") or {}
        if isinstance(author_obj, dict):
            author_name = author_obj.get("name") or author_obj.get("fullName") or page_name
            author_url = author_obj.get("url") or author_obj.get("profileUrl") or page_url

        # روابط خارجية
        external_links = []
        for link_field in ("externalLinks", "links", "linkAttachments"):
            val = item.get(link_field)
            if isinstance(val, list):
                for v in val:
                    if isinstance(v, str) and v.startswith("http"):
                        external_links.append(v)
                    elif isinstance(v, dict):
                        u = v.get("url") or v.get("href")
                        if u:
                            external_links.append(u)

        post = UnifiedPost(
            post_id=post_id,
            page_slug=page_slug,
            page_name=page_name,
            page_url=page_url,
            text=N.truncate(text, 2000),
            post_url=post_url,
            image_url=image_url,
            video_url=video_url,
            media=media_items,
            published_at=published_at,
            scraped_at=self.now_iso(),
            timestamp_text="",
            reactions=reactions,
            comments=comments,
            shares=shares,
            reactions_breakdown=reactions_breakdown,
            comments_data=comments_data,
            author_name=author_name,
            author_url=author_url,
            external_links=external_links[:5],
            is_pinned=bool(item.get("isPinned") or item.get("pinned")),
            is_sponsored=bool(item.get("isSponsored") or item.get("sponsored")),
            source=self.source_name,
        )
        post.extract_hashtags()
        post.post_type = post.derive_post_type()
        return post
