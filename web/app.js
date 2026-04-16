// =====================================================================
// مَرصَد · Frontend v2.1
// =====================================================================

const STATE = {
  index: null,
  allPosts: [],
  filtered: [],
  pages: {},       // الصفحات اللي فيها بيانات فعلية
  pagesConfig: [], // الصفحات من pages.json (للإدارة)
};

const LS = {
  token: 'marsad_token',
  pagesConfig: 'marsad_pages_draft',
  filters: 'marsad_filters_v1',
};

const els = {
  // stats
  statPages: document.getElementById('statPages'),
  statPosts: document.getElementById('statPosts'),
  statReactions: document.getElementById('statReactions'),
  statComments: document.getElementById('statComments'),
  // filters basic
  pageFilter: document.getElementById('pageFilter'),
  sortFilter: document.getElementById('sortFilter'),
  searchInput: document.getElementById('searchInput'),
  sourceFilter: document.getElementById('sourceFilter'),
  // filters advanced
  dateFrom: document.getElementById('dateFrom'),
  dateTo: document.getElementById('dateTo'),
  minReactions: document.getElementById('minReactions'),
  minComments: document.getElementById('minComments'),
  hasImageOnly: document.getElementById('hasImageOnly'),
  highEngagementOnly: document.getElementById('highEngagementOnly'),
  toggleAdvanced: document.getElementById('toggleAdvanced'),
  advancedFilters: document.getElementById('advancedFilters'),
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
  managePagesBtn: document.getElementById('managePagesBtn'),
  lastUpdateText: document.getElementById('lastUpdateText'),
  // modal
  modal: document.getElementById('modal'),
  modalClose: document.getElementById('modalClose'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
};

// ========= Init =========

async function init() {
  await loadIndex();
  await loadAllPages();
  await loadPagesConfig();
  restoreFilters();
  setupListeners();
  applyFilters();
}

async function loadIndex() {
  try {
    const res = await fetch('data/index.json?t=' + Date.now());
    if (!res.ok) throw new Error('No index file');
    STATE.index = await res.json();
    renderPageFilter();
    updateLastUpdate(STATE.index.last_run);
  } catch (e) {
    STATE.index = { pages: [], last_run: null };
    showEmpty('لا توجد بيانات بعد. افتح دليل الإعداد من الزر ⓘ في الأعلى.');
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
  // أولاً: جرّب تحميل pages.json من السيرفر
  try {
    const res = await fetch('../pages.json?t=' + Date.now());
    if (res.ok) {
      const data = await res.json();
      STATE.pagesConfig = data.pages || [];
      return;
    }
  } catch {}
  // fallback: استخدم STATE.index
  STATE.pagesConfig = (STATE.index?.pages || []).map(p => ({
    slug: p.slug,
    name: p.name,
    url: p.url,
    max_posts: 30,
    source: 'auto',
    enabled: true,
  }));

  // أو من localStorage draft
  try {
    const saved = localStorage.getItem(LS.pagesConfig);
    if (saved) {
      const draft = JSON.parse(saved);
      if (Array.isArray(draft) && draft.length) {
        STATE.pagesConfig = draft;
      }
    }
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

// ========= Filters =========

function applyFilters() {
  let posts = [...STATE.allPosts];
  let activeFilters = 0;

  // الصفحة
  if (els.pageFilter.value !== 'all') {
    posts = posts.filter(p => p.page_slug === els.pageFilter.value);
    activeFilters++;
  }

  // المصدر
  if (els.sourceFilter.value !== 'all') {
    posts = posts.filter(p => p.source === els.sourceFilter.value);
    activeFilters++;
  }

  // بحث
  const search = els.searchInput.value.trim().toLowerCase();
  if (search) {
    posts = posts.filter(p => (p.text || '').toLowerCase().includes(search));
    activeFilters++;
  }

  // تاريخ من
  if (els.dateFrom.value) {
    const from = new Date(els.dateFrom.value).getTime();
    posts = posts.filter(p => {
      const d = new Date(p.published_at || p.scraped_at || 0).getTime();
      return d >= from;
    });
    activeFilters++;
  }

  // تاريخ إلى
  if (els.dateTo.value) {
    const to = new Date(els.dateTo.value).getTime() + 86400000; // include end day
    posts = posts.filter(p => {
      const d = new Date(p.published_at || p.scraped_at || 0).getTime();
      return d <= to;
    });
    activeFilters++;
  }

  // حد أدنى تفاعل
  const minReact = parseInt(els.minReactions.value) || 0;
  if (minReact > 0) {
    posts = posts.filter(p => (p.reactions || 0) >= minReact);
    activeFilters++;
  }

  // حد أدنى تعليقات
  const minComm = parseInt(els.minComments.value) || 0;
  if (minComm > 0) {
    posts = posts.filter(p => (p.comments || 0) >= minComm);
    activeFilters++;
  }

  // بصور فقط
  if (els.hasImageOnly.checked) {
    posts = posts.filter(p => !!p.image_url);
    activeFilters++;
  }

  // تفاعل عالٍ فقط (>= 1000)
  if (els.highEngagementOnly.checked) {
    posts = posts.filter(p => (p.reactions || 0) >= 1000);
    activeFilters++;
  }

  // ترتيب
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

  // Badge للفلاتر النشطة
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
      advancedOpen: !els.advancedFilters.hidden,
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
    if (f.advancedOpen) els.advancedFilters.hidden = false;
  } catch {}
}

function resetAllFilters() {
  els.pageFilter.value = 'all';
  els.sortFilter.value = 'newest';
  els.sourceFilter.value = 'all';
  els.searchInput.value = '';
  els.dateFrom.value = '';
  els.dateTo.value = '';
  els.minReactions.value = '';
  els.minComments.value = '';
  els.hasImageOnly.checked = false;
  els.highEngagementOnly.checked = false;
  applyFilters();
  showToast('تم إعادة تعيين الفلاتر', 'success');
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

function openModal(title, bodyHtml) {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = bodyHtml;
  els.modal.classList.add('active');
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
      <h3>⚡ تشغيل سريع من GitHub</h3>
      <ol>
        <li>افتح <a href="${info.actionsUrl}" target="_blank" rel="noopener">صفحة Actions</a></li>
        <li>اختر "Marsad · Scrape Facebook Pages"</li>
        <li>اضغط "Run workflow"</li>
      </ol>

      <h3>🔑 تشغيل من هنا (يحتاج Token)</h3>
      <p>أنشئ <a href="https://github.com/settings/tokens/new?scopes=repo&description=marsad-trigger" target="_blank" rel="noopener">Personal Access Token</a> بصلاحية <code>repo</code>:</p>
      <input type="password" id="ghToken" class="input" placeholder="ghp_..." style="margin:8px 0;">

      <div class="form-row" style="margin-top:8px;">
        <label class="filter-label">سحب صفحة محددة (اختياري)</label>
        <select id="runSlugSelect" class="select">
          <option value="">كل الصفحات</option>
          ${STATE.pagesConfig.map(p =>
            `<option value="${escapeHtml(p.slug)}">${escapeHtml(p.name)}</option>`
          ).join('')}
        </select>
      </div>

      <div class="form-row" style="margin-top:8px;">
        <label class="filter-label">إجبار مصدر (اختياري)</label>
        <select id="runSourceSelect" class="select">
          <option value="">تلقائي (من config.yml)</option>
          <option value="apify">💎 Apify</option>
          <option value="fetchrss">🪶 FetchRSS</option>
          <option value="rssapp">⚡ RSS.app</option>
          <option value="rsshub">🏠 RSSHub</option>
          <option value="playwright">🎭 Playwright</option>
        </select>
      </div>

      <button class="btn-trigger btn-full" id="runWorkflowBtn" style="margin-top:1rem">
        تشغيل الـ Workflow الآن
      </button>

      <p class="note">⏱️ السحب يستغرق 3-5 دقائق. حدّث الصفحة بعدها.</p>
    </div>
  `);

  // استرجاع التوكن المحفوظ
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
  };
}

async function triggerWorkflow(repoInfo, token, inputs) {
  if (!token) {
    showToast('الصق التوكن أولاً', 'error');
    return;
  }

  try {
    const body = { ref: 'main' };
    // أضف inputs لو فيها قيم
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
      showToast('✅ تم بدء السحب! انتظر 3-5 دقائق ثم حدّث', 'success');
      closeModal();
      try { localStorage.setItem(LS.token, token); } catch {}
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(`فشل: ${err.message || res.status}`, 'error');
    }
  } catch (e) {
    showToast(`خطأ: ${e.message}`, 'error');
  }
}

// ========= Pages Management =========

function openPagesModal() {
  const pages = STATE.pagesConfig;
  openModal('📄 إدارة الصفحات', `
    <div class="pages-manager">
      <div class="pages-toolbar">
        <button class="btn-trigger btn-sm" id="addPageBtn" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          إضافة صفحة
        </button>
        <button class="btn-refresh btn-sm" id="exportPagesJson" type="button">تصدير pages.json</button>
        <button class="btn-refresh btn-sm" id="importPagesJson" type="button">استيراد</button>
      </div>

      <div class="pages-list" id="pagesList">
        ${pages.length === 0
          ? '<p class="note-empty">لا توجد صفحات بعد. اضغط "إضافة صفحة".</p>'
          : pages.map((p, i) => renderPageRow(p, i)).join('')}
      </div>

      <div class="pages-footer">
        <button class="btn-trigger" id="savePagesLocal" type="button">حفظ محلياً (localStorage)</button>
        <button class="btn-refresh" id="savePagesGitHub" type="button">حفظ في GitHub (يحتاج Token)</button>
      </div>

      <p class="note">
        <strong>ملاحظة:</strong> بعد حفظ الصفحات يجب تشغيل workflow السحب حتى تظهر المنشورات الجديدة.
      </p>
    </div>
  `);

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
    STATE.pagesConfig.push({
      slug: '',
      name: '',
      url: '',
      max_posts: 30,
      source: 'auto',
      enabled: true,
    });
    openPagesModal(); // re-render
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
    showToast('توكن مطلوب للحفظ على GitHub', 'error');
    return;
  }

  // فلترة الـ _help من الإخراج
  const clean = STATE.pagesConfig.map(p => {
    const c = { ...p };
    delete c._help;
    return c;
  });

  const info = detectRepoInfo();
  const content = JSON.stringify({ pages: clean }, null, 2);

  try {
    // اجلب SHA الحالي للملف
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

    // Base64 encode مع دعم Unicode
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

// ========= Setup Wizard =========

function openSetupWizard() {
  openModal('📚 دليل الإعداد', `
    <div class="setup-wizard">
      <p class="wizard-intro">اختر المصدر المناسب وشوف خطوات إعداده:</p>

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
          <span class="badge-free">مفتوح المصدر</span>
        </button>
        <button class="source-card" data-source="playwright">
          <span class="source-icon">🎭</span>
          <strong>Playwright</strong>
          <span class="price">مجاني</span>
          <span class="badge-warn">غير موثوق</span>
        </button>
      </div>

      <div class="setup-steps" id="setupSteps"></div>
    </div>
  `);

  document.querySelectorAll('.source-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.source-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      renderSetupSteps(card.dataset.source);
    });
  });
}

function renderSetupSteps(source) {
  const container = document.getElementById('setupSteps');
  const steps = SETUP_GUIDES[source] || [];
  container.innerHTML = `
    <h3>${SETUP_TITLES[source]}</h3>
    <ol class="step-list">
      ${steps.map(s => `<li>${s}</li>`).join('')}
    </ol>
    <div class="setup-footer">
      <p><strong>📖 دليل مفصّل:</strong> <a href="https://github.com/AsemAbbas/facebook_scraper/blob/main/README.md" target="_blank" rel="noopener">README على GitHub</a></p>
    </div>
  `;
}

const SETUP_TITLES = {
  apify: '💎 إعداد Apify (الأفضل موثوقية)',
  fetchrss: '🪶 إعداد FetchRSS (الأرخص)',
  rssapp: '⚡ إعداد RSS.app',
  rsshub: '🏠 إعداد RSSHub (self-hosted)',
  playwright: '🎭 إعداد Playwright (للتجربة)',
};

const SETUP_GUIDES = {
  apify: [
    'سجّل في <a href="https://apify.com" target="_blank" rel="noopener">apify.com</a> (مجاني ابتداءً)',
    'من <a href="https://console.apify.com/account/integrations" target="_blank" rel="noopener">Console → Integrations</a>، انسخ الـ API token',
    'اذهب لـ GitHub repo → Settings → Secrets → New secret → باسم <code>APIFY_TOKEN</code>',
    'عدّل <code>config.yml</code>: <code>sources → apify → enabled: true</code>',
    'في <code>pages.json</code>: اترك <code>source: "auto"</code> أو حدّد <code>"apify"</code>',
    'شغّل workflow من زر "سحب الآن" → اختر Apify كمصدر',
  ],
  fetchrss: [
    'سجّل في <a href="https://fetchrss.com" target="_blank" rel="noopener">fetchrss.com</a>',
    'اشترك في خطة <strong>Advanced ($9.95/شهر)</strong> - 100 feed',
    'لكل صفحة فيسبوك: لوحة التحكم → Create feed → الصق رابط الصفحة',
    'بعد إنشاء الـ feed، انسخ RSS URL (شكلها: <code>fetchrss.com/rss/XXX.xml</code>)',
    'في <code>pages.json</code>: الصق RSS URL في حقل <code>url</code> بدل Facebook URL',
    'في <code>config.yml</code>: <code>sources → fetchrss → enabled: true</code>',
    '<strong>تنبيه:</strong> FetchRSS يُحدّث feeds فيسبوك كل 3-6 ساعات (قيد من فيسبوك)',
  ],
  rssapp: [
    'سجّل في <a href="https://rss.app" target="_blank" rel="noopener">rss.app</a>',
    'اشترك في <strong>Developer ($16.64/شهر)</strong> - 100 feed، تحديث أسرع',
    'من لوحة التحكم → Create feed → Facebook',
    'انسخ RSS URL (شكلها: <code>rss.app/feeds/XXX.xml</code>)',
    'في <code>pages.json</code>: الصق RSS URL في حقل <code>url</code>',
    'في <code>config.yml</code>: <code>sources → rssapp → enabled: true</code>',
  ],
  rsshub: [
    '<strong>خيار 1 - مجاني:</strong> استخدم <a href="https://rsshub.app" target="_blank" rel="noopener">rsshub.app</a> العامة (بطيئة ومحدودة)',
    '<strong>خيار 2 - VPS:</strong> استأجر Hetzner CX11 بـ <em>€4/شهر</em>',
    'على الـ VPS: <code>docker run -d -p 1200:1200 diygod/rsshub</code>',
    'في <code>config.yml</code>: <code>base_url: http://your-vps:1200</code>',
    'في <code>pages.json</code>: احتفظ بـ Facebook URL الأصلي (RSSHub يحولها تلقائياً)',
    '<strong>ميزة:</strong> مفتوح المصدر، بدون حدود على عدد الصفحات',
  ],
  playwright: [
    'ما يحتاج أي حساب/اشتراك - مجاني 100%',
    'في <code>config.yml</code>: <code>sources → playwright → enabled: true</code>',
    'GitHub Actions راح يثبّت Chromium تلقائياً عند التشغيل',
    '<strong>تنبيه مهم:</strong> فيسبوك بيكشف GitHub IPs بسرعة',
    'نسبة الفشل المتوقعة: <strong>40-60%</strong>',
    'مناسب فقط: للتجربة، 1-3 صفحات، فترات متباعدة',
    'للإنتاج الحقيقي: استخدم Apify أو FetchRSS',
  ],
};

// ========= Listeners =========

function setupListeners() {
  // filters
  els.pageFilter.addEventListener('change', applyFilters);
  els.sortFilter.addEventListener('change', applyFilters);
  els.sourceFilter.addEventListener('change', applyFilters);
  els.searchInput.addEventListener('input', debounce(applyFilters, 300));
  els.dateFrom.addEventListener('change', applyFilters);
  els.dateTo.addEventListener('change', applyFilters);
  els.minReactions.addEventListener('input', debounce(applyFilters, 300));
  els.minComments.addEventListener('input', debounce(applyFilters, 300));
  els.hasImageOnly.addEventListener('change', applyFilters);
  els.highEngagementOnly.addEventListener('change', applyFilters);

  // toggle advanced
  els.toggleAdvanced.addEventListener('click', () => {
    els.advancedFilters.hidden = !els.advancedFilters.hidden;
    els.toggleAdvanced.classList.toggle('active', !els.advancedFilters.hidden);
    saveFilters();
  });

  // reset
  els.resetFilters.addEventListener('click', resetAllFilters);

  // buttons
  els.exportBtn.addEventListener('click', exportCSV);
  els.refreshBtn.addEventListener('click', async () => {
    els.refreshBtn.disabled = true;
    await loadIndex();
    await loadAllPages();
    applyFilters();
    els.refreshBtn.disabled = false;
    showToast('تم تحديث البيانات', 'success');
  });

  els.triggerBtn.addEventListener('click', openTriggerModal);
  els.setupBtn.addEventListener('click', openSetupWizard);
  els.managePagesBtn.addEventListener('click', openPagesModal);

  // modal
  els.modalClose.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();
  });

  // keyboard
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
