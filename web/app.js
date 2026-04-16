// =============================================
// مَرصَد · Frontend Logic
// =============================================

const STATE = {
  index: null,
  allPosts: [],
  filtered: [],
  pages: {},
};

const els = {
  pageFilter: document.getElementById('pageFilter'),
  sortFilter: document.getElementById('sortFilter'),
  searchInput: document.getElementById('searchInput'),
  minReactions: document.getElementById('minReactions'),
  postsGrid: document.getElementById('postsGrid'),
  resultCount: document.getElementById('resultCount'),
  refreshBtn: document.getElementById('refreshBtn'),
  triggerBtn: document.getElementById('triggerBtn'),
  exportBtn: document.getElementById('exportBtn'),
  lastUpdateText: document.getElementById('lastUpdateText'),
  statPages: document.getElementById('statPages'),
  statPosts: document.getElementById('statPosts'),
  statReactions: document.getElementById('statReactions'),
  statComments: document.getElementById('statComments'),
  sourcesUsed: document.getElementById('sourcesUsed'),
  sourceFilter: document.getElementById('sourceFilter'),
  modal: document.getElementById('modal'),
  modalClose: document.getElementById('modalClose'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
};

// ============= التهيئة =============

async function init() {
  await loadIndex();
  await loadAllPages();
  setupListeners();
  applyFilters();
}

async function loadIndex() {
  try {
    const res = await fetch('data/index.json?t=' + Date.now());
    if (!res.ok) throw new Error('No index file yet');
    STATE.index = await res.json();
    renderPageFilter();
    updateLastUpdate(STATE.index.last_run);
  } catch (e) {
    console.warn('لا يوجد index.json بعد:', e.message);
    STATE.index = { pages: [], last_run: null };
    showEmpty('لا توجد بيانات بعد. شغّل GitHub Actions أولاً، أو اضغط زر "سحب الآن" لإرشادات التشغيل.');
  }
}

async function loadAllPages() {
  if (!STATE.index?.pages?.length) return;
  const pages = STATE.index.pages.filter(p => p.status === 'success');

  const results = await Promise.allSettled(
    pages.map(async (p) => {
      const res = await fetch(`data/${p.slug}.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`Failed to load ${p.slug}`);
      return res.json();
    })
  );

  STATE.allPosts = [];
  STATE.pages = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const data = r.value;
      STATE.pages[data.page_slug] = data;
      data.posts.forEach(post => {
        STATE.allPosts.push({
          ...post,
          page_slug: data.page_slug,
          page_name: post.page_name || data.page_name,
        });
      });
    }
  });

  updateStats();
}

function renderPageFilter() {
  const opts = ['<option value="all">كل الصفحات</option>'];
  (STATE.index.pages || []).forEach(p => {
    if (p.status === 'success') {
      opts.push(`<option value="${p.slug}">${escapeHtml(p.name)}</option>`);
    }
  });
  els.pageFilter.innerHTML = opts.join('');
}

// ============= الفلاتر =============

function applyFilters() {
  let posts = [...STATE.allPosts];

  const pageVal = els.pageFilter.value;
  if (pageVal !== 'all') {
    posts = posts.filter(p => p.page_slug === pageVal);
  }

  if (els.sourceFilter) {
    const sourceVal = els.sourceFilter.value;
    if (sourceVal && sourceVal !== 'all') {
      posts = posts.filter(p => p.source === sourceVal);
    }
  }

  const search = els.searchInput.value.trim().toLowerCase();
  if (search) {
    posts = posts.filter(p => (p.text || '').toLowerCase().includes(search));
  }

  const minReact = parseInt(els.minReactions.value) || 0;
  if (minReact > 0) {
    posts = posts.filter(p => (p.reactions || 0) >= minReact);
  }

  const sortVal = els.sortFilter.value;
  posts.sort((a, b) => {
    switch (sortVal) {
      case 'reactions': return (b.reactions || 0) - (a.reactions || 0);
      case 'comments': return (b.comments || 0) - (a.comments || 0);
      case 'shares': return (b.shares || 0) - (a.shares || 0);
      case 'newest':
      default:
        return new Date(b.published_at || b.scraped_at || 0) - new Date(a.published_at || a.scraped_at || 0);
    }
  });

  STATE.filtered = posts;
  renderPosts();
}

// ============= الرندر =============

function renderPosts() {
  const posts = STATE.filtered;
  els.resultCount.textContent = `${posts.length.toLocaleString('en-US')} منشور`;

  if (posts.length === 0) {
    showEmpty('لا توجد نتائج تطابق الفلاتر الحالية');
    return;
  }

  els.postsGrid.innerHTML = posts.slice(0, 100).map((post, i) => {
    const reactions = post.reactions || 0;
    const comments = post.comments || 0;
    const shares = post.shares || 0;
    const isHigh = reactions >= 1000;
    const hasEngagement = reactions || comments || shares;
    const sourceBadge = renderSourceBadge(post.source);
    const imageHtml = post.image_url
      ? `<div class="post-image"><img src="${escapeHtml(post.image_url)}" alt="" loading="lazy" onerror="this.parentElement.remove()"></div>`
      : '';

    return `
      <article class="post-card" style="animation-delay: ${Math.min(i * 30, 600)}ms">
        <div class="post-header">
          <div class="post-page">${escapeHtml(post.page_name)}</div>
          <div class="post-time">${formatTime(post.timestamp_text, post.published_at || post.scraped_at)}</div>
        </div>
        ${imageHtml}
        <div class="post-text">${escapeHtml(post.text || '')}</div>
        <div class="post-engagement">
          ${hasEngagement ? `
            <div class="engagement-item ${isHigh ? 'high' : ''}">
              ❤ <strong>${formatNum(reactions)}</strong>
            </div>
            <div class="engagement-item">
              💬 <strong>${formatNum(comments)}</strong>
            </div>
            <div class="engagement-item">
              ↗ <strong>${formatNum(shares)}</strong>
            </div>
          ` : `
            <div class="engagement-item no-data" title="هذا المصدر لا يوفر بيانات التفاعل">
              ⊘ بدون تفاعلات
            </div>
          `}
          ${sourceBadge}
          ${post.post_url ? `<a href="${escapeHtml(post.post_url)}" target="_blank" rel="noopener" class="post-link">فتح ↗</a>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

function renderSourceBadge(source) {
  if (!source || source === 'unknown') return '';
  const badges = {
    apify:      { icon: '💎', label: 'Apify',     className: 'premium' },
    fetchrss:   { icon: '🪶', label: 'FetchRSS',  className: 'rss' },
    rssapp:     { icon: '⚡', label: 'RSS.app',   className: 'rss' },
    rsshub:     { icon: '🏠', label: 'RSSHub',    className: 'rss' },
    playwright: { icon: '🎭', label: 'Playwright',className: 'local' },
  };
  const b = badges[source];
  if (!b) return '';
  return `<span class="source-badge ${b.className}" title="المصدر: ${b.label}">${b.icon} ${b.label}</span>`;
}

function showEmpty(msg) {
  els.postsGrid.innerHTML = `<div class="empty">${escapeHtml(msg)}</div>`;
}

function updateStats() {
  const totalReactions = STATE.allPosts.reduce((s, p) => s + (p.reactions || 0), 0);
  const totalComments = STATE.allPosts.reduce((s, p) => s + (p.comments || 0), 0);
  els.statPages.textContent = Object.keys(STATE.pages).length;
  els.statPosts.textContent = formatNum(STATE.allPosts.length);
  els.statReactions.textContent = formatNum(totalReactions);
  els.statComments.textContent = formatNum(totalComments);

  // إظهار المصادر المستخدمة
  const sources = STATE.index?.sources_used || [];
  if (els.sourcesUsed && sources.length) {
    els.sourcesUsed.textContent = `المصادر: ${sources.join(' · ')}`;
  }
}

function updateLastUpdate(iso) {
  if (!iso) {
    els.lastUpdateText.textContent = 'لم يتم التشغيل بعد';
    return;
  }
  const date = new Date(iso);
  const now = new Date();
  const diffMin = Math.round((now - date) / 60000);

  let text;
  if (diffMin < 1) text = 'الآن';
  else if (diffMin < 60) text = `قبل ${diffMin} دقيقة`;
  else if (diffMin < 1440) text = `قبل ${Math.round(diffMin / 60)} ساعة`;
  else text = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  els.lastUpdateText.textContent = `آخر تحديث: ${text}`;
}

// ============= الأدوات =============

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNum(n) {
  if (!n) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString('en-US');
}

function formatTime(timestampText, scrapedAt) {
  if (timestampText && timestampText.length < 30) return timestampText;
  if (scrapedAt) {
    return new Date(scrapedAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
    });
  }
  return '';
}

function showToast(msg, type = '') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ============= التصدير =============

function exportCSV() {
  if (STATE.filtered.length === 0) {
    showToast('لا توجد منشورات للتصدير', 'error');
    return;
  }
  const headers = ['الصفحة', 'النص', 'التفاعلات', 'التعليقات', 'المشاركات', 'الوقت', 'الرابط'];
  const rows = STATE.filtered.map(p => [
    p.page_name,
    (p.text || '').replace(/"/g, '""'),
    p.reactions || 0,
    p.comments || 0,
    p.shares || 0,
    p.timestamp_text || p.scraped_at || '',
    p.post_url || '',
  ]);
  const csv = '\uFEFF' + [headers, ...rows]
    .map(r => r.map(c => `"${c}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `marsad_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`تم تصدير ${STATE.filtered.length} منشور`, 'success');
}

// ============= Modal تشغيل GitHub Actions =============

function openTriggerModal() {
  const repoInfo = detectRepoInfo();

  els.modalTitle.textContent = '🚀 تشغيل سحب جديد';
  els.modalBody.innerHTML = `
    <div class="modal-instructions">
      <p>لتشغيل سحب جديد، استخدم أحد الخيارات:</p>

      <h3 style="margin-top:1rem;font-size:1rem;">⚡ تشغيل سريع (GitHub)</h3>
      <ol>
        <li>افتح <a href="${repoInfo.actionsUrl}" target="_blank">صفحة Actions في الريبو</a></li>
        <li>اختر "Facebook Pages Scraper"</li>
        <li>اضغط "Run workflow"</li>
      </ol>

      <h3 style="margin-top:1rem;font-size:1rem;">🔑 تشغيل من هنا (يحتاج Token)</h3>
      <p>أنشئ <a href="https://github.com/settings/tokens/new?scopes=repo&description=marsad-trigger" target="_blank">Personal Access Token</a> بصلاحية <code>repo</code>، ثم الصقه:</p>

      <input type="password" id="ghToken" class="input" placeholder="ghp_..." style="width:100%;margin:8px 0;">
      <button class="btn-trigger" id="runWorkflowBtn" style="width:100%;justify-content:center;">
        تشغيل الـ Workflow الآن
      </button>

      <p style="margin-top:1rem;font-size:0.8rem;color:var(--muted);">
        ⏱️ السحب يستغرق 3-5 دقائق. الصفحة ستحتاج تحديث بعدها.
      </p>

      <h3 style="margin-top:1rem;font-size:1rem;">📅 الجدول التلقائي</h3>
      <p>السكريبت يعمل تلقائياً كل ساعتين دون تدخل.</p>
    </div>
  `;
  els.modal.classList.add('active');

  document.getElementById('runWorkflowBtn').addEventListener('click', () => {
    triggerWorkflow(repoInfo);
  });
}

function detectRepoInfo() {
  // GitHub Pages URLs: USERNAME.github.io/REPO/
  const host = location.hostname;
  const path = location.pathname;
  let owner = '', repo = '';

  if (host.endsWith('.github.io')) {
    owner = host.replace('.github.io', '');
    const parts = path.split('/').filter(Boolean);
    repo = parts[0] || `${owner}.github.io`;
  } else {
    owner = 'YOUR_USERNAME';
    repo = 'YOUR_REPO';
  }

  return {
    owner, repo,
    actionsUrl: `https://github.com/${owner}/${repo}/actions`,
    apiUrl: `https://api.github.com/repos/${owner}/${repo}/actions/workflows/scrape.yml/dispatches`,
  };
}

async function triggerWorkflow(repoInfo) {
  const token = document.getElementById('ghToken').value.trim();
  if (!token) {
    showToast('الصق التوكن أولاً', 'error');
    return;
  }

  try {
    const res = await fetch(repoInfo.apiUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    });

    if (res.status === 204) {
      showToast('✅ تم بدء السحب! انتظر 3-5 دقائق ثم حدّث الصفحة', 'success');
      els.modal.classList.remove('active');
      // حفظ التوكن للاستخدامات القادمة (في localStorage فقط على المتصفح)
      try { localStorage.setItem('marsad_token', token); } catch {}
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(`فشل: ${err.message || res.status}`, 'error');
    }
  } catch (e) {
    showToast(`خطأ: ${e.message}`, 'error');
  }
}

// ============= Listeners =============

function setupListeners() {
  els.pageFilter.addEventListener('change', applyFilters);
  els.sortFilter.addEventListener('change', applyFilters);
  els.searchInput.addEventListener('input', debounce(applyFilters, 300));
  els.minReactions.addEventListener('input', debounce(applyFilters, 300));
  if (els.sourceFilter) {
    els.sourceFilter.addEventListener('change', applyFilters);
  }
  els.exportBtn.addEventListener('click', exportCSV);
  els.refreshBtn.addEventListener('click', async () => {
    els.refreshBtn.disabled = true;
    await init();
    els.refreshBtn.disabled = false;
    showToast('تم تحديث البيانات', 'success');
  });
  els.triggerBtn.addEventListener('click', openTriggerModal);
  els.modalClose.addEventListener('click', () => els.modal.classList.remove('active'));
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) els.modal.classList.remove('active');
  });

  // استرجاع التوكن المحفوظ
  document.addEventListener('input', (e) => {
    if (e.target.id === 'ghToken' && !e.target.value) {
      try {
        const saved = localStorage.getItem('marsad_token');
        if (saved) e.target.value = saved;
      } catch {}
    }
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ============= انطلاق =============
init();
