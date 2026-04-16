// =====================================================================
// مَرصَد · Frontend v2.2
// =====================================================================

const STATE = {
  index: null,
  allPosts: [],
  filtered: [],
  pages: {},        // الصفحات اللي فيها بيانات
  pagesConfig: [],  // من pages.json
  history: [],      // سجل التشغيلات
  liveRuns: [],     // workflows قيد التنفيذ
};

const LS = {
  token: 'marsad_token',
  pagesConfig: 'marsad_pages_draft',
  filters: 'marsad_filters_v2',
  firstVisit: 'marsad_first_visit',
};

const els = {
  // stats
  statPages: document.getElementById('statPages'),
  statPosts: document.getElementById('statPosts'),
  statReactions: document.getElementById('statReactions'),
  statComments: document.getElementById('statComments'),
  // filters
  pageFilter: document.getElementById('pageFilter'),
  sourceFilter: document.getElementById('sourceFilter'),
  sortFilter: document.getElementById('sortFilter'),
  searchInput: document.getElementById('searchInput'),
  dateFrom: document.getElementById('dateFrom'),
  dateTo: document.getElementById('dateTo'),
  minReactions: document.getElementById('minReactions'),
  minComments: document.getElementById('minComments'),
  hasImageOnly: document.getElementById('hasImageOnly'),
  highEngagementOnly: document.getElementById('highEngagementOnly'),
  resetFilters: document.getElementById('resetFilters'),
  // results
  postsGrid: document.getElementById('postsGrid'),
  resultCount: document.getElementById('resultCount'),
  sourcesUsed: document.getElementById('sourcesUsed'),
  activeFiltersBadge: document.getElementById('activeFiltersBadge'),
  // buttons
  refreshBtn: document.getElementById('refreshBtn'),
  triggerBtn: document.getElementById('triggerBtn'),
  exportBtn: document.getElementById('exportBtn'),
  setupBtn: document.getElementById('setupBtn'),
  historyBtn: document.getElementById('historyBtn'),
  managePagesBtn: document.getElementById('managePagesBtn'),
  lastUpdateText: document.getElementById('lastUpdateText'),
  // live banner
  liveStatusBanner: document.getElementById('liveStatusBanner'),
  liveStatusText: document.getElementById('liveStatusText'),
  liveStatusLink: document.getElementById('liveStatusLink'),
  // footer
  footerYear: document.getElementById('footerYear'),
  // modal
  modal: document.getElementById('modal'),
  modalClose: document.getElementById('modalClose'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
};

// ========= Init =========

async function init() {
  els.footerYear.textContent = new Date().getFullYear();

  await loadIndex();
  await loadAllPages();
  await loadPagesConfig();
  await loadHistory();

  setDefaultDateRange();   // آخر 24 ساعة افتراضياً
  restoreFilters();
  setupListeners();
  applyFilters();

  // Polling للعمليات الحية
  pollLiveRuns();
  setInterval(pollLiveRuns, 30000); // كل 30 ثانية
}

function setDefaultDateRange() {
  // لو ما في saved filters، ضع آخر 24 ساعة
  const saved = localStorage.getItem(LS.filters);
  if (saved) return;

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  els.dateFrom.value = formatDateInput(yesterday);
  els.dateTo.value = formatDateInput(now);
}

function formatDateInput(d) {
  // YYYY-MM-DD
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function loadIndex() {
  try {
    const res = await fetch('data/index.json?t=' + Date.now());
    if (!res.ok) throw new Error('No index');
    STATE.index = await res.json();
    renderPageFilter();
    updateLastUpdate(STATE.index.last_run);
  } catch (e) {
    STATE.index = { pages: [], last_run: null };
    showEmpty('لا توجد بيانات بعد. افتح "دليل الإعداد" (ⓘ في الأعلى).');
  }
}

async function loadAllPages() {
  if (!STATE.index?.pages?.length) return;
  const pages = STATE.index.pages.filter(p => p.status === 'success');

  const results = await Promise.allSettled(
    pages.map(async (p) => {
      const res = await fetch(`data/${p.slug}.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`Failed ${p.slug}`);
      return res.json();
    })
  );

  STATE.allPosts = [];
  STATE.pages = {};
  results.forEach((r) => {
    if (r.status === 'fulfilled') {
      const data = r.value;
      STATE.pages[data.page_slug] = data;
      data.posts.forEach(post => {
        STATE.allPosts.push({
          ...post,
          page_slug: post.page_slug || data.page_slug,
          page_name: post.page_name || data.page_name,
        });
      });
    }
  });
  updateStats();
}

async function loadPagesConfig() {
  // محاولة قراءة pages.json من الريبو
  try {
    const res = await fetch('../pages.json?t=' + Date.now());
    if (res.ok) {
      const data = await res.json();
      STATE.pagesConfig = (data.pages || []).map(p => ({ ...p }));
      return;
    }
  } catch {}

  // fallback: من STATE.index
  STATE.pagesConfig = (STATE.index?.pages || []).map(p => ({
    slug: p.slug, name: p.name, url: p.url,
    max_posts: 30, source: 'auto', enabled: true,
  }));

  // draft من localStorage
  try {
    const saved = localStorage.getItem(LS.pagesConfig);
    if (saved) {
      const draft = JSON.parse(saved);
      if (Array.isArray(draft) && draft.length) STATE.pagesConfig = draft;
    }
  } catch {}
}

async function loadHistory() {
  try {
    const res = await fetch('data/history.json?t=' + Date.now());
    if (!res.ok) return;
    const data = await res.json();
    STATE.history = data.runs || [];
  } catch {}
}

function renderPageFilter() {
  const opts = ['<option value="all">كل الصفحات</option>'];
  (STATE.index?.pages || []).forEach(p => {
    if (p.status === 'success') {
      opts.push(`<option value="${p.slug}">${escapeHtml(p.name)}</option>`);
    }
  });
  els.pageFilter.innerHTML = opts.join('');
}

// ========= Live Runs Polling =========

async function pollLiveRuns() {
  const token = (() => { try { return localStorage.getItem(LS.token); } catch { return null; } })();
  if (!token) return;

  const info = detectRepoInfo();
  try {
    const res = await fetch(
      `https://api.github.com/repos/${info.owner}/${info.repo}/actions/runs?per_page=5&event=workflow_dispatch`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
        },
      }
    );
    if (!res.ok) return;
    const data = await res.json();
    const runs = data.workflow_runs || [];

    // Live = queued أو in_progress
    const live = runs.filter(r => ['queued', 'in_progress'].includes(r.status));
    STATE.liveRuns = live;

    if (live.length) {
      const r = live[0];
      els.liveStatusBanner.hidden = false;
      els.liveStatusText.textContent = `يوجد ${live.length} عملية سحب قيد التنفيذ… (${r.status === 'queued' ? 'في الطابور' : 'قيد التشغيل'})`;
      els.liveStatusLink.href = r.html_url;
    } else {
      els.liveStatusBanner.hidden = true;
    }
  } catch {}
}

// ========= Filters =========

function applyFilters() {
  let posts = [...STATE.allPosts];
  let activeFilters = 0;

  if (els.pageFilter.value !== 'all') {
    posts = posts.filter(p => p.page_slug === els.pageFilter.value);
    activeFilters++;
  }

  if (els.sourceFilter.value !== 'all') {
    posts = posts.filter(p => p.source === els.sourceFilter.value);
    activeFilters++;
  }

  const search = els.searchInput.value.trim().toLowerCase();
  if (search) {
    posts = posts.filter(p => (p.text || '').toLowerCase().includes(search));
    activeFilters++;
  }

  if (els.dateFrom.value) {
    const from = new Date(els.dateFrom.value).getTime();
    posts = posts.filter(p => {
      const d = new Date(p.published_at || p.scraped_at || 0).getTime();
      return d >= from;
    });
    activeFilters++;
  }

  if (els.dateTo.value) {
    const to = new Date(els.dateTo.value).getTime() + 86400000; // include end day
    posts = posts.filter(p => {
      const d = new Date(p.published_at || p.scraped_at || 0).getTime();
      return d <= to;
    });
    activeFilters++;
  }

  const minReact = parseInt(els.minReactions.value) || 0;
  if (minReact > 0) {
    posts = posts.filter(p => (p.reactions || 0) >= minReact);
    activeFilters++;
  }

  const minComm = parseInt(els.minComments.value) || 0;
  if (minComm > 0) {
    posts = posts.filter(p => (p.comments || 0) >= minComm);
    activeFilters++;
  }

  if (els.hasImageOnly.checked) {
    posts = posts.filter(p => !!p.image_url);
    activeFilters++;
  }

  if (els.highEngagementOnly.checked) {
    posts = posts.filter(p => (p.reactions || 0) >= 1000);
    activeFilters++;
  }

  const sortVal = els.sortFilter.value;
  posts.sort((a, b) => {
    const aDate = new Date(a.published_at || a.scraped_at || 0);
    const bDate = new Date(b.published_at || b.scraped_at || 0);
    switch (sortVal) {
      case 'reactions': return (b.reactions || 0) - (a.reactions || 0);
      case 'comments':  return (b.comments || 0)  - (a.comments || 0);
      case 'shares':    return (b.shares || 0)    - (a.shares || 0);
      case 'oldest':    return aDate - bDate;
      case 'newest':
      default:          return bDate - aDate;
    }
  });

  STATE.filtered = posts;

  if (activeFilters > 0) {
    els.activeFiltersBadge.hidden = false;
    els.activeFiltersBadge.textContent = `${activeFilters} فلتر نشط`;
  } else {
    els.activeFiltersBadge.hidden = true;
  }

  saveFilters();
  renderPosts();
}

function saveFilters() {
  try {
    localStorage.setItem(LS.filters, JSON.stringify({
      page: els.pageFilter.value,
      sort: els.sortFilter.value,
      source: els.sourceFilter.value,
      search: els.searchInput.value,
      dateFrom: els.dateFrom.value,
      dateTo: els.dateTo.value,
      minReactions: els.minReactions.value,
      minComments: els.minComments.value,
      hasImageOnly: els.hasImageOnly.checked,
      highEngagementOnly: els.highEngagementOnly.checked,
    }));
  } catch {}
}

function restoreFilters() {
  try {
    const saved = localStorage.getItem(LS.filters);
    if (!saved) return;
    const f = JSON.parse(saved);
    if (f.page) els.pageFilter.value = f.page;
    if (f.sort) els.sortFilter.value = f.sort;
    if (f.source) els.sourceFilter.value = f.source;
    if (f.search) els.searchInput.value = f.search;
    if (f.dateFrom) els.dateFrom.value = f.dateFrom;
    if (f.dateTo) els.dateTo.value = f.dateTo;
    if (f.minReactions) els.minReactions.value = f.minReactions;
    if (f.minComments) els.minComments.value = f.minComments;
    if (f.hasImageOnly) els.hasImageOnly.checked = true;
    if (f.highEngagementOnly) els.highEngagementOnly.checked = true;
  } catch {}
}

function resetAllFilters() {
  els.pageFilter.value = 'all';
  els.sortFilter.value = 'newest';
  els.sourceFilter.value = 'all';
  els.searchInput.value = '';
  els.minReactions.value = '';
  els.minComments.value = '';
  els.hasImageOnly.checked = false;
  els.highEngagementOnly.checked = false;
  // إعادة تعيين التاريخ لآخر 24 ساعة
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  els.dateFrom.value = formatDateInput(yesterday);
  els.dateTo.value = formatDateInput(now);
  applyFilters();
  showToast('تم إعادة تعيين الفلاتر', 'success');
}

function applyQuickRange(range) {
  const now = new Date();
  els.dateTo.value = formatDateInput(now);
  let from;
  switch (range) {
    case '24h': from = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
    case '7d':  from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
    case '30d': from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
    case 'all':
      els.dateFrom.value = '';
      els.dateTo.value = '';
      applyFilters();
      return;
  }
  els.dateFrom.value = formatDateInput(from);
  applyFilters();
  document.querySelectorAll('.btn-quick-range').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range));
}

// ========= Render =========

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
            <div class="engagement-item ${isHigh ? 'high' : ''}" title="تفاعلات">
              ❤ <strong>${formatNum(reactions)}</strong>
            </div>
            <div class="engagement-item" title="تعليقات">
              💬 <strong>${formatNum(comments)}</strong>
            </div>
            <div class="engagement-item" title="مشاركات">
              ↗ <strong>${formatNum(shares)}</strong>
            </div>
          ` : `
            <div class="engagement-item no-data" title="هذا المصدر لا يوفر التفاعلات">
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
  els.postsGrid.innerHTML = `
    <div class="empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4;margin-bottom:1rem">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <p>${escapeHtml(msg)}</p>
    </div>
  `;
}

function updateStats() {
  const totalReactions = STATE.allPosts.reduce((s, p) => s + (p.reactions || 0), 0);
  const totalComments  = STATE.allPosts.reduce((s, p) => s + (p.comments || 0), 0);
  els.statPages.textContent = Object.keys(STATE.pages).length;
  els.statPosts.textContent = formatNum(STATE.allPosts.length);
  els.statReactions.textContent = formatNum(totalReactions);
  els.statComments.textContent = formatNum(totalComments);

  const sources = STATE.index?.sources_used || [];
  if (els.sourcesUsed && sources.length) {
    els.sourcesUsed.textContent = `المصادر: ${sources.join(' · ')}`;
  } else {
    els.sourcesUsed.textContent = '';
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

// ========= Helpers =========

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

function formatTime(timestampText, iso) {
  if (timestampText && timestampText.length < 30) return timestampText;
  if (iso) {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }
  return '';
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '—';
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min < 1) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function formatRelTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  const now = new Date();
  const diffMin = Math.round((now - date) / 60000);
  if (diffMin < 1) return 'الآن';
  if (diffMin < 60) return `قبل ${diffMin} د`;
  if (diffMin < 1440) return `قبل ${Math.round(diffMin / 60)} س`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function slugify(text) {
  return String(text || '')
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || `page_${Date.now()}`;
}

function showToast(msg, type = '') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function openModal(title, bodyHtml, size = '') {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = bodyHtml;
  els.modal.classList.add('active');
  const modalEl = els.modal.querySelector('.modal');
  modalEl.classList.toggle('modal-lg', size === 'lg');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  els.modal.classList.remove('active');
  document.body.style.overflow = '';
}

// ========= Export CSV =========

function exportCSV() {
  if (STATE.filtered.length === 0) {
    showToast('لا توجد منشورات للتصدير', 'error');
    return;
  }
  const headers = ['الصفحة', 'النص', 'التفاعلات', 'التعليقات', 'المشاركات', 'الوقت', 'المصدر', 'الرابط'];
  const rows = STATE.filtered.map(p => [
    p.page_name || '',
    (p.text || '').replace(/"/g, '""'),
    p.reactions || 0,
    p.comments || 0,
    p.shares || 0,
    p.published_at || p.scraped_at || '',
    p.source || '',
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

// ========= Trigger workflow =========

function openTriggerModal() {
  const info = detectRepoInfo();
  openModal('🚀 تشغيل سحب جديد', `
    <div class="modal-instructions">
      <div class="quick-action">
        <h3>🔑 الطريقة الأسهل (من هنا)</h3>
        <p>الصق GitHub Personal Access Token بصلاحية <code>repo</code>:</p>
        <p class="small-note">ما عندك Token؟ <a href="https://github.com/settings/tokens/new?scopes=repo&description=marsad-trigger" target="_blank" rel="noopener">أنشئ واحد الآن</a></p>

        <input type="password" id="ghToken" class="input" placeholder="ghp_..." dir="ltr">

        <div class="form-row" style="margin-top:10px">
          <label class="filter-label">سحب صفحة محددة (اختياري)</label>
          <select id="runSlugSelect" class="select">
            <option value="">كل الصفحات</option>
            ${STATE.pagesConfig.map(p =>
              `<option value="${escapeHtml(p.slug)}">${escapeHtml(p.name)}</option>`
            ).join('')}
          </select>
        </div>

        <div class="form-row" style="margin-top:8px">
          <label class="filter-label">إجبار مصدر (اختياري)</label>
          <select id="runSourceSelect" class="select">
            <option value="">تلقائي</option>
            <option value="apify">💎 Apify</option>
            <option value="fetchrss">🪶 FetchRSS</option>
            <option value="rssapp">⚡ RSS.app</option>
            <option value="rsshub">🏠 RSSHub</option>
            <option value="playwright">🎭 Playwright</option>
          </select>
        </div>

        <button class="btn-trigger btn-full" id="runWorkflowBtn" style="margin-top:14px">
          🚀 تشغيل الآن
        </button>
        <p class="note">⏱️ السحب يستغرق 3-5 دقائق. الصفحة تحدّث تلقائياً بعدها.</p>
      </div>

      <details class="alt-method">
        <summary>🔗 طرق بديلة</summary>
        <p style="margin-top:10px">يدوياً من GitHub: <a href="${info.actionsUrl}" target="_blank" rel="noopener">فتح Actions</a> → "Run workflow"</p>
        <p>جدول تلقائي: يشتغل كل 6 ساعات من GitHub Actions</p>
      </details>
    </div>
  `);

  const tokenInput = document.getElementById('ghToken');
  try {
    const saved = localStorage.getItem(LS.token);
    if (saved) tokenInput.value = saved;
  } catch {}

  document.getElementById('runWorkflowBtn').addEventListener('click', () => {
    const inputs = {
      page_slug: document.getElementById('runSlugSelect').value,
      force_source: document.getElementById('runSourceSelect').value,
    };
    triggerWorkflow(info, tokenInput.value.trim(), inputs);
  });
}

function detectRepoInfo() {
  const host = location.hostname;
  const path = location.pathname;
  let owner = '', repo = '';

  if (host.endsWith('.github.io')) {
    owner = host.replace('.github.io', '');
    const parts = path.split('/').filter(Boolean);
    repo = parts[0] || `${owner}.github.io`;
  } else {
    owner = 'AsemAbbas';
    repo = 'facebook_scraper';
  }

  return {
    owner, repo,
    actionsUrl: `https://github.com/${owner}/${repo}/actions`,
    apiUrl: `https://api.github.com/repos/${owner}/${repo}/actions/workflows/scrape.yml/dispatches`,
    contentsUrl: `https://api.github.com/repos/${owner}/${repo}/contents/pages.json`,
    runsUrl: `https://api.github.com/repos/${owner}/${repo}/actions/runs`,
  };
}

async function triggerWorkflow(repoInfo, token, inputs) {
  if (!token) {
    showToast('الصق التوكن أولاً', 'error');
    return;
  }

  try {
    const body = { ref: 'main' };
    const cleanInputs = {};
    if (inputs.page_slug) cleanInputs.page_slug = inputs.page_slug;
    if (inputs.force_source) cleanInputs.force_source = inputs.force_source;
    if (Object.keys(cleanInputs).length) body.inputs = cleanInputs;

    const res = await fetch(repoInfo.apiUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 204) {
      showToast('✅ تم بدء السحب! انتظر 3-5 دقائق', 'success');
      closeModal();
      try { localStorage.setItem(LS.token, token); } catch {}
      // ابدأ polling فوراً
      setTimeout(pollLiveRuns, 2000);
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(`فشل: ${err.message || res.status}`, 'error');
    }
  } catch (e) {
    showToast(`خطأ: ${e.message}`, 'error');
  }
}

// ========= History Modal =========

async function openHistoryModal() {
  const token = (() => { try { return localStorage.getItem(LS.token); } catch { return null; } })();
  const info = detectRepoInfo();

  openModal('🕐 سجل العمليات', `
    <div class="history-loading">
      <div class="spinner"></div>
      <p>جاري تحميل السجل…</p>
    </div>
  `, 'lg');

  let githubRuns = [];
  if (token) {
    try {
      const res = await fetch(`${info.runsUrl}?per_page=20`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        githubRuns = data.workflow_runs || [];
      }
    } catch {}
  }

  renderHistory(githubRuns, token, info);
}

function renderHistory(githubRuns, token, info) {
  const hasToken = !!token;
  const live = githubRuns.filter(r => ['queued', 'in_progress'].includes(r.status));
  const recent = githubRuns.filter(r => r.status === 'completed').slice(0, 10);

  const html = `
    <div class="history-wrapper">
      ${!hasToken ? `
        <div class="note note-info">
          💡 لعرض السجل الحيّ من GitHub، الصق Personal Access Token من زر "سحب الآن" أولاً.
        </div>
      ` : ''}

      ${live.length ? `
        <div class="history-section">
          <h3>🔴 قيد التنفيذ (${live.length})</h3>
          ${live.map(r => renderRunRow(r, true)).join('')}
        </div>
      ` : ''}

      ${recent.length ? `
        <div class="history-section">
          <h3>✅ آخر التشغيلات</h3>
          ${recent.map(r => renderRunRow(r, false)).join('')}
        </div>
      ` : (STATE.history.length ? `
        <div class="history-section">
          <h3>📂 السجل المحلي (من history.json)</h3>
          ${STATE.history.map(r => renderLocalRunRow(r)).join('')}
        </div>
      ` : `
        <div class="note-empty">لا توجد تشغيلات بعد</div>
      `)}

      <div class="history-footer">
        <a href="${info.actionsUrl}" target="_blank" rel="noopener" class="btn-refresh btn-sm">
          عرض كل التشغيلات على GitHub ↗
        </a>
      </div>
    </div>
  `;

  els.modalBody.innerHTML = html;
}

function renderRunRow(r, isLive) {
  const statusColor = {
    success: 'success', failure: 'error', cancelled: 'muted',
    queued: 'warn', in_progress: 'warn',
  }[r.conclusion || r.status] || 'muted';

  const statusLabel = {
    success: '✅ نجح',
    failure: '❌ فشل',
    cancelled: '⏹️ ملغي',
    queued: '⏳ في الطابور',
    in_progress: '🔄 يعمل',
  }[r.conclusion || r.status] || r.status;

  const duration = r.run_started_at && r.updated_at
    ? Math.round((new Date(r.updated_at) - new Date(r.run_started_at)) / 1000)
    : null;

  return `
    <div class="run-row">
      <div class="run-row-head">
        <span class="run-status ${statusColor}">${statusLabel}</span>
        <span class="run-trigger">${r.event === 'schedule' ? '⏰ مجدول' : r.event === 'workflow_dispatch' ? '👤 يدوي' : r.event}</span>
        <span class="run-time">${formatRelTime(r.run_started_at || r.created_at)}</span>
      </div>
      <div class="run-row-body">
        <strong>#${r.run_number}</strong> · ${escapeHtml(r.display_title || r.name || 'سحب')}
        ${duration ? ` · ⏱️ ${formatDuration(duration)}` : ''}
        ${isLive ? ` · <span class="live-dot-inline"></span>` : ''}
      </div>
      <div class="run-row-actions">
        <a href="${r.html_url}" target="_blank" rel="noopener" class="run-link">تفاصيل ↗</a>
      </div>
    </div>
  `;
}

function renderLocalRunRow(r) {
  const statusColor = r.status === 'success' ? 'success' : 'error';
  const statusLabel = r.status === 'success' ? '✅ نجح' : '❌ فشل';
  return `
    <div class="run-row">
      <div class="run-row-head">
        <span class="run-status ${statusColor}">${statusLabel}</span>
        <span class="run-trigger">${r.trigger === 'schedule' ? '⏰ مجدول' : '👤 يدوي'}</span>
        <span class="run-time">${formatRelTime(r.started_at)}</span>
      </div>
      <div class="run-row-body">
        <strong>${r.run_id}</strong>
        · ${r.pages_success}/${r.pages_total} صفحة
        · <strong>${r.new_posts}</strong> منشور جديد
        · ⏱️ ${formatDuration(r.duration_seconds)}
        · المصادر: ${(r.sources_used || []).join(', ')}
      </div>
    </div>
  `;
}

// ========= Setup Wizard (Simplified) =========

function openSetupWizard() {
  openModal('🚀 بدء سريع', `
    <div class="setup-wizard-v2">
      <div class="setup-tabs">
        <button class="setup-tab active" data-tab="quick">⚡ ربط سريع</button>
        <button class="setup-tab" data-tab="sources">📚 المصادر</button>
      </div>

      <div class="setup-tab-content" id="tabQuick">
        ${renderQuickSetup()}
      </div>

      <div class="setup-tab-content" id="tabSources" hidden>
        ${renderSourcesGuide()}
      </div>
    </div>
  `, 'lg');

  // Tab switching
  document.querySelectorAll('.setup-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.setup-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById('tabQuick').hidden = target !== 'quick';
      document.getElementById('tabSources').hidden = target !== 'sources';
    });
  });

  // Quick setup actions
  bindQuickSetupEvents();
}

function renderQuickSetup() {
  return `
    <div class="quick-setup-steps">
      <div class="quick-step">
        <div class="step-num">1</div>
        <div class="step-content">
          <h3>فعّل GitHub Pages + Actions</h3>
          <p>افتح إعدادات الريبو واضبط:</p>
          <ul class="mini-list">
            <li>Settings → Pages → Source: <strong>GitHub Actions</strong></li>
            <li>Settings → Actions → Workflow permissions: <strong>Read and write</strong></li>
          </ul>
          <a href="https://github.com/AsemAbbas/facebook_scraper/settings/pages" target="_blank" rel="noopener" class="btn-refresh btn-sm">فتح إعدادات Pages ↗</a>
        </div>
      </div>

      <div class="quick-step">
        <div class="step-num">2</div>
        <div class="step-content">
          <h3>أضف Token للتشغيل من الواجهة</h3>
          <p>Personal Access Token بصلاحية <code>repo</code> لتشغيل السحب من هذه الصفحة:</p>
          <input type="password" id="quickToken" class="input" placeholder="ghp_..." dir="ltr">
          <div class="action-row">
            <a href="https://github.com/settings/tokens/new?scopes=repo&description=marsad" target="_blank" rel="noopener" class="btn-refresh btn-sm">إنشاء Token جديد ↗</a>
            <button class="btn-trigger btn-sm" id="saveTokenBtn">حفظ التوكن</button>
          </div>
          <p class="small-note" id="tokenStatus"></p>
        </div>
      </div>

      <div class="quick-step">
        <div class="step-num">3</div>
        <div class="step-content">
          <h3>اختر مصدر واحد (بس)</h3>
          <p>الأبسط: <strong>Playwright</strong> (بدون إعداد) للتجربة.</p>
          <p>للإنتاج: <strong>Apify</strong> ($49/شهر) أو <strong>FetchRSS</strong> ($9.95/شهر).</p>
          <div class="quick-source-grid">
            <button class="quick-source" data-src="playwright">
              <span>🎭</span> Playwright <em>مجاني</em>
            </button>
            <button class="quick-source" data-src="apify">
              <span>💎</span> Apify <em>$49</em>
            </button>
            <button class="quick-source" data-src="fetchrss">
              <span>🪶</span> FetchRSS <em>$9.95</em>
            </button>
          </div>
          <div id="sourceQuickGuide"></div>
        </div>
      </div>

      <div class="quick-step">
        <div class="step-num">4</div>
        <div class="step-content">
          <h3>أضف الصفحات وشغّل</h3>
          <p>من الرأس: اضغط زر 📄 (إدارة الصفحات)، ثم زر ▶️ (سحب الآن).</p>
          <div class="action-row">
            <button class="btn-refresh btn-sm" id="gotoPages">📄 فتح إدارة الصفحات</button>
            <button class="btn-trigger btn-sm" id="gotoTrigger">▶️ سحب الآن</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindQuickSetupEvents() {
  // Token save
  const tokenInput = document.getElementById('quickToken');
  const tokenStatus = document.getElementById('tokenStatus');
  try {
    const saved = localStorage.getItem(LS.token);
    if (saved) {
      tokenInput.value = saved;
      tokenStatus.innerHTML = '✅ Token محفوظ مسبقاً';
      tokenStatus.style.color = 'var(--success)';
    }
  } catch {}

  document.getElementById('saveTokenBtn').addEventListener('click', async () => {
    const t = tokenInput.value.trim();
    if (!t) {
      showToast('الصق التوكن أولاً', 'error');
      return;
    }
    // Validate
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) {
        showToast('Token غير صالح', 'error');
        tokenStatus.innerHTML = '❌ Token غير صالح';
        tokenStatus.style.color = 'var(--danger)';
        return;
      }
      const user = await res.json();
      localStorage.setItem(LS.token, t);
      tokenStatus.innerHTML = `✅ محفوظ · مرحباً ${user.login}`;
      tokenStatus.style.color = 'var(--success)';
      showToast('تم حفظ Token بنجاح', 'success');
    } catch (e) {
      showToast(`خطأ: ${e.message}`, 'error');
    }
  });

  // Quick source selection
  document.querySelectorAll('.quick-source').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.quick-source').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const src = btn.dataset.src;
      document.getElementById('sourceQuickGuide').innerHTML = QUICK_GUIDES[src] || '';
    });
  });

  // Goto shortcuts
  document.getElementById('gotoPages').addEventListener('click', () => {
    closeModal();
    setTimeout(() => openPagesModal(), 250);
  });
  document.getElementById('gotoTrigger').addEventListener('click', () => {
    closeModal();
    setTimeout(() => openTriggerModal(), 250);
  });
}

const QUICK_GUIDES = {
  playwright: `
    <div class="source-quick-info">
      <h4>🎭 Playwright - خطوة واحدة</h4>
      <ol class="mini-list">
        <li>افتح <code>config.yml</code> في الريبو</li>
        <li>تأكد إن: <code>playwright → enabled: true</code></li>
        <li>خلاص! شغّل السحب.</li>
      </ol>
      <p class="small-note">⚠️ نسبة نجاح 40-60% فقط. للتجربة فقط.</p>
    </div>
  `,
  apify: `
    <div class="source-quick-info">
      <h4>💎 Apify - 3 خطوات</h4>
      <ol class="mini-list">
        <li>سجّل في <a href="https://apify.com/sign-up" target="_blank" rel="noopener">apify.com</a></li>
        <li>انسخ API Token من <a href="https://console.apify.com/account/integrations" target="_blank" rel="noopener">Integrations</a></li>
        <li>أضف كـ GitHub Secret باسم <code>APIFY_TOKEN</code> <a href="https://github.com/AsemAbbas/facebook_scraper/settings/secrets/actions/new" target="_blank" rel="noopener">↗ هنا</a></li>
      </ol>
      <p class="small-note">✅ الأعلى جودة · $5 مجاناً للتجربة</p>
    </div>
  `,
  fetchrss: `
    <div class="source-quick-info">
      <h4>🪶 FetchRSS - 3 خطوات</h4>
      <ol class="mini-list">
        <li>سجّل في <a href="https://fetchrss.com" target="_blank" rel="noopener">fetchrss.com</a> + اشترك Advanced</li>
        <li>أنشئ feed لكل صفحة → انسخ RSS URL</li>
        <li>في "إدارة الصفحات": الصق RSS URL كـ page URL واختر <code>fetchrss</code></li>
      </ol>
      <p class="small-note">⚠️ بدون تفاعلات · تحديث كل 3-6 ساعات</p>
    </div>
  `,
};

function renderSourcesGuide() {
  return `
    <div class="source-picker">
      <button class="source-card" data-source="apify">
        <span class="source-icon">💎</span>
        <strong>Apify</strong>
        <span class="price">$49/شهر</span>
        <span class="badge-best">الأفضل</span>
      </button>
      <button class="source-card" data-source="fetchrss">
        <span class="source-icon">🪶</span>
        <strong>FetchRSS</strong>
        <span class="price">$9.95/شهر</span>
        <span class="badge-cheap">الأرخص</span>
      </button>
      <button class="source-card" data-source="rssapp">
        <span class="source-icon">⚡</span>
        <strong>RSS.app</strong>
        <span class="price">$16.64/شهر</span>
      </button>
      <button class="source-card" data-source="rsshub">
        <span class="source-icon">🏠</span>
        <strong>RSSHub</strong>
        <span class="price">مجاني/~$4</span>
        <span class="badge-free">مفتوح</span>
      </button>
      <button class="source-card" data-source="playwright">
        <span class="source-icon">🎭</span>
        <strong>Playwright</strong>
        <span class="price">مجاني</span>
        <span class="badge-warn">تجريبي</span>
      </button>
    </div>
    <div class="setup-steps" id="setupSteps"></div>
  `;
}

// ========= Pages Management =========

function openPagesModal() {
  const pages = STATE.pagesConfig;
  openModal('📄 إدارة الصفحات', `
    <div class="pages-manager">
      <div class="pages-toolbar">
        <button class="btn-trigger btn-sm" id="addPageBtn" type="button">+ إضافة صفحة</button>
        <button class="btn-refresh btn-sm" id="exportPagesJson" type="button">تصدير</button>
        <button class="btn-refresh btn-sm" id="importPagesJson" type="button">استيراد</button>
      </div>

      <div class="pages-list" id="pagesList">
        ${pages.length === 0
          ? '<p class="note-empty">لا توجد صفحات بعد. اضغط "إضافة صفحة".</p>'
          : pages.map((p, i) => renderPageRow(p, i)).join('')}
      </div>

      <div class="pages-footer">
        <button class="btn-trigger" id="savePagesLocal" type="button">حفظ محلياً</button>
        <button class="btn-refresh" id="savePagesGitHub" type="button">💾 حفظ في GitHub</button>
      </div>

      <p class="note">
        <strong>ملاحظة:</strong> بعد الحفظ، شغّل سحب جديد من زر "سحب الآن".
      </p>
    </div>
  `, 'lg');

  bindPagesManagerEvents();
}

function renderPageRow(page, index) {
  return `
    <div class="page-row" data-index="${index}">
      <div class="page-row-head">
        <label class="switch">
          <input type="checkbox" class="page-enabled" ${page.enabled !== false ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
        <input type="text" class="input page-name" placeholder="اسم الصفحة" value="${escapeHtml(page.name || '')}">
        <button class="btn-icon-sm btn-danger page-delete" title="حذف" type="button">×</button>
      </div>
      <div class="page-row-body">
        <div class="form-row">
          <label class="filter-label">رابط الصفحة / RSS Feed</label>
          <input type="text" class="input page-url" placeholder="https://facebook.com/..." value="${escapeHtml(page.url || '')}" dir="ltr">
        </div>
        <div class="page-row-inline">
          <div class="form-row">
            <label class="filter-label">Slug</label>
            <input type="text" class="input page-slug" placeholder="auto" value="${escapeHtml(page.slug || '')}" dir="ltr">
          </div>
          <div class="form-row">
            <label class="filter-label">حد أقصى للمنشورات</label>
            <input type="number" class="input page-max-posts" min="1" max="500" value="${page.max_posts || 30}">
          </div>
          <div class="form-row">
            <label class="filter-label">المصدر</label>
            <select class="select page-source">
              <option value="auto" ${(page.source || 'auto') === 'auto' ? 'selected' : ''}>تلقائي</option>
              <option value="apify" ${page.source === 'apify' ? 'selected' : ''}>💎 Apify</option>
              <option value="fetchrss" ${page.source === 'fetchrss' ? 'selected' : ''}>🪶 FetchRSS</option>
              <option value="rssapp" ${page.source === 'rssapp' ? 'selected' : ''}>⚡ RSS.app</option>
              <option value="rsshub" ${page.source === 'rsshub' ? 'selected' : ''}>🏠 RSSHub</option>
              <option value="playwright" ${page.source === 'playwright' ? 'selected' : ''}>🎭 Playwright</option>
            </select>
          </div>
        </div>
        <div class="page-row-inline">
          <div class="form-row">
            <label class="filter-label">من تاريخ (اختياري)</label>
            <input type="date" class="input page-date-from" value="${(page.date_from || '').slice(0,10)}">
          </div>
          <div class="form-row">
            <label class="filter-label">إلى تاريخ (اختياري)</label>
            <input type="date" class="input page-date-to" value="${(page.date_to || '').slice(0,10)}">
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindPagesManagerEvents() {
  document.getElementById('addPageBtn').addEventListener('click', () => {
    syncPagesFromUI();
    STATE.pagesConfig.push({
      slug: '', name: '', url: '',
      max_posts: 30, source: 'auto', enabled: true,
    });
    openPagesModal();
  });

  document.querySelectorAll('.page-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('.page-row');
      const index = parseInt(row.dataset.index);
      if (confirm('حذف هذه الصفحة؟')) {
        syncPagesFromUI();
        STATE.pagesConfig.splice(index, 1);
        openPagesModal();
      }
    });
  });

  document.getElementById('exportPagesJson').addEventListener('click', () => {
    syncPagesFromUI();
    const json = JSON.stringify({ pages: STATE.pagesConfig }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pages.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('تم تصدير pages.json', 'success');
  });

  document.getElementById('importPagesJson').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (Array.isArray(data.pages)) {
          STATE.pagesConfig = data.pages;
          openPagesModal();
          showToast(`تم استيراد ${data.pages.length} صفحة`, 'success');
        } else {
          showToast('الملف غير صالح', 'error');
        }
      } catch (err) {
        showToast(`خطأ: ${err.message}`, 'error');
      }
    };
    input.click();
  });

  document.getElementById('savePagesLocal').addEventListener('click', () => {
    syncPagesFromUI();
    try {
      localStorage.setItem(LS.pagesConfig, JSON.stringify(STATE.pagesConfig));
      showToast('✅ تم الحفظ محلياً', 'success');
    } catch (e) {
      showToast('فشل الحفظ', 'error');
    }
  });

  document.getElementById('savePagesGitHub').addEventListener('click', () => {
    syncPagesFromUI();
    saveToGitHub();
  });
}

function syncPagesFromUI() {
  document.querySelectorAll('.page-row').forEach(row => {
    const index = parseInt(row.dataset.index);
    const page = STATE.pagesConfig[index];
    if (!page) return;
    page.name = row.querySelector('.page-name').value.trim();
    page.url = row.querySelector('.page-url').value.trim();
    let slug = row.querySelector('.page-slug').value.trim();
    if (!slug) slug = slugify(page.name);
    page.slug = slug;
    page.max_posts = parseInt(row.querySelector('.page-max-posts').value) || 30;
    page.source = row.querySelector('.page-source').value;
    page.enabled = row.querySelector('.page-enabled').checked;
    const df = row.querySelector('.page-date-from').value;
    const dt = row.querySelector('.page-date-to').value;
    if (df) page.date_from = df; else delete page.date_from;
    if (dt) page.date_to = dt; else delete page.date_to;
  });
}

async function saveToGitHub() {
  const token = localStorage.getItem(LS.token) || prompt('الصق GitHub Personal Access Token (صلاحية repo):');
  if (!token) {
    showToast('توكن مطلوب', 'error');
    return;
  }

  const clean = STATE.pagesConfig.map(p => {
    const c = { ...p };
    delete c._help;
    return c;
  });

  const info = detectRepoInfo();
  const content = JSON.stringify({ pages: clean }, null, 2);

  try {
    const getRes = await fetch(info.contentsUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
      },
    });
    if (!getRes.ok) {
      showToast(`فشل جلب الملف: ${getRes.status}`, 'error');
      return;
    }
    const current = await getRes.json();
    const b64 = btoa(unescape(encodeURIComponent(content)));

    const putRes = await fetch(info.contentsUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `📝 تحديث pages.json من الواجهة · ${new Date().toISOString()}`,
        content: b64,
        sha: current.sha,
        branch: 'main',
      }),
    });

    if (putRes.ok) {
      showToast('✅ تم حفظ pages.json على GitHub', 'success');
      try { localStorage.setItem(LS.token, token); } catch {}
      closeModal();
    } else {
      const err = await putRes.json().catch(() => ({}));
      showToast(`فشل: ${err.message || putRes.status}`, 'error');
    }
  } catch (e) {
    showToast(`خطأ: ${e.message}`, 'error');
  }
}

// ========= Listeners =========

function setupListeners() {
  // Filters
  els.pageFilter.addEventListener('change', applyFilters);
  els.sourceFilter.addEventListener('change', applyFilters);
  els.sortFilter.addEventListener('change', applyFilters);
  els.searchInput.addEventListener('input', debounce(applyFilters, 300));
  els.dateFrom.addEventListener('change', applyFilters);
  els.dateTo.addEventListener('change', applyFilters);
  els.minReactions.addEventListener('input', debounce(applyFilters, 300));
  els.minComments.addEventListener('input', debounce(applyFilters, 300));
  els.hasImageOnly.addEventListener('change', applyFilters);
  els.highEngagementOnly.addEventListener('change', applyFilters);
  els.resetFilters.addEventListener('click', resetAllFilters);

  // Quick range buttons
  document.querySelectorAll('.btn-quick-range').forEach(btn => {
    btn.addEventListener('click', () => applyQuickRange(btn.dataset.range));
  });

  // Actions
  els.exportBtn.addEventListener('click', exportCSV);
  els.refreshBtn.addEventListener('click', async () => {
    els.refreshBtn.disabled = true;
    await loadIndex();
    await loadAllPages();
    await loadHistory();
    applyFilters();
    pollLiveRuns();
    els.refreshBtn.disabled = false;
    showToast('تم تحديث البيانات', 'success');
  });

  els.triggerBtn.addEventListener('click', openTriggerModal);
  els.setupBtn.addEventListener('click', openSetupWizard);
  els.managePagesBtn.addEventListener('click', openPagesModal);
  els.historyBtn.addEventListener('click', openHistoryModal);

  // Modal
  els.modalClose.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.modal.classList.contains('active')) {
      closeModal();
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

// ========= Start =========
init();
