"""
Apify Source
============
يشغّل Apify Actor عبر REST API ويسحب النتائج.

⚠️  مقفول على الـ actor: curious_coder/facebook-post-scraper حصرياً.
    لا يُسمح بأي actor آخر — أي قيمة actor_id تُتجاهل وتُستبدل بهذه.
    https://apify.com/curious_coder/facebook-post-scraper

✅ جودة ممتازة + يدعم pages/groups/search/profiles
💰 ~$5 per 1000 posts
🆓 Free trial: $5 credits شهرياً من Apify

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

# ⚠️  HARDCODED — لا تغيّره وإلا الكود مش هيشتغل (الـ input schema مربوط بهذا الـ actor).
# لو المستخدم حط قيمة ثانية في config، نتجاهلها ونسجّل warning.
LOCKED_ACTOR_ID = "curious_coder/facebook-post-scraper"


class ApifySource(BaseScraper):
    """تشغيل Apify Actor عبر API — مقفول على curious_coder/facebook-post-scraper"""

    source_name = "apify"

    def __init__(self, config: dict):
        super().__init__(config)
        self.token = config.get("token", "")

        # نتجاهل أي override للـ actor من الـ config - الكود مقفول على curious_coder
        configured = config.get("actor_id")
        if configured and configured != LOCKED_ACTOR_ID:
            print(f"[apify] ⚠️  تم تجاهل actor_id='{configured}' — الكود مقفول على {LOCKED_ACTOR_ID}")
        self.actor_id = LOCKED_ACTOR_ID
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
        # Input schema خاص بـ curious_coder/facebook-post-scraper
        # https://apify.com/curious_coder/facebook-post-scraper/input-schema
        #
        # Required: urls (array of strings)
        # Optional: count, outputFormat, sortType, scrapePhotos, cookie,
        #           minDelay (>=1), maxDelay (>=10), scrapeUntil, proxy
        input_data = {
            "urls": [page_url],           # array of strings (ليس startUrls)
            "count": max_posts,           # ليس resultsLimit
            "outputFormat": "simple",     # flat structure - أسهل للمعالجة
            "sortType": "new_posts",      # الأحدث أولاً
            "scrapePhotos": False,        # يزيد التكلفة وعدنا ميديا من attachments
        }

        # override اختياري من config (الحدود الدنيا للـ actor: 1 و 10 ثواني)
        user_min = self.config.get("min_delay")
        user_max = self.config.get("max_delay")
        if isinstance(user_min, int) and user_min >= 1:
            input_data["minDelay"] = user_min
        if isinstance(user_max, int) and user_max >= 10:
            input_data["maxDelay"] = user_max

        if date_from:
            input_data["scrapeUntil"] = date_from
        # cookie/proxy اختيارية — نتركها فاضية افتراضياً
        cookie_val = self.config.get("cookie")
        if cookie_val:
            input_data["cookie"] = cookie_val

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
        schema الخاص بـ curious_coder/facebook-post-scraper (outputFormat=simple):
          text, url, createdAt (unix ts), reactionCount, commentCount, shareCount,
          user.{id,name,url}, attachments, topComments
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

        # الميديا — المصادر محتملة:
        #   curious_coder/simple: attachments (list of objects with 'media', 'type', 'url', 'thumbnail')
        #   curious_coder/raw: nested deep structure
        #   apify/official: media (list of objects)
        #   fallbacks: single image_url / video_url / photos / videos
        media_items: list[dict] = []
        _seen_urls: set[str] = set()

        def _add_media(url: str, m_type: str = "", thumbnail: str = "",
                       width: int = 0, height: int = 0, duration: int = 0):
            """إضافة ميديا مع فحص التكرار وصحة الـ URL"""
            if not url or not isinstance(url, str):
                return
            if not url.startswith(("http://", "https://", "//")):
                return
            if url in _seen_urls:
                return
            _seen_urls.add(url)
            # auto-detect type from URL extension + domain hints
            low = url.lower()
            if any(ext in low for ext in (".mp4", ".mov", ".webm", ".m4v", ".mkv")):
                m_type = "video"
            elif "video" in low and not m_type:
                # fbcdn/video.xx.fbcdn.net → video
                m_type = "video"
            elif any(ext in low for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp")):
                m_type = m_type or "image"
            if not m_type:
                m_type = "image"
            media_items.append({
                "type": m_type,
                "url": url,
                "thumbnail": thumbnail or url,
                "width": int(width or 0),
                "height": int(height or 0),
                "duration_seconds": int(duration or 0),
            })

        def _extract_from_dict(m: dict):
            """حاول تستخرج url/type من dict بأكثر شكل ممكن"""
            if not isinstance(m, dict):
                return
            # nested photo_image: {uri: "..."}
            pi = m.get("photo_image")
            if isinstance(pi, dict):
                _add_media(pi.get("uri") or "", "image",
                          thumbnail=pi.get("uri") or "",
                          width=pi.get("width"), height=pi.get("height"))
            # video nested
            vid = m.get("video") or m.get("video_url") or m.get("playable_url")
            if isinstance(vid, dict):
                _add_media(vid.get("url") or vid.get("src") or "", "video",
                          thumbnail=m.get("thumbnail") or "",
                          duration=vid.get("duration") or m.get("duration"))
            elif isinstance(vid, str):
                _add_media(vid, "video", thumbnail=m.get("thumbnail") or "")

            # Generic url fields
            explicit_type = (m.get("type") or m.get("mediaType") or "").lower()
            t_hint = ""
            if any(k in explicit_type for k in ("video", "clip")):
                t_hint = "video"
            elif any(k in explicit_type for k in ("photo", "image", "gif")):
                t_hint = "image"
            elif any(k in explicit_type for k in ("link", "external")):
                t_hint = "external_link"

            for key in ("url", "src", "image", "media", "uri", "large_image", "largeImage",
                       "source_url", "sourceUrl", "original_url", "originalUrl"):
                val = m.get(key)
                if isinstance(val, dict):
                    # nested — recurse shallowly
                    url2 = val.get("url") or val.get("src") or val.get("uri") or ""
                    if url2:
                        _add_media(url2, t_hint,
                                  thumbnail=val.get("thumbnail") or val.get("thumbnailUrl") or "",
                                  width=val.get("width"), height=val.get("height"))
                elif isinstance(val, str) and val.startswith(("http", "//")):
                    _add_media(val, t_hint,
                              thumbnail=m.get("thumbnail") or m.get("thumbnailUrl") or "",
                              width=m.get("width"), height=m.get("height"),
                              duration=m.get("duration") or m.get("durationSeconds"))
            # thumbnail as standalone
            thumb = m.get("thumbnail") or m.get("thumbnailUrl")
            if isinstance(thumb, str) and not media_items:
                _add_media(thumb, t_hint or "image")

        # attachments / media / photos / videos arrays
        for key in ("attachments", "media", "photos", "videos", "images", "mediaItems"):
            raw = item.get(key)
            if not isinstance(raw, list):
                continue
            for m in raw:
                if isinstance(m, str):
                    _add_media(m)
                elif isinstance(m, dict):
                    _extract_from_dict(m)

        # Standalone single URLs as fallback
        for key, hint in (("imageUrl", "image"), ("image", "image"),
                          ("videoUrl", "video"), ("videoSource", "video"),
                          ("thumbnail", "image")):
            val = item.get(key)
            if isinstance(val, str):
                _add_media(val, hint)

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
