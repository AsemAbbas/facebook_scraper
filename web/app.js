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
  analyticsBtn: document.getElementById('analyticsBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
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

  // 1) Detect backend (server.py vs static)
  await detectBackend();
  showBackendStatus();

  await loadIndex();
  await loadAllPages();
  await loadPagesConfig();
  await loadSourcesStatus();
  await loadHistory();

  setDefaultDateRange();
  restoreFilters();
  setupListeners();
  applyFilters();

  // Live runs (different sources based on backend)
  pollLiveRuns();
  setInterval(pollLiveRuns, STATE.hasBackend ? 5000 : 30000);

  // First-run wizard
  maybeShowFirstRunWizard();
}

function showBackendStatus() {
  // Add subtle indicator in last-update area showing mode
  if (!els.lastUpdateText) return;
  const dot = document.querySelector('#lastUpdate .pulse');
  if (dot) {
    if (STATE.hasBackend) {
      dot.style.background = 'var(--success)';
      dot.title = 'متصل بالخادم المحلي · كل الميزات متاحة';
    } else {
      dot.style.background = 'var(--gold)';
      dot.title = 'وضع GitHub Pages · ميزات محدودة';
    }
  }
}

function maybeShowFirstRunWizard() {
  // Show wizard if backend + no pages
  if (!STATE.hasBackend) return;
  const noPages = (STATE.pagesConfig || []).length === 0;
  const noPosts = (STATE.allPosts || []).length === 0;
  const dismissed = localStorage.getItem('marsad_wizard_dismissed') === '1';
  if (noPages && noPosts && !dismissed) {
    setTimeout(() => openFirstRunWizard(), 600);
  }
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
  // 1) Try the backend API (server.py mode)
  try {
    const res = await fetch('/api/pages');
    if (res.ok) {
      const data = await res.json();
      STATE.pagesConfig = (data.pages || []).map(p => ({ ...p }));
      STATE.hasBackend = true;
      return;
    }
  } catch {}

  STATE.hasBackend = false;

  // 2) GitHub raw fallback (static GitHub Pages mode)
  try {
    const info = detectRepoInfo();
    const ghRes = await fetch(`https://raw.githubusercontent.com/${info.owner}/${info.repo}/main/pages.json?t=${Date.now()}`);
    if (ghRes.ok) {
      const data = await ghRes.json();
      STATE.pagesConfig = (data.pages || []).map(p => ({ ...p }));
      return;
    }
  } catch {}

  // 3) From index.json fallback
  STATE.pagesConfig = (STATE.index?.pages || []).map(p => ({
    slug: p.slug, name: p.name, url: p.url,
    max_posts: 30, source: 'auto', enabled: true,
  }));
}

async function detectBackend() {
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      const data = await res.json();
      STATE.backendStatus = data;
      STATE.hasBackend = !!data.ok;
      return data.ok;
    }
  } catch {}
  STATE.hasBackend = false;
  return false;
}

async function loadSourcesStatus() {
  if (!STATE.hasBackend) return;
  try {
    const res = await fetch('/api/sources');
    if (res.ok) STATE.sourcesStatus = await res.json();
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
  // Backend mode: poll /api/scrape
  if (STATE.hasBackend) {
    try {
      const res = await fetch('/api/scrape');
      if (!res.ok) return;
      const data = await res.json();
      const live = data.active || [];
      STATE.liveRuns = live;

      if (live.length) {
        const r = live[0];
        els.liveStatusBanner.hidden = false;
        const pct = r.total ? Math.round((r.progress / r.total) * 100) : 0;
        els.liveStatusText.textContent =
          `🔄 سحب قيد التنفيذ… ${r.current_page || ''} (${r.progress}/${r.total} · ${pct}%)`;
        els.liveStatusLink.href = '#';
        els.liveStatusLink.textContent = 'عرض التفاصيل ↓';
        els.liveStatusLink.onclick = (e) => {
          e.preventDefault();
          openProgressModal(r.id);
        };
      } else {
        els.liveStatusBanner.hidden = true;
      }
    } catch {}
    return;
  }

  // Fallback: GitHub Actions API
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
    const live = runs.filter(r => ['queued', 'in_progress'].includes(r.status));
    STATE.liveRuns = live;

    if (live.length) {
      const r = live[0];
      els.liveStatusBanner.hidden = false;
      els.liveStatusText.textContent = `يوجد ${live.length} عملية سحب قيد التنفيذ…`;
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
    const typeIcon = postTypeIcon(post.post_type);
    const hasComments = (post.comments_data || []).length > 0;
    const mediaCount = (post.media || []).length;

    return `
      <article class="post-card clickable" data-post-id="${escapeHtml(post.post_id)}" data-post-slug="${escapeHtml(post.page_slug)}" style="animation-delay: ${Math.min(i * 30, 600)}ms">
        <div class="post-header">
          <div class="post-page">${typeIcon}${escapeHtml(post.page_name)}</div>
          <div class="post-time">${formatTime(post.timestamp_text, post.published_at || post.scraped_at)}</div>
        </div>
        ${imageHtml}
        <div class="post-text">${escapeHtml(post.text || '')}</div>
        ${mediaCount > 1 ? `<div class="post-media-count">+${mediaCount - 1} ملف ميديا</div>` : ''}
        <div class="post-engagement">
          ${hasEngagement ? `
            <div class="engagement-item ${isHigh ? 'high' : ''}" title="تفاعلات">
              ❤ <strong>${formatNum(reactions)}</strong>
            </div>
            <div class="engagement-item ${hasComments ? 'has-detail' : ''}" title="تعليقات${hasComments ? ' (انقر للعرض)' : ''}">
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
          <span class="post-detail-hint">انقر للتفاصيل ↓</span>
        </div>
      </article>
    `;
  }).join('');

  // Click handlers على البطاقات
  document.querySelectorAll('.post-card.clickable').forEach(card => {
    card.addEventListener('click', (e) => {
      // ما تفتح لو ضغط على رابط فعلي داخل البطاقة
      if (e.target.tagName === 'A') return;
      const postId = card.dataset.postId;
      const slug = card.dataset.postSlug;
      const post = STATE.allPosts.find(p => p.post_id === postId && p.page_slug === slug);
      if (post) openPostDetailModal(post);
    });
  });
}

function postTypeIcon(type) {
  const icons = {
    video: '🎥 ',
    photo: '🖼 ',
    link: '🔗 ',
    live: '🔴 ',
    event: '📅 ',
  };
  return icons[type] || '';
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
  // Backend mode: direct one-click with real progress
  if (STATE.hasBackend) {
    openBackendTriggerModal();
    return;
  }

  // Fallback: GitHub Actions mode
  const info = detectRepoInfo();
  openModal('🚀 تشغيل سحب جديد', `
    <div class="modal-instructions">
      <div class="alert alert-info">
        💡 للتجربة المثلى: شغّل <code>start.bat</code> على جهازك للحصول على سحب مباشر مع progress حقيقي.
      </div>
      <div class="quick-action">
        <h3>🔑 وضع GitHub Actions</h3>
        <input type="password" id="ghToken" class="input" placeholder="ghp_..." dir="ltr">
        <button class="btn-trigger btn-full" id="runWorkflowBtn" style="margin-top:14px">🚀 تشغيل</button>
      </div>
    </div>
  `);

  const tokenInput = document.getElementById('ghToken');
  try {
    const saved = localStorage.getItem(LS.token);
    if (saved) tokenInput.value = saved;
  } catch {}

  document.getElementById('runWorkflowBtn').addEventListener('click', () => {
    triggerWorkflow(info, tokenInput.value.trim(), {});
  });
}

function openBackendTriggerModal() {
  const pagesOpts = STATE.pagesConfig.map(p =>
    `<option value="${escapeHtml(p.slug)}">${escapeHtml(p.name)}</option>`
  ).join('');

  const sourcesStatus = STATE.sourcesStatus || [];
  const enabledSources = sourcesStatus.filter(s => s.enabled);

  openModal('🚀 سحب جديد', `
    <div class="trigger-form">
      ${enabledSources.length === 0 ? `
        <div class="alert alert-warn">
          ⚠️ لا يوجد مصدر مفعّل. افتح <a href="#" id="openSrcSettings">الإعدادات</a> وفعّل مصدر واحد أولاً.
        </div>
      ` : `
        <div class="alert alert-info">
          ✨ المصادر المفعّلة: ${enabledSources.map(s => s.icon + ' ' + s.name).join('، ')}
        </div>
      `}

      <div class="form-row">
        <label class="filter-label">الصفحات</label>
        <select id="runSlugSelect" class="select">
          <option value="">كل الصفحات (${STATE.pagesConfig.length})</option>
          ${pagesOpts}
        </select>
      </div>

      <div class="form-row">
        <label class="filter-label">المصدر</label>
        <select id="runSourceSelect" class="select">
          <option value="">تلقائي (حسب الأولوية)</option>
          ${enabledSources.map(s =>
            `<option value="${s.name}">${s.icon} ${s.name}</option>`
          ).join('')}
        </select>
      </div>

      <div class="form-inline">
        <div class="form-row">
          <label class="filter-label">من تاريخ (اختياري)</label>
          <input type="date" id="runDateFrom" class="input">
        </div>
        <div class="form-row">
          <label class="filter-label">إلى تاريخ (اختياري)</label>
          <input type="date" id="runDateTo" class="input">
        </div>
      </div>

      <button class="btn-trigger btn-full btn-lg" id="startScrapeBtn" ${enabledSources.length === 0 ? 'disabled' : ''}>
        ▶️ ابدأ السحب
      </button>

      <p class="note">
        ⏱️ السحب يستغرق 1-5 دقائق. التقدم سيظهر مباشرة بدون تحديث الصفحة.
      </p>
    </div>
  `);

  const srcLink = document.getElementById('openSrcSettings');
  if (srcLink) {
    srcLink.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal();
      setTimeout(() => openSettingsModal(), 250);
    });
  }

  document.getElementById('startScrapeBtn').addEventListener('click', async () => {
    const btn = document.getElementById('startScrapeBtn');
    btn.disabled = true;
    btn.textContent = '⏳ بدء…';

    const body = {};
    const slug = document.getElementById('runSlugSelect').value;
    const source = document.getElementById('runSourceSelect').value;
    const dateFrom = document.getElementById('runDateFrom').value;
    const dateTo = document.getElementById('runDateTo').value;
    if (slug) body.slug = slug;
    if (source) body.source = source;
    if (dateFrom) body.date_from = dateFrom;
    if (dateTo) body.date_to = dateTo;

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast('فشل: ' + (err.error || res.status), 'error');
        btn.disabled = false;
        btn.textContent = '▶️ ابدأ السحب';
        return;
      }
      const data = await res.json();
      openProgressModal(data.job_id);
    } catch (e) {
      showToast('خطأ: ' + e.message, 'error');
      btn.disabled = false;
      btn.textContent = '▶️ ابدأ السحب';
    }
  });
}

// ========= Real-time Progress Modal (SSE) =========

function openProgressModal(jobId) {
  openModal('🔄 السحب قيد التنفيذ', `
    <div class="progress-modal">
      <div class="progress-header">
        <div class="progress-status" id="progStatus">⏳ بدء…</div>
        <div class="progress-bar-outer">
          <div class="progress-bar-inner" id="progBar" style="width:0%"></div>
        </div>
        <div class="progress-meta">
          <span id="progCurrent">—</span>
          <span id="progCount">0/0</span>
        </div>
      </div>
      <div class="progress-log" id="progLog"></div>
      <div class="progress-footer" id="progFooter" hidden>
        <button class="btn-trigger btn-full" id="progDoneBtn">✓ تم · عرض النتائج</button>
      </div>
    </div>
  `, 'lg');

  const evtSource = new EventSource(`/api/scrape/${jobId}/stream`);
  const log = document.getElementById('progLog');

  evtSource.onmessage = async (evt) => {
    try {
      const data = JSON.parse(evt.data);
      const pct = data.total ? Math.round((data.progress / data.total) * 100) : 0;
      const bar = document.getElementById('progBar');
      if (bar) bar.style.width = pct + '%';
      const curr = document.getElementById('progCurrent');
      if (curr) curr.textContent = data.current_page || '—';
      const count = document.getElementById('progCount');
      if (count) count.textContent = `${data.progress}/${data.total}`;

      const statusEl = document.getElementById('progStatus');
      if (statusEl) {
        if (data.status === 'running') statusEl.innerHTML = '🔄 قيد التنفيذ…';
        else if (data.status === 'success') statusEl.innerHTML = '✅ انتهى بنجاح';
        else if (data.status === 'error') statusEl.innerHTML = '⚠️ انتهى مع أخطاء';
      }

      (data.new_messages || []).forEach(m => {
        if (!log) return;
        const line = document.createElement('div');
        line.className = `log-line log-${m.level}`;
        line.textContent = m.text;
        log.appendChild(line);
      });
      if (log) log.scrollTop = log.scrollHeight;

      if (data.status === 'success' || data.status === 'error') {
        evtSource.close();
        const footer = document.getElementById('progFooter');
        if (footer) footer.hidden = false;
        const doneBtn = document.getElementById('progDoneBtn');
        if (doneBtn) {
          doneBtn.addEventListener('click', async () => {
            closeModal();
            await loadIndex();
            await loadAllPages();
            await loadHistory();
            applyFilters();
            showToast(data.status === 'success' ? '✅ تم تحديث البيانات' : '⚠️ انتهى مع أخطاء',
                      data.status === 'success' ? 'success' : 'error');
          });
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    const statusEl = document.getElementById('progStatus');
    if (statusEl) statusEl.innerHTML = '⚠️ انقطع الاتصال';
  };
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
  openModal('🕐 سجل العمليات', `
    <div class="history-loading">
      <div class="spinner"></div>
      <p>جاري تحميل السجل…</p>
    </div>
  `, 'lg');

  // Backend mode: use /api/scrape + /api/history
  if (STATE.hasBackend) {
    try {
      const [activeRes, histRes] = await Promise.all([
        fetch('/api/scrape'),
        fetch('/api/history'),
      ]);
      const active = activeRes.ok ? (await activeRes.json()).active || [] : [];
      const history = histRes.ok ? (await histRes.json()).runs || [] : [];
      renderBackendHistory(active, history);
    } catch (e) {
      els.modalBody.innerHTML = `<p class="note">فشل التحميل: ${escapeHtml(e.message)}</p>`;
    }
    return;
  }

  // Fallback: GitHub Actions
  const token = (() => { try { return localStorage.getItem(LS.token); } catch { return null; } })();
  const info = detectRepoInfo();
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

function renderBackendHistory(active, history) {
  const html = `
    <div class="history-wrapper">
      ${active.length ? `
        <div class="history-section">
          <h3>🔴 قيد التنفيذ (${active.length})</h3>
          ${active.map(r => renderBackendRunRow(r, true)).join('')}
        </div>
      ` : ''}

      ${history.length ? `
        <div class="history-section">
          <h3>📜 آخر التشغيلات (${history.length})</h3>
          ${history.map(r => renderBackendRunRow(r, false)).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <span class="empty-icon">📋</span>
          <h4>لا توجد تشغيلات بعد</h4>
          <p>اضغط "سحب الآن" ▶️ من الأعلى لبدء أول عملية.</p>
        </div>
      `}
    </div>
  `;
  els.modalBody.innerHTML = html;

  // Click على active run يفتح progress modal
  document.querySelectorAll('.run-row[data-job-id]').forEach(row => {
    row.addEventListener('click', () => {
      const jid = row.dataset.jobId;
      if (jid) {
        closeModal();
        setTimeout(() => openProgressModal(jid), 250);
      }
    });
  });
}

function renderBackendRunRow(r, isActive) {
  const statusMap = {
    queued: { label: '⏳ في الطابور', color: 'warn' },
    running: { label: '🔄 قيد التشغيل', color: 'warn' },
    success: { label: '✅ نجح', color: 'success' },
    error: { label: '❌ فشل', color: 'error' },
  };
  const s = statusMap[r.status] || { label: r.status, color: 'muted' };
  const duration = r.duration_seconds ||
    (r.finished_at && r.started_at
      ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000)
      : null);
  const params = r.params || {};
  const result = r.result || {};

  return `
    <div class="run-row ${isActive ? 'clickable' : ''}" ${isActive ? `data-job-id="${r.id}"` : ''}>
      <div class="run-row-head">
        <span class="run-status ${s.color}">${s.label}</span>
        <span class="run-trigger">${r.trigger === 'schedule' ? '⏰ مجدول' : '👤 يدوي'}</span>
        <span class="run-time">${formatRelTime(r.started_at)}</span>
      </div>
      <div class="run-row-body">
        ${r.new_posts !== undefined
          ? `<strong>${formatNum(r.new_posts)}</strong> منشور جديد · ${r.pages_success || 0}/${r.pages_total || 0} صفحة · ⏱️ ${formatDuration(duration)}`
          : (result.new_posts !== undefined
            ? `<strong>${formatNum(result.new_posts)}</strong> جديد · ${result.success || 0} نجح`
            : `جاري التشغيل…`)}
        ${(r.sources_used || result.sources_used || []).length
          ? `· المصادر: ${(r.sources_used || result.sources_used).join(', ')}` : ''}
        ${params.slug ? `· صفحة: <code>${escapeHtml(params.slug)}</code>` : ''}
      </div>
      ${isActive ? '<div class="run-row-actions"><span class="run-link">عرض التقدم ↑</span></div>' : ''}
    </div>
  `;
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
  const hasBackend = STATE.hasBackend;

  openModal('📄 إدارة الصفحات', `
    <div class="pages-manager">
      <div class="pages-toolbar">
        <button class="btn-trigger btn-sm" id="addPageBtn" type="button">+ إضافة صفحة</button>
        <button class="btn-refresh btn-sm" id="exportPagesJson" type="button">📤 تصدير</button>
        <button class="btn-refresh btn-sm" id="importPagesJson" type="button">📥 استيراد</button>
      </div>

      <div class="pages-list" id="pagesList">
        ${pages.length === 0
          ? `<div class="empty-state">
               <span class="empty-icon">📭</span>
               <h4>لا توجد صفحات بعد</h4>
               <p>اضغط "+ إضافة صفحة" لبدء رصد صفحة فيسبوك</p>
             </div>`
          : pages.map((p, i) => renderPageRow(p, i)).join('')}
      </div>

      <div class="pages-footer">
        ${hasBackend
          ? `<button class="btn-trigger btn-full" id="savePagesLocal" type="button">💾 حفظ كل التغييرات</button>`
          : `<button class="btn-trigger" id="savePagesLocal" type="button">حفظ محلياً</button>
             <button class="btn-refresh" id="savePagesGitHub" type="button">💾 حفظ في GitHub</button>`}
      </div>

      <p class="note">
        ${hasBackend
          ? `<strong>💡 نصيحة:</strong> اضغط 🧪 لاختبار صفحة قبل الحفظ (يسحب 3 منشورات للتأكد من الرابط). بعد الحفظ، اضغط "سحب الآن" ▶️.`
          : `<strong>ملاحظة:</strong> بعد الحفظ، شغّل سحب جديد من زر "سحب الآن".`}
      </p>
    </div>
  `, 'lg');

  bindPagesManagerEvents();
}

function renderPageRow(page, index) {
  return `
    <div class="page-row" data-index="${index}" data-slug="${escapeHtml(page.slug || '')}">
      <div class="page-row-head">
        <label class="switch">
          <input type="checkbox" class="page-enabled" ${page.enabled !== false ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
        <input type="text" class="input page-name" placeholder="اسم الصفحة (مثل: قناة الجزيرة)" value="${escapeHtml(page.name || '')}">
        ${STATE.hasBackend ? `<button class="btn-icon-sm btn-test page-test-btn" title="اختبر السحب" type="button">🧪</button>` : ''}
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

  document.getElementById('savePagesLocal').addEventListener('click', async () => {
    syncPagesFromUI();
    // Backend mode: direct save to pages.json
    if (STATE.hasBackend) {
      try {
        const res = await fetch('/api/pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pages: STATE.pagesConfig }),
        });
        if (res.ok) {
          showToast('✅ تم الحفظ في pages.json', 'success');
        } else {
          showToast('فشل الحفظ', 'error');
        }
      } catch (e) {
        showToast('خطأ: ' + e.message, 'error');
      }
      return;
    }
    // Fallback: localStorage
    try {
      localStorage.setItem(LS.pagesConfig, JSON.stringify(STATE.pagesConfig));
      showToast('✅ تم الحفظ محلياً (localStorage)', 'success');
    } catch (e) {
      showToast('فشل الحفظ', 'error');
    }
  });

  const ghBtn = document.getElementById('savePagesGitHub');
  if (ghBtn) {
    ghBtn.addEventListener('click', () => {
      syncPagesFromUI();
      saveToGitHub();
    });
  }

  // Test buttons
  document.querySelectorAll('.page-test-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const row = btn.closest('.page-row');
      const url = row.querySelector('.page-url').value.trim();
      const source = row.querySelector('.page-source').value;
      if (!url) {
        showToast('أدخل رابط الصفحة أولاً', 'error');
        return;
      }
      await testPage(url, source === 'auto' ? null : source, row);
    });
  });
}

async function testPage(url, source, row) {
  if (!STATE.hasBackend) {
    showToast('الاختبار يحتاج السيرفر المحلي (start.bat)', 'error');
    return;
  }
  const resultEl = row.querySelector('.page-test-result') || (() => {
    const r = document.createElement('div');
    r.className = 'page-test-result';
    row.appendChild(r);
    return r;
  })();
  resultEl.innerHTML = '<div class="spinner spinner-sm"></div> جاري الاختبار…';

  try {
    // pick first enabled source if no override
    let testSource = source;
    if (!testSource) {
      const firstEnabled = (STATE.sourcesStatus || []).find(s => s.enabled);
      testSource = firstEnabled ? firstEnabled.name : 'playwright';
    }

    const res = await fetch('/api/test-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, source: testSource }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      resultEl.innerHTML = `<div class="test-result error">❌ ${escapeHtml(data.error || 'فشل الاختبار')}</div>`;
      return;
    }
    if (!data.count) {
      resultEl.innerHTML = `<div class="test-result warn">⚠️ ما رجع أي منشور. جرّب مصدر آخر أو تأكد من الرابط.</div>`;
      return;
    }
    resultEl.innerHTML = `
      <div class="test-result success">
        ✅ تم سحب <strong>${data.count}</strong> منشور عبر <code>${testSource}</code>
        <details style="margin-top:6px">
          <summary>عرض العينة</summary>
          ${data.posts.slice(0, 2).map(p => `
            <div class="test-sample">
              <strong>${escapeHtml((p.text || '').slice(0, 60))}…</strong>
            </div>
          `).join('')}
        </details>
      </div>
    `;
  } catch (e) {
    resultEl.innerHTML = `<div class="test-result error">❌ ${escapeHtml(e.message)}</div>`;
  }
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

// ========= Post Detail Modal =========

function openPostDetailModal(post) {
  const reactions = post.reactions || 0;
  const comments = post.comments || 0;
  const shares = post.shares || 0;
  const breakdown = post.reactions_breakdown || {};
  const media = post.media || [];
  const commentsData = post.comments_data || [];
  const hashtags = post.hashtags || [];
  const externalLinks = post.external_links || [];
  const sourceBadge = renderSourceBadge(post.source);

  // عرض كل الميديا
  const mediaHtml = media.length
    ? `<div class="detail-section">
         <h3>📎 الميديا (${media.length})</h3>
         <div class="detail-media-grid">
           ${media.map(m => m.type === 'video'
             ? `<a href="${escapeHtml(m.url)}" target="_blank" rel="noopener" class="media-item video">
                  <span>🎥</span><span>فيديو</span>
                </a>`
             : `<a href="${escapeHtml(m.url)}" target="_blank" rel="noopener" class="media-item">
                  <img src="${escapeHtml(m.url)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('broken')">
                </a>`
           ).join('')}
         </div>
       </div>`
    : (post.image_url
      ? `<div class="detail-section">
           <h3>📎 الميديا</h3>
           <div class="detail-media-grid">
             <a href="${escapeHtml(post.image_url)}" target="_blank" rel="noopener" class="media-item">
               <img src="${escapeHtml(post.image_url)}" alt="" loading="lazy">
             </a>
           </div>
         </div>` : '');

  // Reactions breakdown
  const breakdownHtml = Object.keys(breakdown).length
    ? `<div class="detail-section">
         <h3>❤️ تفاصيل التفاعلات</h3>
         <div class="reactions-breakdown">
           ${Object.entries(breakdown).map(([k, v]) => `
             <div class="reaction-pill">
               ${reactionIcon(k)} <strong>${formatNum(v)}</strong>
             </div>
           `).join('')}
         </div>
       </div>` : '';

  // التعليقات
  const commentsHtml = commentsData.length
    ? `<div class="detail-section">
         <h3>💬 التعليقات (${commentsData.length} ظاهرة من ${formatNum(comments)})</h3>
         <div class="comments-list">
           ${commentsData.map(c => `
             <div class="comment-item">
               <div class="comment-head">
                 <strong>${escapeHtml(c.author_name || 'مستخدم')}</strong>
                 <span class="comment-time">${formatRelTime(c.created_at)}</span>
                 ${c.likes ? `<span class="comment-likes">❤ ${formatNum(c.likes)}</span>` : ''}
               </div>
               <div class="comment-text">${escapeHtml(c.text || '')}</div>
               ${c.replies_count ? `<div class="comment-replies">${c.replies_count} رد</div>` : ''}
             </div>
           `).join('')}
         </div>
       </div>`
    : (comments > 0
      ? `<div class="detail-section">
           <h3>💬 التعليقات</h3>
           <p class="note">${formatNum(comments)} تعليق على المنشور. مصدر "${post.source}" لا يجلب نصوص التعليقات. للحصول على التعليقات الكاملة استخدم Apify.</p>
         </div>` : '');

  // Hashtags
  const hashtagsHtml = hashtags.length
    ? `<div class="detail-section">
         <h3>🏷️ الوسوم</h3>
         <div class="hashtags-list">
           ${hashtags.map(h => `<span class="hashtag">#${escapeHtml(h)}</span>`).join('')}
         </div>
       </div>` : '';

  // External links
  const linksHtml = externalLinks.length
    ? `<div class="detail-section">
         <h3>🔗 روابط خارجية</h3>
         <ul class="external-links">
           ${externalLinks.map(u => `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(u.slice(0, 80))}</a></li>`).join('')}
         </ul>
       </div>` : '';

  openModal('📰 تفاصيل المنشور', `
    <div class="post-detail">
      <div class="detail-header">
        <div class="detail-page-info">
          <strong>${escapeHtml(post.page_name)}</strong>
          ${sourceBadge}
          ${post.is_pinned ? '<span class="badge-info">📌 مثبّت</span>' : ''}
          ${post.is_sponsored ? '<span class="badge-warn-inline">💰 مموّل</span>' : ''}
        </div>
        <div class="detail-time">
          ${formatTime(post.timestamp_text, post.published_at || post.scraped_at)}
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-text">${escapeHtml(post.text || '').replace(/\n/g, '<br>')}</div>
      </div>

      ${mediaHtml}
      ${hashtagsHtml}
      ${linksHtml}

      <div class="detail-section">
        <h3>📊 الإحصاءات</h3>
        <div class="detail-stats">
          <div class="detail-stat">
            <div class="detail-stat-num">${formatNum(reactions)}</div>
            <div class="detail-stat-label">❤ تفاعل</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-num">${formatNum(comments)}</div>
            <div class="detail-stat-label">💬 تعليق</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat-num">${formatNum(shares)}</div>
            <div class="detail-stat-label">↗ مشاركة</div>
          </div>
        </div>
      </div>

      ${breakdownHtml}
      ${commentsHtml}

      <div class="detail-actions">
        ${post.post_url ? `<a href="${escapeHtml(post.post_url)}" target="_blank" rel="noopener" class="btn-trigger">فتح على فيسبوك ↗</a>` : ''}
        <button class="btn-refresh" id="copyPostLink">نسخ الرابط</button>
        <button class="btn-refresh" id="copyPostText">نسخ النص</button>
      </div>

      <details class="detail-meta">
        <summary>معلومات تقنية</summary>
        <div class="meta-grid">
          <div><span>post_id:</span> <code>${escapeHtml(post.post_id)}</code></div>
          <div><span>المصدر:</span> <code>${escapeHtml(post.source)}</code></div>
          <div><span>النوع:</span> <code>${escapeHtml(post.post_type || 'text')}</code></div>
          <div><span>سُحب في:</span> <code>${formatTime('', post.scraped_at)}</code></div>
        </div>
      </details>
    </div>
  `, 'lg');

  // Action handlers
  const cl = document.getElementById('copyPostLink');
  if (cl) cl.addEventListener('click', () => {
    if (post.post_url) {
      navigator.clipboard.writeText(post.post_url);
      showToast('تم نسخ الرابط', 'success');
    } else {
      showToast('لا يوجد رابط', 'error');
    }
  });
  const ct = document.getElementById('copyPostText');
  if (ct) ct.addEventListener('click', () => {
    navigator.clipboard.writeText(post.text || '');
    showToast('تم نسخ النص', 'success');
  });
}

function reactionIcon(key) {
  return { like: '👍', love: '❤️', haha: '😂', wow: '😮', sad: '😢', angry: '😠', care: '🤗' }[key] || '❤';
}

// ========= Analytics Dashboard =========

function openAnalyticsModal() {
  const posts = STATE.allPosts;
  if (!posts.length) {
    openModal('📊 الإحصاءات والتحليلات', '<p class="note-empty">لا توجد بيانات للتحليل بعد.</p>', 'lg');
    return;
  }

  // إحصاءات شاملة
  const totalReactions = posts.reduce((s, p) => s + (p.reactions || 0), 0);
  const totalComments = posts.reduce((s, p) => s + (p.comments || 0), 0);
  const totalShares = posts.reduce((s, p) => s + (p.shares || 0), 0);
  const avgReactions = Math.round(totalReactions / posts.length);
  const avgComments = Math.round(totalComments / posts.length);

  // توزيع حسب الصفحة
  const byPage = {};
  posts.forEach(p => {
    const k = p.page_name || p.page_slug;
    if (!byPage[k]) byPage[k] = { count: 0, reactions: 0, comments: 0, shares: 0 };
    byPage[k].count++;
    byPage[k].reactions += p.reactions || 0;
    byPage[k].comments += p.comments || 0;
    byPage[k].shares += p.shares || 0;
  });
  const pagesArr = Object.entries(byPage).sort((a, b) => b[1].reactions - a[1].reactions);

  // توزيع حسب المصدر
  const bySource = {};
  posts.forEach(p => {
    const s = p.source || 'unknown';
    bySource[s] = (bySource[s] || 0) + 1;
  });

  // توزيع حسب نوع المنشور
  const byType = {};
  posts.forEach(p => {
    const t = p.post_type || 'text';
    byType[t] = (byType[t] || 0) + 1;
  });

  // أعلى 5 منشورات تفاعلاً
  const topPosts = [...posts]
    .filter(p => p.reactions > 0)
    .sort((a, b) => (b.reactions || 0) - (a.reactions || 0))
    .slice(0, 5);

  // توزيع زمني (لكل يوم في آخر 7 أيام)
  const dayBuckets = {};
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    dayBuckets[formatDateInput(d)] = 0;
  }
  posts.forEach(p => {
    const d = p.published_at || p.scraped_at;
    if (!d) return;
    const day = d.slice(0, 10);
    if (day in dayBuckets) dayBuckets[day]++;
  });

  // الكلمات المتكررة (أبسط: hashtags)
  const tagCounts = {};
  posts.forEach(p => {
    (p.hashtags || []).forEach(t => {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  openModal('📊 الإحصاءات والتحليلات', `
    <div class="analytics-wrapper">
      <div class="analytics-grid">
        <div class="analytics-card">
          <div class="analytics-num">${formatNum(posts.length)}</div>
          <div class="analytics-label">إجمالي المنشورات</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-num">${formatNum(totalReactions)}</div>
          <div class="analytics-label">إجمالي التفاعلات</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-num">${formatNum(avgReactions)}</div>
          <div class="analytics-label">متوسط التفاعل/منشور</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-num">${formatNum(totalComments)}</div>
          <div class="analytics-label">إجمالي التعليقات</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-num">${formatNum(avgComments)}</div>
          <div class="analytics-label">متوسط التعليقات/منشور</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-num">${formatNum(totalShares)}</div>
          <div class="analytics-label">إجمالي المشاركات</div>
        </div>
      </div>

      <div class="analytics-section">
        <h3>📈 المنشورات في آخر 7 أيام</h3>
        <div class="bar-chart">
          ${(() => {
            const max = Math.max(...Object.values(dayBuckets), 1);
            return Object.entries(dayBuckets).map(([day, count]) => {
              const pct = (count / max) * 100;
              return `
                <div class="bar-item" title="${day}: ${count} منشور">
                  <div class="bar-fill" style="height: ${pct}%"></div>
                  <div class="bar-num">${count}</div>
                  <div class="bar-day">${day.slice(5)}</div>
                </div>
              `;
            }).join('');
          })()}
        </div>
      </div>

      <div class="analytics-section">
        <h3>📌 توزيع حسب الصفحة</h3>
        <table class="analytics-table">
          <thead>
            <tr><th>الصفحة</th><th>منشورات</th><th>تفاعل</th><th>تعليقات</th><th>مشاركات</th></tr>
          </thead>
          <tbody>
            ${pagesArr.map(([name, s]) => `
              <tr>
                <td>${escapeHtml(name)}</td>
                <td>${formatNum(s.count)}</td>
                <td>${formatNum(s.reactions)}</td>
                <td>${formatNum(s.comments)}</td>
                <td>${formatNum(s.shares)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="analytics-row">
        <div class="analytics-section half">
          <h3>🔌 المصادر المستخدمة</h3>
          <div class="source-distribution">
            ${Object.entries(bySource).map(([s, c]) => {
              const pct = ((c / posts.length) * 100).toFixed(0);
              return `
                <div class="dist-row">
                  <div class="dist-label">${renderSourceBadge(s) || s}</div>
                  <div class="dist-bar">
                    <div class="dist-fill" style="width: ${pct}%"></div>
                    <span class="dist-num">${formatNum(c)} (${pct}%)</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="analytics-section half">
          <h3>📋 توزيع حسب النوع</h3>
          <div class="source-distribution">
            ${Object.entries(byType).map(([t, c]) => {
              const pct = ((c / posts.length) * 100).toFixed(0);
              return `
                <div class="dist-row">
                  <div class="dist-label">${postTypeIcon(t)}${t}</div>
                  <div class="dist-bar">
                    <div class="dist-fill" style="width: ${pct}%"></div>
                    <span class="dist-num">${formatNum(c)} (${pct}%)</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      ${topPosts.length ? `
        <div class="analytics-section">
          <h3>🔥 أعلى 5 منشورات تفاعلاً</h3>
          <div class="top-posts-list">
            ${topPosts.map((p, i) => `
              <div class="top-post-row" data-post-id="${escapeHtml(p.post_id)}" data-post-slug="${escapeHtml(p.page_slug)}">
                <div class="top-rank">#${i + 1}</div>
                <div class="top-content">
                  <div class="top-page">${escapeHtml(p.page_name)}</div>
                  <div class="top-text">${escapeHtml((p.text || '').slice(0, 100))}…</div>
                </div>
                <div class="top-reactions">${formatNum(p.reactions)} ❤</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${topTags.length ? `
        <div class="analytics-section">
          <h3>🏷️ أكثر الوسوم استخداماً</h3>
          <div class="hashtags-list">
            ${topTags.map(([t, c]) => `<span class="hashtag">#${escapeHtml(t)} <em>(${c})</em></span>`).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `, 'lg');

  // Click على top post
  document.querySelectorAll('.top-post-row').forEach(row => {
    row.addEventListener('click', () => {
      const post = STATE.allPosts.find(p => p.post_id === row.dataset.postId && p.page_slug === row.dataset.postSlug);
      if (post) {
        closeModal();
        setTimeout(() => openPostDetailModal(post), 250);
      }
    });
  });
}

// ========= Settings Modal =========

// ========= First-Run Wizard =========

function openFirstRunWizard() {
  const sourcesStatus = STATE.sourcesStatus || [];
  const enabledSources = sourcesStatus.filter(s => s.enabled);
  const hasAnySource = enabledSources.length > 0;

  openModal('👋 أهلاً بك في مَرصَد', `
    <div class="wizard">
      <div class="wizard-intro-big">
        <p>بثلاث خطوات بسيطة تبدأ في رصد منشورات صفحات فيسبوك:</p>
      </div>

      <!-- Step 1: Source -->
      <div class="wizard-step ${hasAnySource ? 'done' : 'active'}" data-step="1">
        <div class="wizard-step-head">
          <div class="step-num">1</div>
          <div class="step-title">اختر مصدر السحب</div>
          ${hasAnySource ? '<span class="step-check">✓</span>' : ''}
        </div>
        <div class="wizard-step-body">
          ${hasAnySource
            ? `<p class="wizard-ok">✅ مفعّل: ${enabledSources.map(s => s.icon + ' ' + s.name).join('، ')}</p>`
            : `
              <p>اختر مصدراً واحداً للبدء (نوصي بـ Playwright للتجربة):</p>
              <div class="wizard-sources">
                ${sourcesStatus.map(s => `
                  <button class="wizard-source" data-source="${s.name}">
                    <span class="source-icon">${s.icon}</span>
                    <div class="source-info">
                      <strong>${s.name}</strong>
                      <span>${s.description}</span>
                      <em>${s.price}</em>
                    </div>
                  </button>
                `).join('')}
              </div>
            `}
        </div>
      </div>

      <!-- Step 2: Pages -->
      <div class="wizard-step ${STATE.pagesConfig.length > 0 ? 'done' : (hasAnySource ? 'active' : '')}" data-step="2">
        <div class="wizard-step-head">
          <div class="step-num">2</div>
          <div class="step-title">أضف صفحات فيسبوك لرصدها</div>
          ${STATE.pagesConfig.length > 0 ? '<span class="step-check">✓</span>' : ''}
        </div>
        <div class="wizard-step-body">
          ${STATE.pagesConfig.length > 0
            ? `<p class="wizard-ok">✅ ${STATE.pagesConfig.length} صفحة مُعرّفة</p>`
            : `
              <p>أضف أول صفحة - مثال:</p>
              <div class="wizard-quick-page">
                <input type="text" id="wizardPageName" class="input" placeholder="اسم الصفحة (مثل: قناة الجزيرة)">
                <input type="text" id="wizardPageUrl" class="input" placeholder="https://facebook.com/..." dir="ltr">
                <div class="wizard-suggestions">
                  <span>اقتراحات:</span>
                  <button class="suggest-btn" data-name="قناة الجزيرة" data-url="https://www.facebook.com/aljazeerachannel">🎥 الجزيرة</button>
                  <button class="suggest-btn" data-name="العربية" data-url="https://www.facebook.com/AlArabiya">📺 العربية</button>
                  <button class="suggest-btn" data-name="BBC عربي" data-url="https://www.facebook.com/bbcarabic">📰 BBC</button>
                </div>
                <button class="btn-trigger btn-full" id="wizardAddPageBtn">+ إضافة الصفحة</button>
              </div>
            `}
        </div>
      </div>

      <!-- Step 3: Scrape -->
      <div class="wizard-step ${STATE.allPosts.length > 0 ? 'done' : (STATE.pagesConfig.length > 0 ? 'active' : '')}" data-step="3">
        <div class="wizard-step-head">
          <div class="step-num">3</div>
          <div class="step-title">شغّل أول سحب</div>
          ${STATE.allPosts.length > 0 ? '<span class="step-check">✓</span>' : ''}
        </div>
        <div class="wizard-step-body">
          ${STATE.allPosts.length > 0
            ? `<p class="wizard-ok">✅ ${formatNum(STATE.allPosts.length)} منشور تم سحبه</p>`
            : `
              <p>اضغط الزر ليبدأ سحب المنشورات الآن (1-3 دقائق):</p>
              <button class="btn-trigger btn-full btn-lg" id="wizardScrapeBtn" ${STATE.pagesConfig.length === 0 ? 'disabled' : ''}>
                ▶️ سحب الآن
              </button>
            `}
        </div>
      </div>

      <div class="wizard-footer">
        <button class="btn-refresh btn-sm" id="wizardDismissBtn">تخطي هذا الدليل</button>
      </div>
    </div>
  `, 'lg');

  bindWizardEvents();
}

function bindWizardEvents() {
  // Step 1: Source buttons
  document.querySelectorAll('.wizard-source').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sourceName = btn.dataset.source;
      btn.disabled = true;
      btn.textContent = '⏳ جاري التفعيل…';
      await enableSourceInConfig(sourceName);
      // refresh
      await loadSourcesStatus();
      closeModal();
      setTimeout(openFirstRunWizard, 300);
    });
  });

  // Step 2: Suggestions
  document.querySelectorAll('.suggest-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = document.getElementById('wizardPageName');
      const url = document.getElementById('wizardPageUrl');
      if (name) name.value = btn.dataset.name;
      if (url) url.value = btn.dataset.url;
    });
  });

  // Step 2: Add page
  const addBtn = document.getElementById('wizardAddPageBtn');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const name = document.getElementById('wizardPageName').value.trim();
      const url = document.getElementById('wizardPageUrl').value.trim();
      if (!name || !url) {
        showToast('أدخل الاسم والرابط', 'error');
        return;
      }
      addBtn.disabled = true;
      addBtn.textContent = '⏳ جاري الحفظ…';
      const newPage = {
        slug: slugify(name),
        name, url,
        max_posts: 15,
        source: 'auto',
        enabled: true,
        tags: ['news'],
      };
      STATE.pagesConfig.push(newPage);
      if (STATE.hasBackend) {
        await fetch('/api/pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pages: STATE.pagesConfig }),
        });
      }
      showToast('✅ تم إضافة الصفحة', 'success');
      closeModal();
      setTimeout(openFirstRunWizard, 300);
    });
  }

  // Step 3: Scrape now
  const scrapeBtn = document.getElementById('wizardScrapeBtn');
  if (scrapeBtn) {
    scrapeBtn.addEventListener('click', async () => {
      closeModal();
      setTimeout(() => {
        if (STATE.hasBackend) {
          // Start directly
          fetch('/api/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }).then(r => r.json()).then(d => {
            if (d.job_id) openProgressModal(d.job_id);
          });
        } else {
          openTriggerModal();
        }
      }, 250);
    });
  }

  // Dismiss
  const dismissBtn = document.getElementById('wizardDismissBtn');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      localStorage.setItem('marsad_wizard_dismissed', '1');
      closeModal();
      showToast('يمكنك فتح الدليل من زر ⓘ', 'success');
    });
  }
}

async function enableSourceInConfig(sourceName) {
  if (!STATE.hasBackend) return false;
  try {
    // Get current config
    const res = await fetch('/api/config');
    if (!res.ok) return false;
    const data = await res.json();
    const config = data.config || {};
    (config.sources || []).forEach(s => {
      if (s.name === sourceName) s.enabled = true;
    });
    // Save
    const saveRes = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return saveRes.ok;
  } catch {
    return false;
  }
}

function openSettingsModal() {
  const info = detectRepoInfo();

  openModal('⚙️ الإعدادات المتقدمة', `
    <div class="settings-modal">
      <div class="settings-tabs">
        <button class="settings-tab active" data-tab="overview">نظرة عامة</button>
        <button class="settings-tab" data-tab="config">config.yml</button>
        <button class="settings-tab" data-tab="pages">pages.json</button>
        <button class="settings-tab" data-tab="advanced">متقدّم</button>
      </div>

      <div id="settings-overview" class="settings-pane">
        ${renderSettingsOverview(info)}
      </div>
      <div id="settings-config" class="settings-pane" hidden>
        <div class="loading"><div class="spinner"></div><p>جاري التحميل…</p></div>
      </div>
      <div id="settings-pages" class="settings-pane" hidden>
        <div class="loading"><div class="spinner"></div><p>جاري التحميل…</p></div>
      </div>
      <div id="settings-advanced" class="settings-pane" hidden>
        ${renderSettingsAdvanced(info)}
      </div>
    </div>
  `, 'lg');

  // Tab switching with lazy load
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.settings-pane').forEach(p => p.hidden = true);
      const targetId = `settings-${tab.dataset.tab}`;
      document.getElementById(targetId).hidden = false;
      // Lazy load
      if (tab.dataset.tab === 'config') loadConfigYaml(info);
      if (tab.dataset.tab === 'pages') loadPagesJson(info);
    });
  });
}

function renderSettingsOverview(info) {
  const sources = STATE.index?.sources_used || [];
  const pagesCount = STATE.pagesConfig?.length || 0;
  const postsCount = STATE.allPosts?.length || 0;
  return `
    <div class="settings-overview-grid">
      <div class="overview-card">
        <div class="overview-num">${pagesCount}</div>
        <div class="overview-label">صفحة مُعرّفة</div>
      </div>
      <div class="overview-card">
        <div class="overview-num">${postsCount}</div>
        <div class="overview-label">منشور محفوظ</div>
      </div>
      <div class="overview-card">
        <div class="overview-num">${sources.length}</div>
        <div class="overview-label">مصدر نشط</div>
      </div>
    </div>

    <h3>🔗 روابط مباشرة</h3>
    <div class="quick-links">
      <a href="https://github.com/${info.owner}/${info.repo}" target="_blank" rel="noopener" class="quick-link">
        <span>📁</span> الريبو على GitHub
      </a>
      <a href="https://github.com/${info.owner}/${info.repo}/edit/main/config.yml" target="_blank" rel="noopener" class="quick-link">
        <span>⚙️</span> تحرير config.yml
      </a>
      <a href="https://github.com/${info.owner}/${info.repo}/edit/main/pages.json" target="_blank" rel="noopener" class="quick-link">
        <span>📄</span> تحرير pages.json
      </a>
      <a href="https://github.com/${info.owner}/${info.repo}/settings/secrets/actions" target="_blank" rel="noopener" class="quick-link">
        <span>🔐</span> إدارة Secrets
      </a>
      <a href="${info.actionsUrl}" target="_blank" rel="noopener" class="quick-link">
        <span>🚀</span> سجل التشغيلات
      </a>
      <a href="https://github.com/${info.owner}/${info.repo}/blob/main/SETUP.md" target="_blank" rel="noopener" class="quick-link">
        <span>📚</span> دليل الإعداد
      </a>
    </div>
  `;
}

function renderSettingsAdvanced(info) {
  return `
    <h3>🔬 خيارات متقدّمة</h3>
    <p class="note">
      هذه الخيارات تتطلب تحرير ملفات الـ config مباشرة. للتفاصيل الكاملة شوف
      <a href="https://github.com/${info.owner}/${info.repo}/blob/main/SETUP.md" target="_blank" rel="noopener">SETUP.md</a>.
    </p>

    <div class="advanced-list">
      <div class="advanced-item">
        <strong>🎯 سحب التعليقات (Apify فقط)</strong>
        <p>في <code>config.yml</code> تحت <code>sources → apify</code>:</p>
        <pre><code>include_comments: true
max_comments_per_post: 10
include_reactions_breakdown: true</code></pre>
      </div>

      <div class="advanced-item">
        <strong>🔍 فلترة بالكلمات المفتاحية عند السحب</strong>
        <p>في <code>config.yml</code> تحت <code>scraping</code>:</p>
        <pre><code>required_keywords: ["غزة", "القدس"]
excluded_keywords: ["إعلان"]
skip_sponsored: true
skip_pinned: false</code></pre>
      </div>

      <div class="advanced-item">
        <strong>📅 تخصيص نطاق التاريخ لكل صفحة</strong>
        <p>في <code>pages.json</code> لكل صفحة:</p>
        <pre><code>{
  "slug": "aljazeera",
  "date_from": "2026-04-01",
  "date_to": "2026-04-30"
}</code></pre>
      </div>

      <div class="advanced-item">
        <strong>🔔 تنبيهات Telegram</strong>
        <p>أضف Secrets: <code>TELEGRAM_BOT_TOKEN</code>، <code>TELEGRAM_CHAT_ID</code></p>
        <p>ثم في <code>config.yml</code>:</p>
        <pre><code>alerts:
  telegram:
    enabled: true
    high_engagement_threshold: 5000
    keywords: ["عاجل"]</code></pre>
      </div>

      <div class="advanced-item">
        <strong>🤖 تغيير وتيرة السحب التلقائي</strong>
        <p>في <code>.github/workflows/scrape.yml</code>:</p>
        <pre><code>schedule:
  - cron: '0 */6 * * *'   # كل 6 ساعات (الافتراضي)
  - cron: '0 * * * *'     # كل ساعة
  - cron: '0 */2 * * *'   # كل ساعتين</code></pre>
      </div>

      <div class="advanced-item">
        <strong>🏠 التشغيل المحلي</strong>
        <p>على Windows: انقر مرتين على <code>run.bat</code></p>
        <p>أو من Terminal:</p>
        <pre><code>python scripts/local_run.py            # مرة واحدة
python scripts/local_run.py --loop 360 # كل 6 ساعات</code></pre>
      </div>
    </div>
  `;
}

async function loadConfigYaml(info) {
  const pane = document.getElementById('settings-config');
  if (pane.dataset.loaded === '1') return;

  // Backend mode: editable
  if (STATE.hasBackend) {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const text = data.raw || '';
      pane.innerHTML = `
        <div class="config-viewer-head">
          <span class="filename">config.yml</span>
          <div>
            <button class="btn-refresh btn-sm" id="configResetBtn">↶ إلغاء التعديل</button>
            <button class="btn-trigger btn-sm" id="configSaveBtn">💾 حفظ</button>
          </div>
        </div>
        <textarea class="config-editor" id="configEditor" spellcheck="false" dir="ltr">${escapeHtml(text)}</textarea>
        <p class="small-note">⚠️ كن حذراً! تعديل خاطئ قد يوقف السحب. تأكد من تنسيق YAML.</p>
      `;
      pane.dataset.loaded = '1';
      const originalText = text;
      document.getElementById('configResetBtn').addEventListener('click', () => {
        document.getElementById('configEditor').value = originalText;
        showToast('تم إلغاء التعديلات', 'success');
      });
      document.getElementById('configSaveBtn').addEventListener('click', async () => {
        const newText = document.getElementById('configEditor').value;
        try {
          const r = await fetch('/api/config/raw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw: newText }),
          });
          if (r.ok) {
            showToast('✅ تم حفظ config.yml', 'success');
            await loadSourcesStatus();
          } else {
            const err = await r.json().catch(() => ({}));
            showToast('فشل: ' + (err.error || 'خطأ'), 'error');
          }
        } catch (e) {
          showToast('خطأ: ' + e.message, 'error');
        }
      });
      return;
    } catch (e) {
      // fall through to GitHub raw
    }
  }

  // Fallback: GitHub raw (read-only)
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${info.owner}/${info.repo}/main/config.yml?t=${Date.now()}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    pane.innerHTML = `
      <div class="config-viewer-head">
        <span class="filename">config.yml (للعرض فقط - شغّل السيرفر للتعديل)</span>
        <a href="https://github.com/${info.owner}/${info.repo}/edit/main/config.yml" target="_blank" rel="noopener" class="btn-trigger btn-sm">تحرير على GitHub ↗</a>
      </div>
      <pre class="config-viewer"><code>${escapeHtml(text)}</code></pre>
    `;
    pane.dataset.loaded = '1';
  } catch (e) {
    pane.innerHTML = `<p class="note">فشل التحميل: ${escapeHtml(e.message)}.</p>`;
  }
}

async function loadPagesJson(info) {
  const pane = document.getElementById('settings-pages');
  if (pane.dataset.loaded === '1') return;

  // Backend mode: load from API
  if (STATE.hasBackend) {
    try {
      const res = await fetch('/api/pages');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      pane.innerHTML = `
        <div class="config-viewer-head">
          <span class="filename">pages.json · ${(data.pages || []).length} صفحة</span>
          <button class="btn-trigger btn-sm" id="openPagesFromSettings">📄 فتح محرّر الصفحات</button>
        </div>
        <pre class="config-viewer"><code>${escapeHtml(JSON.stringify(data, null, 2))}</code></pre>
        <p class="small-note">💡 للتحرير الكامل استخدم زر "فتح محرّر الصفحات" أو زر 📄 في الأعلى.</p>
      `;
      pane.dataset.loaded = '1';
      document.getElementById('openPagesFromSettings').addEventListener('click', () => {
        closeModal();
        setTimeout(() => openPagesModal(), 250);
      });
      return;
    } catch (e) {
      // fall through
    }
  }

  // Fallback: GitHub raw
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${info.owner}/${info.repo}/main/pages.json?t=${Date.now()}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    pane.innerHTML = `
      <div class="config-viewer-head">
        <span class="filename">pages.json</span>
        <a href="https://github.com/${info.owner}/${info.repo}/edit/main/pages.json" target="_blank" rel="noopener" class="btn-trigger btn-sm">تحرير على GitHub ↗</a>
      </div>
      <pre class="config-viewer"><code>${escapeHtml(text)}</code></pre>
    `;
    pane.dataset.loaded = '1';
  } catch (e) {
    pane.innerHTML = `<p class="note">فشل التحميل: ${escapeHtml(e.message)}.</p>`;
  }
}

async function loadAndRenderSettings() {
  const info = detectRepoInfo();
  let config = null;

  // محاولات قراءة config.yml بالترتيب:
  // 1. GitHub raw (لما الموقع منشور على GitHub Pages)
  // 2. local relative path (لما يشتغل محلياً مع python -m http.server من root)
  const candidates = [
    `https://raw.githubusercontent.com/${info.owner}/${info.repo}/main/config.yml?t=${Date.now()}`,
    '../config.yml?t=' + Date.now(),
    'config.yml?t=' + Date.now(),
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        config = parseSimpleYaml(text);
        if (config) break;
      }
    } catch {}
  }

  if (!config) {
    document.querySelectorAll('.settings-pane').forEach(p => {
      p.innerHTML = `
        <p class="note">
          لم يتمكن من قراءة <code>config.yml</code>. شاهده مباشرة على GitHub:
        </p>
        <a href="https://github.com/${info.owner}/${info.repo}/blob/main/config.yml" target="_blank" rel="noopener" class="btn-trigger btn-sm">فتح config.yml ↗</a>
      `;
    });
    return;
  }

  renderSettingsSources(config);
  renderSettingsScraping(config);
  renderSettingsFrontend(config);
  renderSettingsAlerts(config);
}

function renderSettingsSources(config) {
  const sources = config.sources || [];
  const html = `
    <h3>🔌 المصادر المتاحة</h3>
    <div class="settings-sources-list">
      ${sources.map(s => `
        <div class="settings-source ${s.enabled ? 'active' : ''}">
          <div class="settings-source-head">
            <span>${sourceIcon(s.name)} <strong>${s.name}</strong></span>
            <span class="status-badge ${s.enabled ? 'success' : 'muted'}">
              ${s.enabled ? '✅ مفعّل' : '⊘ معطّل'}
            </span>
          </div>
          <div class="settings-source-meta">
            الأولوية: <code>${s.priority}</code>
            ${s.actor_id ? `· Actor: <code>${escapeHtml(s.actor_id)}</code>` : ''}
            ${s.base_url ? `· URL: <code>${escapeHtml(s.base_url)}</code>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
    <p class="small-note">لتعديل: حرّر <code>config.yml</code> في الريبو وادفع التغيير.</p>
  `;
  document.getElementById('settings-sources').innerHTML = html;
}

function renderSettingsScraping(config) {
  const sc = config.scraping || {};
  const sched = config.schedule || {};
  const out = config.output || {};
  document.getElementById('settings-scraping').innerHTML = `
    <h3>🎯 خيارات السحب العامة</h3>
    <table class="settings-table">
      <tr><td>كلمات مطلوبة</td><td><code>${(sc.required_keywords || []).join(', ') || '—'}</code></td></tr>
      <tr><td>كلمات مستثناة</td><td><code>${(sc.excluded_keywords || []).join(', ') || '—'}</code></td></tr>
      <tr><td>أقل طول للنص</td><td><code>${sc.min_text_length || 5}</code></td></tr>
      <tr><td>تجاهل المثبّت</td><td><code>${sc.skip_pinned ? 'نعم' : 'لا'}</code></td></tr>
      <tr><td>تجاهل الممولة</td><td><code>${sc.skip_sponsored ? 'نعم' : 'لا'}</code></td></tr>
      <tr><td>جلب التعليقات</td><td><code>${sc.fetch_comments ? 'نعم' : 'لا'}</code></td></tr>
      <tr><td>اقتطاع النص عند</td><td><code>${sc.trim_text_to || 2000} حرف</code></td></tr>
    </table>
    <h3>📅 الجدولة</h3>
    <table class="settings-table">
      <tr><td>cron</td><td><code>${sched.cron || '0 */6 * * *'}</code></td></tr>
      <tr><td>المنطقة الزمنية</td><td><code>${sched.timezone || 'UTC'}</code></td></tr>
    </table>
    <h3>📦 الإخراج</h3>
    <table class="settings-table">
      <tr><td>مجلد الإخراج</td><td><code>${out.dir || 'web/data'}</code></td></tr>
      <tr><td>أقصى منشورات/صفحة</td><td><code>${out.keep_history || 200}</code></td></tr>
      <tr><td>طريقة الدمج</td><td><code>${out.merge_strategy || 'unique_id'}</code></td></tr>
    </table>
  `;
}

function renderSettingsFrontend(config) {
  const fe = config.frontend || {};
  document.getElementById('settings-frontend').innerHTML = `
    <h3>🎨 إعدادات الواجهة</h3>
    <table class="settings-table">
      <tr><td>عنوان الموقع</td><td><code>${escapeHtml(fe.site_title || 'مَرصَد')}</code></td></tr>
      <tr><td>الوصف</td><td><code>${escapeHtml(fe.site_tagline || '')}</code></td></tr>
      <tr><td>منشورات/صفحة</td><td><code>${fe.posts_per_page || 100}</code></td></tr>
      <tr><td>عرض شارة المصدر</td><td><code>${fe.show_source_badge ? 'نعم' : 'لا'}</code></td></tr>
      <tr><td>حد التفاعل العالي</td><td><code>${fe.high_engagement_threshold || 1000}</code></td></tr>
      <tr><td>اللغة الافتراضية</td><td><code>${fe.default_language || 'ar'}</code></td></tr>
    </table>
  `;
}

function renderSettingsAlerts(config) {
  const tg = config.alerts?.telegram || {};
  const em = config.alerts?.email || {};
  document.getElementById('settings-alerts').innerHTML = `
    <h3>📱 Telegram</h3>
    <table class="settings-table">
      <tr><td>الحالة</td><td><span class="status-badge ${tg.enabled ? 'success' : 'muted'}">${tg.enabled ? '✅ مفعّل' : '⊘ معطّل'}</span></td></tr>
      <tr><td>عتبة التفاعل العالي</td><td><code>${tg.high_engagement_threshold || 5000}</code></td></tr>
      <tr><td>كلمات مفتاحية</td><td><code>${(tg.keywords || []).join(', ') || '—'}</code></td></tr>
    </table>
    <h3>📧 الإيميل</h3>
    <table class="settings-table">
      <tr><td>الحالة</td><td><span class="status-badge ${em.enabled ? 'success' : 'muted'}">${em.enabled ? '✅ مفعّل' : '⊘ معطّل'}</span></td></tr>
      <tr><td>SMTP Server</td><td><code>${escapeHtml(em.smtp_server || 'smtp.gmail.com')}</code></td></tr>
      <tr><td>المنفذ</td><td><code>${em.smtp_port || 587}</code></td></tr>
    </table>
  `;
}

function sourceIcon(name) {
  return { apify: '💎', fetchrss: '🪶', rssapp: '⚡', rsshub: '🏠', playwright: '🎭' }[name] || '🔌';
}

function parseSimpleYaml(text) {
  // YAML بسيط - يدعم التركيبة الموجودة في config.yml
  // لو في تعقيدات، نرجع null
  try {
    const lines = text.split('\n');
    const result = {};
    const stack = [{ obj: result, indent: -1, isList: false }];
    let currentList = null;

    const cleanValue = (v) => {
      v = v.trim();
      if (v === 'true') return true;
      if (v === 'false') return false;
      if (v === 'null' || v === '~' || v === '') return null;
      if (/^-?\d+$/.test(v)) return parseInt(v);
      if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        return v.slice(1, -1);
      }
      if (v.startsWith('[') && v.endsWith(']')) {
        const inner = v.slice(1, -1).trim();
        if (!inner) return [];
        return inner.split(',').map(s => cleanValue(s.trim()));
      }
      return v;
    };

    for (const rawLine of lines) {
      // skip comments and empty
      const line = rawLine.replace(/\s+#.*$/, '');
      if (!line.trim() || line.trim().startsWith('#')) continue;

      const indent = line.length - line.trimStart().length;
      const trimmed = line.trim();

      // pop until proper indent
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const top = stack[stack.length - 1];

      if (trimmed.startsWith('- ')) {
        // list item
        const content = trimmed.slice(2);
        if (Array.isArray(top.obj)) {
          if (content.includes(':')) {
            const [k, ...rest] = content.split(':');
            const newObj = {};
            const v = rest.join(':').trim();
            if (v) newObj[k.trim()] = cleanValue(v);
            top.obj.push(newObj);
            stack.push({ obj: newObj, indent, isList: false });
          } else {
            top.obj.push(cleanValue(content));
          }
        }
      } else if (trimmed.includes(':')) {
        const colonIdx = trimmed.indexOf(':');
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim();

        if (!val) {
          // could be object or list
          // peek next non-empty line to decide
          const newObj = [];
          const newObjMap = {};
          // default to object, switch to list when first '-' encountered
          top.obj[key] = newObjMap;
          stack.push({ obj: newObjMap, indent, isList: false, key, parent: top.obj });
        } else {
          top.obj[key] = cleanValue(val);
        }
      }
    }

    // Convert to list if needed - simple heuristic
    function fixLists(o) {
      if (!o || typeof o !== 'object') return o;
      if (Array.isArray(o)) return o.map(fixLists);
      Object.keys(o).forEach(k => {
        if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) {
          const keys = Object.keys(o[k]);
          if (keys.length === 0 && k === 'sources') o[k] = [];
          else fixLists(o[k]);
        }
      });
      return o;
    }
    return fixLists(result);
  } catch {
    return null;
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
  if (els.analyticsBtn) els.analyticsBtn.addEventListener('click', openAnalyticsModal);
  if (els.settingsBtn) els.settingsBtn.addEventListener('click', openSettingsModal);

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
