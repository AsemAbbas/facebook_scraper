// =====================================================================
// مَرصَد · Frontend v2.2
// =====================================================================

const STATE = {
  index: { pages: [], last_run: null, sources_used: [] },
  allPosts: [],
  filtered: [],
  pages: {},        // الصفحات اللي فيها بيانات
  pagesConfig: [],  // من pages.json
  history: [],      // سجل التشغيلات
  liveRuns: [],     // jobs نشطة
  sourcesStatus: [],
  hasBackend: true, // v4.0: always backend
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
  activeFiltersBadge: document.getElementById('activeFiltersBadge'),
  // buttons
  refreshBtn: document.getElementById('refreshBtn'),
  triggerBtn: document.getElementById('triggerBtn'),
  exportBtn: document.getElementById('exportBtn'),
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
  if (els.footerYear) els.footerYear.textContent = new Date().getFullYear();

  // v4.0: always backend mode
  STATE.hasBackend = true;

  // User menu
  renderUserMenu();

  await loadIndex();
  await loadAllPages();
  await loadPagesConfig();
  await loadSourcesStatus();
  await loadHistory();

  setDefaultDateRange();
  restoreFilters();
  setupListeners();
  setupPostManagement();
  bindViewTabs();
  applyFilters();

  pollLiveRuns();
  setInterval(pollLiveRuns, 5000);

  maybeShowFirstRunWizard();
}

// ========= User Menu =========

function renderUserMenu() {
  const u = (window.AUTH && window.AUTH.user) ? window.AUTH.user : null;
  if (!u) {
    console.warn('[user menu] No AUTH.user available');
    return;
  }
  const displayName = u.display_name || u.username || '؟';
  const avatar = String(displayName).trim().slice(0, 1) || '؟';

  const avatarEl = document.getElementById('userAvatar');
  if (avatarEl) avatarEl.textContent = avatar;

  const nameEl = document.getElementById('userNameLabel');
  if (nameEl) nameEl.textContent = displayName;

  const usernameEl = document.getElementById('userUsernameLabel');
  if (usernameEl) usernameEl.textContent = '@' + u.username;

  const roleEl = document.getElementById('userRoleLabel');
  if (roleEl) roleEl.textContent = u.role === 'admin' ? '👑 مشرف' : '👤 مستخدم';

  if (u.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.hidden = false);
  } else {
    document.querySelectorAll('.admin-only').forEach(el => el.hidden = true);
  }
}

// ========= Post Management (Bulk Actions) =========

function setupPostManagement() {
  const selectAll = document.getElementById('selectAllCheckbox');
  const bulkDelete = document.getElementById('bulkDeleteBtn');
  const clearAll = document.getElementById('clearAllBtn');

  if (selectAll) {
    selectAll.addEventListener('change', () => {
      const checked = selectAll.checked;
      document.querySelectorAll('.post-select').forEach(cb => {
        cb.checked = checked;
      });
      updateBulkButtonVisibility();
    });
  }

  if (bulkDelete) {
    bulkDelete.addEventListener('click', async () => {
      const ids = Array.from(document.querySelectorAll('.post-select:checked'))
        .map(cb => parseInt(cb.dataset.postId))
        .filter(Boolean);
      if (ids.length === 0) {
        showToast('لا يوجد منشورات محددة', 'error');
        return;
      }
      if (!confirm(`حذف ${ids.length} منشور نهائياً؟`)) return;

      const res = await fetch('/api/posts/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`✅ تم حذف ${data.deleted} منشور`, 'success');
        await loadAllPages();
        applyFilters();
      } else {
        showToast('فشل الحذف', 'error');
      }
    });
  }

  if (clearAll) {
    clearAll.addEventListener('click', () => {
      openClearAllModal();
    });
  }
}

function updateBulkButtonVisibility() {
  const count = document.querySelectorAll('.post-select:checked').length;
  const btn = document.getElementById('bulkDeleteBtn');
  if (btn) {
    btn.hidden = count === 0;
    btn.textContent = count ? `🗑️ حذف (${count})` : '🗑️ حذف المحدد';
  }
}

function openClearAllModal() {
  const pages = Object.values(STATE.pages);
  openModal('🗑️ حذف المنشورات', `
    <div class="clear-modal">
      <div class="alert alert-warn">
        ⚠️ <strong>تحذير:</strong> هذه العملية لا يمكن التراجع عنها.
      </div>

      <h3>اختر ما تريد حذفه:</h3>

      <div class="clear-option">
        <h4>📁 حذف منشورات صفحة محددة</h4>
        <select id="clearPageSelect" class="select">
          <option value="">— اختر صفحة —</option>
          ${pages.map(p => `<option value="${escapeHtml(p.page_slug)}">${escapeHtml(p.page_name)} (${p.posts.length})</option>`).join('')}
        </select>
        <button class="btn-refresh btn-sm" id="clearPageBtn" type="button">حذف منشورات هذه الصفحة</button>
      </div>

      <div class="clear-option">
        <h4>📤 تصدير + حذف (أرشفة)</h4>
        <p class="small-note">ينزّل CSV أولاً ثم يحذف المنشورات.</p>
        <select id="archivePageSelect" class="select">
          <option value="">كل المنشورات</option>
          ${pages.map(p => `<option value="${escapeHtml(p.page_slug)}">${escapeHtml(p.page_name)} (${p.posts.length})</option>`).join('')}
        </select>
        <button class="btn-trigger btn-sm" id="archiveBtn" type="button">📤 تصدير وحذف</button>
      </div>

      <div class="clear-option">
        <h4>🧹 تنظيف المنشورات المكرّرة</h4>
        <p class="small-note">يفحص كل المنشورات ويحذف النسخ المكرّرة (نفس الرابط أو نفس النص من نفس الصفحة). يحتفظ بالنسخة الأقدم.</p>
        <button class="btn-trigger btn-sm" id="dedupeBtn" type="button">🧹 إزالة التكرار</button>
      </div>

      <div class="clear-option danger">
        <h4>💣 حذف كل المنشورات</h4>
        <p class="small-note">يحذف كل ${STATE.allPosts.length} منشور من كل الصفحات.</p>
        <button class="btn-refresh btn-sm danger-btn" id="clearAllConfirmBtn" type="button">حذف كل المنشورات</button>
      </div>
    </div>
  `);

  document.getElementById('dedupeBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!confirm('تشغيل تنظيف المنشورات المكرّرة؟ (يحتفظ بالنسخة الأقدم من كل منشور)')) return;
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '⏳ جاري الفحص...';
    try {
      const r = await fetch('/api/posts/dedupe', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل');
      const detail = d.removed > 0
        ? `✅ حُذف ${d.removed} منشور مكرّر (${d.by_id || 0} بنفس الـID، ${d.by_url} برابط مطابق، ${d.by_text} بنص مطابق). المتبقي: ${d.remaining}`
        : '✅ لا يوجد منشورات مكرّرة — كل المنشورات فريدة';
      showToast(detail, 'success');
      closeModal();
      await loadAllPages();
      applyFilters();
    } catch (err) {
      showToast('خطأ: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  document.getElementById('clearPageBtn').addEventListener('click', async () => {
    const slug = document.getElementById('clearPageSelect').value;
    if (!slug) {
      showToast('اختر صفحة', 'error');
      return;
    }
    if (!confirm(`حذف كل منشورات "${slug}" نهائياً؟`)) return;
    const res = await fetch(`/api/posts/clear-page/${encodeURIComponent(slug)}`, {
      method: 'POST', credentials: 'include',
    });
    if (res.ok) {
      const d = await res.json();
      showToast(`✅ تم حذف ${d.deleted} منشور`, 'success');
      closeModal();
      await loadAllPages();
      applyFilters();
    } else {
      showToast('فشل الحذف', 'error');
    }
  });

  document.getElementById('archiveBtn').addEventListener('click', async () => {
    const slug = document.getElementById('archivePageSelect').value;
    const target = slug ? `صفحة "${slug}"` : 'كل المنشورات';
    if (!confirm(`تصدير CSV لـ ${target} ثم حذفها؟`)) return;

    const res = await fetch('/api/posts/export-and-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(slug ? { page: slug } : {}),
    });
    if (res.ok) {
      const d = await res.json();
      // download csv
      const blob = new Blob([d.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `marsad_archive_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`✅ صُدِّر ${d.count} منشور وحُذف ${d.deleted}`, 'success');
      closeModal();
      await loadAllPages();
      applyFilters();
    } else {
      showToast('فشل', 'error');
    }
  });

  document.getElementById('clearAllConfirmBtn').addEventListener('click', async () => {
    if (!confirm(`تأكيد حذف كل ${STATE.allPosts.length} منشور نهائياً؟`)) return;
    if (!confirm('هل أنت متأكد تماماً؟ لا يوجد تراجع!')) return;
    const res = await fetch('/api/posts/clear-all', {
      method: 'POST', credentials: 'include',
    });
    if (res.ok) {
      const d = await res.json();
      showToast(`✅ تم حذف ${d.deleted} منشور`, 'success');
      closeModal();
      await loadAllPages();
      applyFilters();
    } else {
      showToast('فشل', 'error');
    }
  });
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
  // In v4.0 we rely on /api/posts + /api/pages + /api/history
  // Keep STATE.index for backward compat
  try {
    // Last run from history
    const res = await fetch('/api/history', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      const runs = data.runs || [];
      const lastRun = runs[0];
      STATE.index = {
        pages: [],
        last_run: lastRun ? lastRun.finished_at || lastRun.started_at : null,
        sources_used: lastRun ? lastRun.sources_used || [] : [],
      };
      updateLastUpdate(STATE.index.last_run);
    }
  } catch {}
}

async function loadAllPages() {
  // v4.0: load from /api/posts (all user posts)
  try {
    const res = await fetch('/api/posts?limit=500', { credentials: 'include' });
    if (!res.ok) {
      STATE.allPosts = [];
      return;
    }
    const data = await res.json();
    STATE.allPosts = data.posts || [];

    // group by page_slug
    STATE.pages = {};
    STATE.allPosts.forEach(p => {
      if (!STATE.pages[p.page_slug]) {
        STATE.pages[p.page_slug] = {
          page_slug: p.page_slug,
          page_name: p.page_name,
          posts: [],
        };
      }
      STATE.pages[p.page_slug].posts.push(p);
    });

    // Build index.pages from loaded data
    if (STATE.index) {
      STATE.index.pages = Object.values(STATE.pages).map(pg => ({
        slug: pg.page_slug,
        name: pg.page_name,
        status: 'success',
      }));
      renderPageFilter();
    }

    updateStats();
  } catch (e) {
    console.error('loadAllPages failed', e);
    STATE.allPosts = [];
  }
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
    const res = await fetch('/api/sources', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      STATE.sourcesStatus = data.sources || data || [];
    }
  } catch (e) {
    console.error('loadSourcesStatus failed', e);
    STATE.sourcesStatus = [];
  }
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
  updateStats();   // refresh the top stat cards to reflect the filtered subset
  renderPosts();
  // لو المستخدم في analytics view → جدّد الإحصائيات أيضاً
  if (STATE.currentView === 'analytics') renderAnalyticsView();
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
    const media = Array.isArray(post.media) ? post.media : [];
    const mediaCount = media.length;
    const primaryImage = post.image_url
      || (media.find(m => m.type === 'image') || {}).url
      || (media.find(m => m.type !== 'video') || {}).thumbnail
      || '';
    const hasVideo = !!post.video_url || media.some(m => m.type === 'video');
    const imageHtml = primaryImage
      ? `<div class="post-image ${hasVideo ? 'has-video' : ''}">
           <img src="${escapeHtml(proxyMediaUrl(primaryImage))}" alt="" loading="lazy" onerror="this.parentElement.remove()">
           ${hasVideo ? '<span class="play-overlay" aria-hidden="true"></span>' : ''}
           ${mediaCount > 1 ? `<span class="media-count-chip">+${mediaCount - 1}</span>` : ''}
         </div>`
      : '';
    const typeIcon = postTypeIcon(post.post_type);
    const hasComments = (post.comments_data || []).length > 0;

    const typeBadge = postTypeBadge(post.post_type || 'text');

    return `
      <article class="post-card clickable" data-post-id="${escapeHtml(post.post_id)}" data-post-slug="${escapeHtml(post.page_slug)}" data-post-internal="${post.id || ''}" style="animation-delay: ${Math.min(i * 30, 600)}ms">
        <div class="post-checkbox-wrap">
          <input type="checkbox" class="post-select" data-post-id="${post.id || ''}">
        </div>
        <button class="btn-delete-post" title="حذف هذا المنشور" type="button">×</button>
        <div class="post-header">
          <div class="post-page">${escapeHtml(post.page_name)}</div>
          <div class="post-time">${formatTime(post.timestamp_text, post.published_at || post.scraped_at)}</div>
        </div>
        <div class="post-meta-row">${typeBadge}${sourceBadge}</div>
        ${imageHtml}
        <div class="post-text">${escapeHtml(post.text || '')}</div>
        ${mediaCount > 1 && !primaryImage ? `<div class="post-media-count">${mediaCount} ملف ميديا</div>` : ''}
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
          <span class="post-detail-hint">انقر للتفاصيل ↓</span>
        </div>
      </article>
    `;
  }).join('');

  // Click handlers
  document.querySelectorAll('.post-card.clickable').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('a, input, button')) return;
      const postId = card.dataset.postId;
      const slug = card.dataset.postSlug;
      const post = STATE.allPosts.find(p => p.post_id === postId && p.page_slug === slug);
      if (post) openPostDetailModal(post);
    });
  });

  // Checkbox change
  document.querySelectorAll('.post-select').forEach(cb => {
    cb.addEventListener('change', updateBulkButtonVisibility);
    cb.addEventListener('click', e => e.stopPropagation());
  });

  // Delete button
  document.querySelectorAll('.btn-delete-post').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const card = btn.closest('.post-card');
      const pid = card.dataset.postInternal;
      if (!pid) return;
      if (!confirm('حذف هذا المنشور؟')) return;
      const res = await fetch(`/api/posts/${pid}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (res.ok) {
        card.style.opacity = '0';
        setTimeout(() => {
          card.remove();
          showToast('تم الحذف', 'success');
          loadAllPages().then(applyFilters);
        }, 200);
      } else {
        showToast('فشل الحذف', 'error');
      }
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
    text: '📝 ',
  };
  return icons[type] || '📝 ';
}

function postTypeBadge(type) {
  const badges = {
    video: { icon: '🎥', label: 'فيديو',  cls: 'video' },
    photo: { icon: '🖼',  label: 'صورة',   cls: 'photo' },
    link:  { icon: '🔗', label: 'رابط',   cls: 'link' },
    live:  { icon: '🔴', label: 'مباشر',  cls: 'live' },
    event: { icon: '📅', label: 'فعالية', cls: 'event' },
    text:  { icon: '📝', label: 'نص',    cls: 'text' },
  };
  const b = badges[type] || badges.text;
  return `<span class="post-type-badge ${b.cls}" title="نوع المنشور: ${b.label}">${b.icon} ${b.label}</span>`;
}

function renderSourceBadge(source) {
  if (!source || source === 'unknown') return '';
  const badges = {
    apify: { icon: '💎', label: 'Apify', className: 'premium' },
    rss:   { icon: '📡', label: 'RSS',   className: 'rss' },
    // legacy badges (لمنشورات قديمة قبل التبسيط)
    fetchrss:   { icon: '📡', label: 'RSS', className: 'rss' },
    rssapp:     { icon: '📡', label: 'RSS', className: 'rss' },
    rsshub:     { icon: '📡', label: 'RSS', className: 'rss' },
    playwright: { icon: '🎭', label: 'Playwright', className: 'local' },
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
  // Use the filtered collection when any filter is active so the stats reflect
  // what the user is actually looking at. Falls back to all posts otherwise.
  const posts = Array.isArray(STATE.filtered) && STATE.filtered.length !== STATE.allPosts.length
    ? STATE.filtered
    : STATE.allPosts;

  const isFiltered = posts !== STATE.allPosts;

  // Count distinct pages within the viewed set
  const pageSlugs = new Set();
  let totalReactions = 0;
  let totalComments = 0;
  for (const p of posts) {
    if (p.page_slug) pageSlugs.add(p.page_slug);
    totalReactions += p.reactions || 0;
    totalComments += p.comments || 0;
  }

  if (els.statPages) els.statPages.textContent = pageSlugs.size || Object.keys(STATE.pages).length;
  if (els.statPosts) els.statPosts.textContent = formatNum(posts.length);
  if (els.statReactions) els.statReactions.textContent = formatNum(totalReactions);
  if (els.statComments) els.statComments.textContent = formatNum(totalComments);

  // Visual cue that stats reflect a filtered subset
  document.querySelectorAll('.stats-bar .stat').forEach(el => el.classList.toggle('is-filtered', isFiltered));

  const sources = STATE.index?.sources_used || [];
  if (els.sourcesUsed) {
    els.sourcesUsed.textContent = sources.length ? `المصادر: ${sources.join(' · ')}` : '';
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

function ensureFullFbUrl(url) {
  if (!url) return '';
  url = String(url).trim();
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return 'https://www.facebook.com' + url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  // mbasic or other
  if (url.startsWith('www.facebook.com') || url.startsWith('facebook.com') ||
      url.startsWith('mbasic.facebook.com') || url.startsWith('m.facebook.com')) {
    return 'https://' + url;
  }
  // Probably a relative path without leading /
  return 'https://www.facebook.com/' + url;
}

/**
 * يلف رابط ميديا (صور/فيديوهات) بـ proxy داخلي عشان يشتغل من داخل المنصة
 * بدون أن يبلوكه fbcdn (الذي يرفض requests من domains خارجية).
 */
function proxyMediaUrl(url) {
  if (!url) return '';
  const u = String(url).trim();
  if (!u || u.startsWith('data:') || u.startsWith('blob:')) return u;
  // proxy فقط الـ media الخارجية - لو الـ url داخلي خله يعدي
  if (u.startsWith('/') && !u.startsWith('//')) return u;
  return '/api/media-proxy?u=' + encodeURIComponent(u);
}

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

function slugify(text, urlHint) {
  // 1) جرّب نولد slug من النص (للأسماء الإنجليزية يطلع جيد)
  const fromText = String(text || '')
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  if (fromText && fromText.length >= 3) return fromText;

  // 2) للأسماء العربية أو الفارغة: نستخرج slug من الـ URL (آخر segment غالباً ASCII)
  if (urlHint) {
    try {
      const u = new URL(urlHint);
      const path = (u.pathname || '').replace(/^\/+|\/+$/g, '');
      const lastSeg = path.split('/').pop() || u.hostname || '';
      const fromUrl = lastSeg.toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 40);
      if (fromUrl && fromUrl.length >= 2) return fromUrl;
      // fallback: hostname
      const hostSlug = (u.hostname || '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
      if (hostSlug) return hostSlug;
    } catch {}
  }

  // 3) fallback مع counter بدل timestamp (ثابت + sequential)
  STATE._slugCounter = (STATE._slugCounter || 0) + 1;
  return `page_${STATE._slugCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

// يضمن slug فريد داخل قائمة - لو في تكرار يضيف _2, _3 إلخ
function ensureUniqueSlug(slug, existingSlugs) {
  if (!existingSlugs.has(slug)) {
    existingSlugs.add(slug);
    return slug;
  }
  let n = 2;
  while (existingSlugs.has(`${slug}_${n}`)) n++;
  const unique = `${slug}_${n}`;
  existingSlugs.add(unique);
  return unique;
}

/**
 * يطبّع رابط الصفحة عشان نتعرف على التكرار حتى لو الـ URL كُتب بصور مختلفة.
 * "https://www.facebook.com/PalestineTV/posts/abc?ref=xyz" →
 * "facebook.com/palestinetv"
 */
function normalizePageKey(url) {
  if (!url) return '';
  let u = String(url).trim().toLowerCase();
  // أزل query/hash
  u = u.split('?')[0].split('#')[0];
  // ابدأ من scheme لو موجود
  u = u.replace(/^https?:\/\//, '');
  // وحّد فيسبوك subdomains
  u = u.replace(/^(www\.|m\.|mbasic\.|web\.)/, '');
  u = u.replace(/^facebook\.com/, 'facebook.com');
  // أزل trailing slash + posts/pfbid... (نهتم بالصفحة فقط)
  u = u.split('/posts/')[0];
  u = u.split('/videos/')[0];
  u = u.split('/photos/')[0];
  u = u.replace(/\/+$/, '');
  return u;
}

/**
 * يفحص هل الصفحة موجودة بالفعل في القائمة.
 * يقارن بالـ slug، الـ URL المُطبَّع، أو الاسم (case-insensitive).
 * يرجع index الصفحة الموجودة، أو -1.
 */
function findDuplicatePageIndex(page, list, ignoreIndex = -1) {
  const newKey = normalizePageKey(page.url);
  const newSlug = (page.slug || '').toLowerCase();
  const newName = (page.name || '').trim().toLowerCase();

  for (let i = 0; i < list.length; i++) {
    if (i === ignoreIndex) continue;
    const p = list[i];
    if (newSlug && (p.slug || '').toLowerCase() === newSlug) return i;
    if (newKey && normalizePageKey(p.url) === newKey) return i;
    if (newName && (p.name || '').trim().toLowerCase() === newName && newName.length >= 3) return i;
  }
  return -1;
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
          ✨ المصادر المفعّلة: ${enabledSources.map(s => (s.icon || '🔌') + ' ' + (s.label || s.source_name || s.name || '—')).join('، ')}
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
            `<option value="${s.source_name || s.name}">${s.icon || '🔌'} ${s.label || s.source_name || s.name}</option>`
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


// ========= Pages Management =========

function openPagesModal() {
  const pages = STATE.pagesConfig;
  const hasBackend = STATE.hasBackend;

  openModal('📄 إدارة الصفحات', `
    <div class="pages-manager">
      <div class="pages-toolbar">
        <button class="btn-trigger btn-sm" id="addPageBtn" type="button">+ إضافة صفحة</button>
        <button class="btn-refresh btn-sm" id="importPagesJson" type="button" title="استيراد من Excel/CSV/JSON">📥 استيراد</button>
        <button class="btn-refresh btn-sm" id="exportPagesJson" type="button" title="تصدير إلى Excel/CSV">📤 تصدير CSV</button>
        <button class="btn-refresh btn-sm" id="downloadPagesTemplate" type="button" title="تحميل قالب CSV فاضي">📋 قالب CSV</button>
      </div>

      <div class="pages-search-bar">
        <div class="pages-search-input-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" id="pagesSearch" class="input" placeholder="ابحث بالاسم، الرابط، أو المدينة…" autocomplete="off">
          <button class="pages-search-clear" id="pagesSearchClear" type="button" title="مسح البحث" hidden>×</button>
        </div>
        <div class="pages-toolbar-secondary">
          <span class="pages-count" id="pagesCount">${pages.length} صفحة</span>
          <button class="btn-refresh btn-sm" id="expandAllPagesBtn" type="button" title="فتح الكل">⤓ افتح الكل</button>
          <button class="btn-refresh btn-sm" id="collapseAllPagesBtn" type="button" title="طي الكل">⤒ طوِ الكل</button>
        </div>
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
          ? `<strong>💡 الاستيراد من Excel:</strong> صدّر قالب CSV، افتحه في Excel، عبّي الأعمدة (عدد المتابعين، اسم الصفحة، City، NumberOfPost، Page Link)، احفظه كـ CSV، ثم استورده هنا. الأعمدة بالعربية أو الإنجليزية.`
          : `<strong>ملاحظة:</strong> بعد الحفظ، شغّل سحب جديد من زر "سحب الآن".`}
      </p>
    </div>
  `, 'lg');

  bindPagesManagerEvents();
}

function renderPageRow(page, index) {
  // محتوى صفّ الـ search (للفلترة client-side بدون إعادة render)
  const searchBlob = [
    page.name || '', page.url || '', page.city || '', page.slug || ''
  ].join(' ').toLowerCase();

  // مصدر سيُستخدَم (للعرض في الـ summary)
  const srcGuess = page.source && page.source !== 'auto'
    ? page.source
    : ((page.url || '').toLowerCase().match(/facebook\.com|fb\.com/) ? 'apify' : 'rss');
  const srcIcon = srcGuess === 'apify' ? '💎' : '📡';
  const srcLabel = srcGuess === 'apify' ? 'فيسبوك (Apify)' : 'RSS';

  return `
    <div class="page-row" data-index="${index}" data-slug="${escapeHtml(page.slug || '')}" data-search="${escapeHtml(searchBlob)}">
      <div class="page-row-head" role="button" tabindex="0">
        <label class="switch" onclick="event.stopPropagation()">
          <input type="checkbox" class="page-enabled" ${page.enabled !== false ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
        <div class="page-row-summary">
          <strong class="page-row-name">${escapeHtml(page.name || '(بدون اسم)')}</strong>
          <div class="page-row-meta">
            <span class="page-meta-source" title="المصدر">${srcIcon} ${srcLabel}</span>
            ${page.city ? `<span class="page-meta-city">📍 ${escapeHtml(page.city)}</span>` : ''}
            ${page.followers ? `<span class="page-meta-followers">👥 ${formatNum(page.followers)}</span>` : ''}
            <span class="page-meta-max">🎯 ${page.max_posts || 30}</span>
          </div>
        </div>
        ${STATE.hasBackend ? `<button class="btn-icon-sm btn-test page-test-btn" title="اختبر السحب" type="button" onclick="event.stopPropagation()">🧪</button>` : ''}
        <button class="btn-icon-sm btn-danger page-delete" title="حذف" type="button" onclick="event.stopPropagation()">×</button>
        <button class="btn-icon-sm page-collapse-btn" type="button" aria-label="توسيع/طي" tabindex="-1">
          <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
      <div class="page-row-body" hidden>
        <div class="form-row">
          <label class="filter-label">اسم الصفحة</label>
          <input type="text" class="input page-name" placeholder="اسم الصفحة (مثل: قناة الجزيرة)" value="${escapeHtml(page.name || '')}">
        </div>
        <div class="form-row">
          <label class="filter-label">رابط الصفحة (Page Link)</label>
          <input type="text" class="input page-url" placeholder="https://www.facebook.com/..." value="${escapeHtml(page.url || '')}" dir="ltr">
        </div>
        <div class="page-row-inline">
          <div class="form-row">
            <label class="filter-label">المدينة (City)</label>
            <input type="text" class="input page-city" placeholder="مثلاً: عام، رام الله" value="${escapeHtml(page.city || '')}">
          </div>
          <div class="form-row">
            <label class="filter-label">عدد المتابعين</label>
            <input type="number" class="input page-followers" min="0" placeholder="0" value="${page.followers || 0}" dir="ltr">
          </div>
          <div class="form-row">
            <label class="filter-label">عدد المنشورات (NumberOfPost)</label>
            <input type="number" class="input page-max-posts" min="1" max="500" value="${page.max_posts || 30}">
          </div>
        </div>
        <div class="page-row-inline">
          <div class="form-row">
            <label class="filter-label">Slug (الـ ID المختصر)</label>
            <input type="text" class="input page-slug" placeholder="تلقائي من الاسم" value="${escapeHtml(page.slug || '')}" dir="ltr">
          </div>
          <div class="form-row">
            <label class="filter-label">المصدر</label>
            <select class="select page-source">
              <option value="auto" ${(page.source || 'auto') === 'auto' ? 'selected' : ''}>تلقائي (حسب الرابط)</option>
              <option value="apify" ${page.source === 'apify' ? 'selected' : ''}>💎 Apify (فيسبوك)</option>
              <option value="rss" ${page.source === 'rss' ? 'selected' : ''}>📡 RSS</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindPagesManagerEvents() {
  // ===== Search filter (client-side) =====
  const searchInput = document.getElementById('pagesSearch');
  const searchClear = document.getElementById('pagesSearchClear');
  const pagesCountEl = document.getElementById('pagesCount');

  function applyPagesSearch() {
    const q = (searchInput?.value || '').trim().toLowerCase();
    const rows = document.querySelectorAll('#pagesList .page-row');
    let visible = 0;
    rows.forEach(r => {
      const blob = r.dataset.search || '';
      const match = !q || blob.includes(q);
      r.hidden = !match;
      if (match) visible++;
    });
    if (pagesCountEl) {
      pagesCountEl.textContent = q
        ? `${visible} من ${rows.length} صفحة`
        : `${rows.length} صفحة`;
    }
    if (searchClear) searchClear.hidden = !q;
  }
  if (searchInput) {
    searchInput.addEventListener('input', applyPagesSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { searchInput.value = ''; applyPagesSearch(); }
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      applyPagesSearch();
      searchInput?.focus();
    });
  }

  // ===== Expand/collapse =====
  document.querySelectorAll('#pagesList .page-row-head').forEach(head => {
    const toggle = (e) => {
      if (e.target.closest('input, button, .switch')) return;
      const row = head.closest('.page-row');
      row.classList.toggle('expanded');
      const body = row.querySelector('.page-row-body');
      if (body) body.hidden = !row.classList.contains('expanded');
      const chev = row.querySelector('.chev');
      if (chev) chev.style.transform = row.classList.contains('expanded') ? 'rotate(180deg)' : '';
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); }
    });
  });

  document.getElementById('expandAllPagesBtn')?.addEventListener('click', () => {
    document.querySelectorAll('#pagesList .page-row').forEach(r => {
      r.classList.add('expanded');
      const body = r.querySelector('.page-row-body');
      if (body) body.hidden = false;
      const chev = r.querySelector('.chev');
      if (chev) chev.style.transform = 'rotate(180deg)';
    });
  });
  document.getElementById('collapseAllPagesBtn')?.addEventListener('click', () => {
    document.querySelectorAll('#pagesList .page-row').forEach(r => {
      r.classList.remove('expanded');
      const body = r.querySelector('.page-row-body');
      if (body) body.hidden = true;
      const chev = r.querySelector('.chev');
      if (chev) chev.style.transform = '';
    });
  });

  document.getElementById('addPageBtn').addEventListener('click', () => {
    syncPagesFromUI();
    STATE.pagesConfig.push({
      slug: '', name: '', url: '',
      max_posts: 30, source: 'auto', enabled: true,
      city: '', followers: 0,
      _newlyAdded: true,   // فُتح تلقائياً بعد render
    });
    openPagesModal();
    // اطلق tab الـ new (يُفتح تلقائياً)
    setTimeout(() => {
      const newRow = document.querySelector('.page-row:last-child');
      if (newRow) {
        newRow.classList.add('expanded');
        newRow.querySelector('.page-row-body').hidden = false;
        const chev = newRow.querySelector('.chev');
        if (chev) chev.style.transform = 'rotate(180deg)';
        newRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        newRow.querySelector('.page-name')?.focus();
      }
    }, 50);
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

  // ===== CSV / Excel export — same headers as the Excel screenshot =====
  document.getElementById('exportPagesJson').addEventListener('click', () => {
    syncPagesFromUI();
    const csv = pagesToCsv(STATE.pagesConfig);
    // BOM ensures Excel opens UTF-8 Arabic correctly
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pages_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`تم تصدير ${STATE.pagesConfig.length} صفحة كـ CSV`, 'success');
  });

  // ===== Import from CSV (Excel-saved) or JSON =====
  document.getElementById('importPagesJson').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,application/json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        let pages = [];
        if (file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{')) {
          const data = JSON.parse(text);
          pages = Array.isArray(data) ? data : (data.pages || []);
        } else {
          pages = csvToPages(text);
        }
        if (!Array.isArray(pages) || pages.length === 0) {
          showToast('لم يتم العثور على صفحات في الملف', 'error');
          return;
        }

        // عدّ تكرار داخل الملف نفسه (لو CSV فيه نفس الصفحة مرتين)
        const seenInFile = [];

        const usedSlugs = new Set(
          STATE.pagesConfig.map(p => p.slug || slugify(p.name, p.url)).filter(Boolean)
        );

        let added = 0, updated = 0, skippedNoUrl = 0, skippedDup = 0;

        for (const p of pages) {
          if (!p.url) { skippedNoUrl++; continue; }

          // نفس الصفحة مكررة داخل ملف الاستيراد نفسه → نأخذ آخر نسخة فقط
          const inFileIdx = findDuplicatePageIndex(p, seenInFile);
          if (inFileIdx !== -1) {
            seenInFile[inFileIdx] = p;   // overwrite (last wins)
            continue;
          }
          seenInFile.push(p);
        }

        for (const p of seenInFile) {
          // هل هي موجودة بالفعل في الـ STATE؟
          const existingIdx = findDuplicatePageIndex(p, STATE.pagesConfig);
          let slug = (p.slug || '').trim() || slugify(p.name, p.url);

          if (existingIdx !== -1) {
            // update — احتفظ بالـ slug الأصلي (ما نغيّره عشان ما نكسر علاقات قديمة)
            const existing = STATE.pagesConfig[existingIdx];
            Object.assign(existing, p, { slug: existing.slug || slug });
            updated++;
            continue;
          }

          // جديد - تأكد من uniqueness للـ slug
          slug = ensureUniqueSlug(slug, usedSlugs);
          STATE.pagesConfig.push({ ...p, slug });
          added++;
        }

        skippedDup = pages.length - seenInFile.length;
        openPagesModal();
        const parts = [`${added} جديدة`, `${updated} محدّثة`];
        if (skippedDup > 0) parts.push(`${skippedDup} مكرّرة في الملف`);
        if (skippedNoUrl > 0) parts.push(`${skippedNoUrl} بلا رابط`);
        showToast(`✅ تم الاستيراد: ${parts.join('، ')}`, 'success');
      } catch (err) {
        showToast('خطأ في القراءة: ' + err.message, 'error');
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

  // === Download empty CSV template ===
  const tplBtn = document.getElementById('downloadPagesTemplate');
  if (tplBtn) {
    tplBtn.addEventListener('click', () => {
      const sample = [
        { name: 'تلفزيون فلسطين', city: 'عام', followers: 6218372, max_posts: 45,
          url: 'https://www.facebook.com/PalestineTV', slug: '', source: 'auto', enabled: true },
        { name: 'وكالة وفا', city: 'عام', followers: 795113, max_posts: 40,
          url: 'https://www.facebook.com/wafagency', slug: '', source: 'auto', enabled: true },
      ];
      const csv = pagesToCsv(sample);
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pages_template.csv';
      a.click();
      URL.revokeObjectURL(url);
      showToast('تم تنزيل القالب — افتحه في Excel، املأ البيانات، ثم استورده', 'success');
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
  // first pass: read all values
  const rows = Array.from(document.querySelectorAll('.page-row'));
  rows.forEach(row => {
    const index = parseInt(row.dataset.index);
    const page = STATE.pagesConfig[index];
    if (!page) return;
    // الـ body قد يكون مطوي - الـ inputs موجودة لكن hidden. ما زالت تُقرأ.
    const nameEl = row.querySelector('.page-name');
    const urlEl = row.querySelector('.page-url');
    if (!nameEl || !urlEl) return;
    page.name = nameEl.value.trim();
    page.url = urlEl.value.trim();
    let slug = row.querySelector('.page-slug').value.trim();
    if (!slug) slug = slugify(page.name, page.url);
    page.slug = slug;
    page.max_posts = parseInt(row.querySelector('.page-max-posts').value) || 30;
    page.source = row.querySelector('.page-source').value;
    page.enabled = row.querySelector('.page-enabled').checked;
    page.city = (row.querySelector('.page-city')?.value || '').trim();
    page.followers = parseInt(row.querySelector('.page-followers')?.value) || 0;
    // Date fields removed from this section — schedule has its own date range
    delete page.date_from;
    delete page.date_to;
  });

  // second pass: dedupe by URL/name (دمج التكرارات client-side قبل الإرسال).
  // إذا في صفّين بنفس الـ URL أو الاسم، نحتفظ بأول واحد ونحذف الباقي.
  const deduped = [];
  const seenIdxs = [];
  STATE.pagesConfig.forEach((p, i) => {
    const dupIdx = findDuplicatePageIndex(p, deduped);
    if (dupIdx === -1) {
      deduped.push(p);
      seenIdxs.push(i);
    }
    // التكرار يُتجاهل بصمت (الأول الذي وصل يفوز)
  });
  if (deduped.length !== STATE.pagesConfig.length) {
    const removed = STATE.pagesConfig.length - deduped.length;
    STATE.pagesConfig = deduped;
    showToast(`⚠️ تم دمج ${removed} صفحة مكرّرة قبل الحفظ`, 'warn');
  }

  // third pass: ensure slug uniqueness across the whole list (defense
  // against duplicate slugs that would silently get DELETEd by upsert_pages).
  const usedSlugs = new Set();
  STATE.pagesConfig.forEach(p => {
    if (!p.slug) p.slug = slugify(p.name, p.url);
    if (usedSlugs.has(p.slug)) {
      p.slug = ensureUniqueSlug(p.slug, usedSlugs);
    } else {
      usedSlugs.add(p.slug);
    }
  });
}

// ==================== CSV import/export (Excel-friendly) ====================
// نفس ترتيب الأعمدة في صورة الإكسل اللي بعتها المستخدم:
// عدد المتابعين | اسم الصفحة | City | NumberOfPost | Page Link

const CSV_HEADERS_AR = ['عدد المتابعين', 'اسم الصفحة', 'City', 'NumberOfPost', 'Page Link'];

// Aliases عشان نتعرف على الأعمدة حتى لو الـ Excel غيّر التسمية
const HEADER_ALIASES = {
  followers:  ['عدد المتابعين', 'followers', 'follower', 'fans', 'متابعين', 'followerscount', 'followers_count'],
  name:       ['اسم الصفحة', 'name', 'page name', 'page_name', 'الاسم', 'الصفحة', 'page'],
  city:       ['city', 'المدينة', 'مدينة', 'المنطقة'],
  max_posts:  ['numberofpost', 'number of post', 'max_posts', 'maxposts', 'عدد المنشورات', 'حد المنشورات'],
  url:        ['page link', 'pagelink', 'url', 'link', 'الرابط', 'رابط الصفحة'],
  slug:       ['slug', 'id', 'الـid', 'كود'],
  source:     ['source', 'المصدر', 'مصدر'],
  enabled:    ['enabled', 'مفعل', 'مفعّل', 'active'],
};

function _csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function pagesToCsv(pages) {
  const lines = [CSV_HEADERS_AR.join(',')];
  for (const p of pages) {
    lines.push([
      _csvEscape(p.followers || 0),
      _csvEscape(p.name || ''),
      _csvEscape(p.city || ''),
      _csvEscape(p.max_posts || 30),
      _csvEscape(p.url || ''),
    ].join(','));
  }
  return lines.join('\r\n');
}

function _parseCsvLine(line) {
  // RFC 4180 CSV parsing — يدعم الاقتباس وعلامة , داخل خلية مقتبسة
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { cur += c; }
    } else {
      if (c === '"') inQ = true;
      else if (c === ',' || c === '\t' || c === ';') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function _findHeaderIndex(headers, fieldKey) {
  const aliases = HEADER_ALIASES[fieldKey] || [];
  const norm = h => h.replace(/\s+/g, ' ').trim().toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i]);
    if (aliases.some(a => norm(a) === h || h.includes(norm(a)))) return i;
  }
  return -1;
}

function csvToPages(text) {
  // أزل BOM لو موجود
  text = text.replace(/^﻿/, '');
  const rows = text.split(/\r?\n/).filter(r => r.trim());
  if (rows.length < 2) return [];

  const headers = _parseCsvLine(rows[0]);
  const idx = {
    followers: _findHeaderIndex(headers, 'followers'),
    name:      _findHeaderIndex(headers, 'name'),
    city:      _findHeaderIndex(headers, 'city'),
    max_posts: _findHeaderIndex(headers, 'max_posts'),
    url:       _findHeaderIndex(headers, 'url'),
    slug:      _findHeaderIndex(headers, 'slug'),
    source:    _findHeaderIndex(headers, 'source'),
    enabled:   _findHeaderIndex(headers, 'enabled'),
  };

  // الأعمدة الإجبارية: name + url
  if (idx.name === -1 && idx.url === -1) {
    throw new Error('لم نجد أعمدة "اسم الصفحة" أو "Page Link" — تأكد من أن أول صف يحوي العناوين');
  }

  const pages = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = _parseCsvLine(rows[r]);
    const get = (k) => idx[k] !== -1 ? (cells[idx[k]] || '').trim() : '';

    const url = get('url');
    const name = get('name');
    if (!url && !name) continue;

    const followersRaw = get('followers').replace(/[,\s]/g, '');
    const maxPostsRaw = get('max_posts');
    const enabledRaw = get('enabled').toLowerCase();

    pages.push({
      name: name || '(بدون اسم)',
      url,
      slug: get('slug') || slugify(name, url),
      city: get('city'),
      followers: parseInt(followersRaw) || 0,
      max_posts: parseInt(maxPostsRaw) || 30,
      source: get('source') || 'auto',
      enabled: idx.enabled === -1 ? true : !['0', 'no', 'false', 'لا', 'معطل'].includes(enabledRaw),
    });
  }
  return pages;
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

  // عرض كل الميديا - الفيديو يشتغل داخل المنصة بـ <video controls>
  // والصور لها lightbox onclick
  const renderMediaItem = (m) => {
    const url = m.url || '';
    const proxied = proxyMediaUrl(url);
    if (m.type === 'video') {
      return `
        <div class="media-item video-inline">
          <video controls preload="metadata" playsinline
                 ${m.thumbnail ? `poster="${escapeHtml(proxyMediaUrl(m.thumbnail))}"` : ''}>
            <source src="${escapeHtml(proxied)}">
            متصفحك لا يدعم تشغيل الفيديو.
          </video>
        </div>
      `;
    }
    return `
      <a href="${escapeHtml(proxied)}" target="_blank" rel="noopener" class="media-item"
         data-lightbox="${escapeHtml(proxied)}">
        <img src="${escapeHtml(proxied)}" alt="" loading="lazy"
             onerror="this.parentElement.classList.add('broken')">
      </a>
    `;
  };

  const mediaHtml = media.length
    ? `<div class="detail-section">
         <h3>📎 الميديا (${media.length})</h3>
         <div class="detail-media-grid">
           ${media.map(renderMediaItem).join('')}
         </div>
       </div>`
    : (post.image_url
      ? `<div class="detail-section">
           <h3>📎 الميديا</h3>
           <div class="detail-media-grid">
             <a href="${escapeHtml(proxyMediaUrl(post.image_url))}" target="_blank" rel="noopener" class="media-item"
                data-lightbox="${escapeHtml(proxyMediaUrl(post.image_url))}">
               <img src="${escapeHtml(proxyMediaUrl(post.image_url))}" alt="" loading="lazy">
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

      ${(!comments && !reactions && post.source === 'playwright') ? `
        <div class="alert alert-info" style="margin-top: 0.75rem">
          ℹ️ <strong>ملاحظة:</strong> مصدر Playwright لا يجلب أعداد التفاعلات والتعليقات بشكل دقيق لأن فيسبوك يخفيها عن الزوار غير المسجلين.
          للحصول على تفاعلات وتعليقات دقيقة استخدم <strong>Apify</strong> من الإعدادات.
        </div>
      ` : ''}

      <div class="detail-actions">
        ${post.post_url
          ? `<a href="${escapeHtml(ensureFullFbUrl(post.post_url))}" target="_blank" rel="noopener noreferrer" class="btn-facebook" title="فتح المنشور الأصلي على فيسبوك">
               <svg class="fb-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                 <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
               </svg>
               <span class="fb-label">فتح على فيسبوك</span>
               <span class="fb-arrow" aria-hidden="true">↗</span>
             </a>`
          : `<button class="btn-refresh" disabled title="الرابط غير متاح">رابط غير متاح ⊘</button>`
        }
        <button class="btn-refresh" id="copyPostLink" ${!post.post_url ? 'disabled' : ''}>نسخ الرابط</button>
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
        ${post.id ? `
          <button type="button" class="btn-refresh btn-sm view-raw-btn" data-post-id="${post.id}" style="margin-top:8px">
            🔬 عرض raw JSON من المصدر
          </button>
          <pre class="raw-json-view" hidden></pre>
        ` : ''}
      </details>
    </div>
  `, 'lg');

  // Action handlers
  const cl = document.getElementById('copyPostLink');
  if (cl) cl.addEventListener('click', () => {
    if (post.post_url) {
      navigator.clipboard.writeText(ensureFullFbUrl(post.post_url));
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

  // Raw JSON viewer (for debugging what the source actually returned)
  const rawBtn = document.querySelector('.view-raw-btn');
  if (rawBtn) {
    rawBtn.addEventListener('click', async () => {
      const pid = rawBtn.dataset.postId;
      const pane = rawBtn.nextElementSibling;
      if (!pane || !pid) return;
      if (!pane.hidden) { pane.hidden = true; return; }
      rawBtn.disabled = true;
      rawBtn.textContent = '⏳ جاري التحميل...';
      try {
        const res = await fetch(`/api/posts/${pid}/raw`, { credentials: 'include' });
        if (!res.ok) throw new Error('فشل تحميل البيانات الأصلية');
        const data = await res.json();
        pane.textContent = JSON.stringify(data, null, 2);
        pane.hidden = false;
      } catch (e) {
        showToast(e.message, 'error');
      }
      rawBtn.disabled = false;
      rawBtn.textContent = '🔬 عرض raw JSON من المصدر';
    });
  }
}

function reactionIcon(key) {
  return { like: '👍', love: '❤️', haha: '😂', wow: '😮', sad: '😢', angry: '😠', care: '🤗' }[key] || '❤';
}

// ========= Analytics Dashboard =========

function openAnalyticsModal() {
  // الزر القديم في القائمة الآن يبدّل لـ analytics view
  switchView('analytics');
}

function renderAnalyticsView() {
  const pane = document.getElementById('analyticsView');
  if (!pane) return;

  // استخدم المنشورات المفلترة لو في فلتر نشط، وإلا الكل
  const posts = (Array.isArray(STATE.filtered) && STATE.filtered.length !== STATE.allPosts.length)
    ? STATE.filtered
    : STATE.allPosts;

  if (!posts.length) {
    pane.innerHTML = '<div class="empty"><p>لا توجد بيانات للتحليل بعد. اسحب منشورات أولاً.</p></div>';
    return;
  }

  const isFiltered = posts !== STATE.allPosts;

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

  pane.innerHTML = `
    <div class="analytics-wrapper">
      <div class="analytics-header">
        <h2>📊 الإحصاءات والتحليلات${isFiltered ? ' <span class="filter-chip">🔍 نتائج الفلتر</span>' : ''}</h2>
        <p class="analytics-sub">${isFiltered ? 'الأرقام تعكس الفلاتر النشطة في الأعلى. عدّل الفلاتر وسيتم تحديث الإحصائيات.' : 'الأرقام لكل المنشورات. استخدم الفلاتر في الأعلى لتضييق النطاق.'}</p>
      </div>
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
  `;

  // Click على top post → افتح detail modal بدون تبديل view
  pane.querySelectorAll('.top-post-row').forEach(row => {
    row.addEventListener('click', () => {
      const post = STATE.allPosts.find(p => p.post_id === row.dataset.postId && p.page_slug === row.dataset.postSlug);
      if (post) openPostDetailModal(post);
    });
  });
}

// ========= View switching (Posts | Analytics) =========

function switchView(view) {
  STATE.currentView = view;
  document.querySelectorAll('.view-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  document.querySelectorAll('.view-pane').forEach(p => {
    p.hidden = p.dataset.view !== view;
  });
  if (view === 'analytics') {
    renderAnalyticsView();
  }
  // حفظ في localStorage عشان الـ view يتذكّر
  try { localStorage.setItem('marsad_view', view); } catch {}
}

function bindViewTabs() {
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
  // Restore last view
  try {
    const saved = localStorage.getItem('marsad_view');
    if (saved === 'analytics') switchView('analytics');
  } catch {}
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
            ? `<p class="wizard-ok">✅ مفعّل: ${enabledSources.map(s => (s.icon || '🔌') + ' ' + (s.label || s.source_name || s.name)).join('، ')}</p>`
            : `
              <p>اختر مصدراً واحداً للبدء (نوصي بـ Playwright للتجربة):</p>
              <div class="wizard-sources">
                ${sourcesStatus.map(s => `
                  <button class="wizard-source" data-source="${s.source_name || s.name}">
                    <span class="source-icon">${s.icon || '🔌'}</span>
                    <div class="source-info">
                      <strong>${s.label || s.source_name || s.name}</strong>
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
        slug: slugify(name, url),
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
  try {
    const res = await fetch(`/api/sources/${sourceName}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ enabled: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function openSettingsModal() {
  // Load latest sources status
  await loadSourcesStatus();
  const sources = Array.isArray(STATE.sourcesStatus) ? STATE.sourcesStatus : [];

  openModal('⚙️ الإعدادات', `
    <div class="settings-modal">
      <div class="settings-tabs">
        <button class="settings-tab active" data-tab="sources">🔌 المصادر</button>
        <button class="settings-tab" data-tab="schedules">🕐 المجدول</button>
        <button class="settings-tab" data-tab="account">👤 الحساب</button>
        ${AUTH && AUTH.user && AUTH.user.role === 'admin' ? `
          <button class="settings-tab" data-tab="users">👥 المستخدمون</button>
        ` : ''}
      </div>

      <div id="settings-sources" class="settings-pane">
        ${renderSourcesSettings(sources)}
      </div>
      <div id="settings-schedules" class="settings-pane" hidden>
        <div class="loading"><div class="spinner"></div></div>
      </div>
      <div id="settings-account" class="settings-pane" hidden>
        ${renderAccountSettings()}
      </div>
      ${AUTH && AUTH.user && AUTH.user.role === 'admin' ? `
        <div id="settings-users" class="settings-pane" hidden>
          <div class="loading"><div class="spinner"></div></div>
        </div>
      ` : ''}
    </div>
  `, 'lg');

  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.settings-pane').forEach(p => p.hidden = true);
      document.getElementById(`settings-${tab.dataset.tab}`).hidden = false;
      if (tab.dataset.tab === 'users') loadUsersTab();
      if (tab.dataset.tab === 'schedules') loadSchedulesTab();
    });
  });

  bindSourceCards();
  bindAccountSettings();
}

// ========= Schedules =========

async function loadSchedulesTab() {
  const pane = document.getElementById('settings-schedules');
  if (!pane) return;
  pane.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const [schedRes, pagesRes] = await Promise.all([
      fetch('/api/schedules', { credentials: 'include' }),
      fetch('/api/pages', { credentials: 'include' }),
    ]);
    const schedules = schedRes.ok ? (await schedRes.json()).schedules || [] : [];
    const pages = pagesRes.ok ? (await pagesRes.json()).pages || [] : [];

    pane.innerHTML = renderSchedulesTab(schedules, pages);
    bindSchedulesTab(pages);
  } catch (e) {
    pane.innerHTML = `<p class="note">فشل: ${escapeHtml(e.message)}</p>`;
  }
}

function renderSchedulesTab(schedules, pages) {
  return `
    <div class="schedules-wrapper">
      <div class="settings-intro">
        <strong>🕐 جدولة تلقائية للسحب</strong>
        <br>أنشئ مهمة تشتغل تلقائياً كل فترة وتسحب المنشورات حسب الفترة اللي تحددها.
      </div>

      <button class="btn-trigger btn-full" id="addScheduleBtn">
        ➕ إضافة مهمة جديدة
      </button>

      <div id="scheduleFormWrap" hidden></div>

      <div class="schedules-list">
        ${schedules.length === 0
          ? `<div class="empty-state">
               <span class="empty-icon">🕐</span>
               <h4>لا توجد مهام مجدولة بعد</h4>
               <p>أنشئ مهمة لتشتغل تلقائياً - مثلاً "كل ساعة اسحب آخر يوم"</p>
             </div>`
          : schedules.map(s => renderScheduleRow(s, pages)).join('')
        }
      </div>
    </div>
  `;
}

function renderScheduleRow(s, pages) {
  const pagesLabel = !s.pages || s.pages.length === 0
    ? 'كل الصفحات'
    : s.pages.map(slug => {
        const p = pages.find(pp => pp.slug === slug);
        return p ? p.name : slug;
      }).join('، ');

  const intervalLabel = scheduleIntervalLabel(s.interval_minutes);
  const dateRangeLabel = scheduleDateRangeLabel(s.date_range_preset, s.custom_hours_back);
  const nextRun = s.next_run ? formatRelTime(s.next_run) : '—';
  const lastRun = s.last_run ? formatRelTime(s.last_run) : 'لم يتم';

  return `
    <div class="schedule-row ${s.enabled ? 'enabled' : 'disabled'}" data-id="${s.id}">
      <div class="schedule-head">
        <label class="switch">
          <input type="checkbox" class="schedule-toggle" ${s.enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
        <div class="schedule-info">
          <strong>${escapeHtml(s.name)}</strong>
          <div class="schedule-meta">
            <span>🔄 ${intervalLabel}</span>
            <span>📅 ${dateRangeLabel}</span>
            <span>📄 ${escapeHtml(pagesLabel)}</span>
          </div>
        </div>
        <div class="schedule-actions">
          <button class="btn-meta schedule-run-btn" title="شغّل الآن">▶</button>
          <button class="btn-meta schedule-edit-btn" title="تعديل">✏️</button>
          <button class="btn-meta danger schedule-delete-btn" title="حذف">🗑</button>
        </div>
      </div>
      <div class="schedule-stats">
        <span>التالي: <strong>${nextRun}</strong></span>
        <span>الأخير: <strong>${lastRun}</strong></span>
        <span>إجمالي التشغيلات: <strong>${s.total_runs || 0}</strong></span>
      </div>
    </div>
  `;
}

function scheduleIntervalLabel(minutes) {
  if (minutes < 60) return `كل ${minutes} دقيقة`;
  if (minutes === 60) return 'كل ساعة';
  if (minutes < 1440) return `كل ${Math.round(minutes / 60)} ساعة`;
  if (minutes === 1440) return 'كل يوم';
  if (minutes === 10080) return 'كل أسبوع';
  return `كل ${Math.round(minutes / 1440)} يوم`;
}

function scheduleDateRangeLabel(preset, custom) {
  const map = {
    last_1h: 'آخر ساعة',
    last_24h: 'آخر 24 ساعة',
    last_2d: 'آخر يومين',
    last_week: 'آخر أسبوع',
    last_month: 'آخر شهر',
  };
  if (preset === 'custom') return `آخر ${custom} ساعة`;
  return map[preset] || preset;
}

function bindSchedulesTab(pages) {
  const addBtn = document.getElementById('addScheduleBtn');
  const formWrap = document.getElementById('scheduleFormWrap');

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      formWrap.hidden = false;
      formWrap.innerHTML = renderScheduleForm(null, pages);
      bindScheduleForm(null, pages);
      formWrap.scrollIntoView({behavior: 'smooth', block: 'center'});
    });
  }

  // Edit buttons
  document.querySelectorAll('.schedule-edit-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.closest('.schedule-row').dataset.id;
      const res = await fetch('/api/schedules', {credentials: 'include'});
      const data = await res.json();
      const sched = (data.schedules || []).find(s => s.id == id);
      if (sched) {
        formWrap.hidden = false;
        formWrap.innerHTML = renderScheduleForm(sched, pages);
        bindScheduleForm(sched, pages);
        formWrap.scrollIntoView({behavior: 'smooth', block: 'center'});
      }
    });
  });

  // Toggle enabled
  document.querySelectorAll('.schedule-toggle').forEach(tog => {
    tog.addEventListener('change', async (e) => {
      e.stopPropagation();
      const id = tog.closest('.schedule-row').dataset.id;
      await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include',
        body: JSON.stringify({enabled: tog.checked}),
      });
      showToast(tog.checked ? '✅ تم التفعيل' : '⊘ تم الإيقاف', 'success');
    });
  });

  // Delete
  document.querySelectorAll('.schedule-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('حذف هذه المهمة المجدولة؟')) return;
      const id = btn.closest('.schedule-row').dataset.id;
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        showToast('✅ تم الحذف', 'success');
        loadSchedulesTab();
      }
    });
  });

  // Run now
  document.querySelectorAll('.schedule-run-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.closest('.schedule-row').dataset.id;
      btn.disabled = true;
      btn.textContent = '⏳';
      const res = await fetch(`/api/schedules/${id}/run-now`, {
        method: 'POST',
        credentials: 'include',
      });
      btn.disabled = false;
      btn.textContent = '▶';
      if (res.ok) {
        showToast('🚀 تم بدء التشغيل', 'success');
      } else {
        showToast('فشل التشغيل', 'error');
      }
    });
  });
}

function renderScheduleForm(sched, pages) {
  const s = sched || {};
  const selectedPages = s.pages || [];
  const allSelected = !selectedPages.length;

  return `
    <div class="schedule-form">
      <h4>${sched ? '✏️ تعديل مهمة' : '➕ مهمة جديدة'}</h4>

      <div class="form-field">
        <label>اسم المهمة <span class="req">*</span></label>
        <input type="text" id="schedName" class="input" value="${escapeHtml(s.name || '')}" placeholder="مثال: أخبار الجزيرة اليومية" required>
      </div>

      <div class="form-field">
        <label>التكرار (كل كم)</label>
        <select id="schedInterval" class="select">
          <option value="60" ${s.interval_minutes === 60 ? 'selected' : ''}>كل ساعة</option>
          <option value="180" ${s.interval_minutes === 180 ? 'selected' : ''}>كل 3 ساعات</option>
          <option value="360" ${s.interval_minutes === 360 || !s.interval_minutes ? 'selected' : ''}>كل 6 ساعات</option>
          <option value="720" ${s.interval_minutes === 720 ? 'selected' : ''}>كل 12 ساعة</option>
          <option value="1440" ${s.interval_minutes === 1440 ? 'selected' : ''}>كل يوم</option>
          <option value="10080" ${s.interval_minutes === 10080 ? 'selected' : ''}>كل أسبوع</option>
          <option value="custom">مخصّص...</option>
        </select>
        <input type="number" id="schedIntervalCustom" class="input" placeholder="مثلاً: 30 (دقيقة)" min="15" max="43200" hidden>
      </div>

      <div class="form-field">
        <label>نطاق المنشورات (اسحب المنشورات من ...)</label>
        <select id="schedDateRange" class="select">
          <option value="last_1h" ${s.date_range_preset === 'last_1h' ? 'selected' : ''}>آخر ساعة</option>
          <option value="last_24h" ${s.date_range_preset === 'last_24h' || !s.date_range_preset ? 'selected' : ''}>آخر 24 ساعة (يوم)</option>
          <option value="last_2d" ${s.date_range_preset === 'last_2d' ? 'selected' : ''}>آخر يومين</option>
          <option value="last_week" ${s.date_range_preset === 'last_week' ? 'selected' : ''}>آخر أسبوع</option>
          <option value="last_month" ${s.date_range_preset === 'last_month' ? 'selected' : ''}>آخر شهر</option>
          <option value="custom" ${s.date_range_preset === 'custom' ? 'selected' : ''}>مخصّص (ساعات)</option>
        </select>
        <input type="number" id="schedCustomHours" class="input" placeholder="كم ساعة للخلف؟ (مثلاً 72)" value="${s.custom_hours_back || 24}" min="1" max="8760" ${s.date_range_preset === 'custom' ? '' : 'hidden'}>
      </div>

      <div class="form-field">
        <label>الصفحات (اتركها فارغة لكل الصفحات)</label>
        <div class="schedule-pages-picker">
          <label class="checkbox-chip">
            <input type="checkbox" id="schedPagesAll" ${allSelected ? 'checked' : ''}>
            <span>كل الصفحات (${pages.length})</span>
          </label>
          <div id="schedPagesList" class="schedule-pages-list" ${allSelected ? 'hidden' : ''}>
            ${pages.map(p => `
              <label class="checkbox-chip">
                <input type="checkbox" class="schedule-page-check" value="${escapeHtml(p.slug)}" ${selectedPages.includes(p.slug) ? 'checked' : ''}>
                <span>${escapeHtml(p.name)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="form-field">
        <label>المصدر</label>
        <select id="schedSource" class="select">
          <option value="auto" ${(s.source || 'auto') === 'auto' ? 'selected' : ''}>تلقائي (حسب الأولوية)</option>
          ${(STATE.sourcesStatus || []).filter(x => x.enabled).map(x =>
            `<option value="${x.source_name}" ${s.source === x.source_name ? 'selected' : ''}>${x.icon} ${x.label}</option>`
          ).join('')}
        </select>
      </div>

      <div class="form-actions">
        <button type="button" class="btn-trigger" id="schedSaveBtn">${sched ? '💾 حفظ التغييرات' : '➕ إنشاء المهمة'}</button>
        <button type="button" class="btn-refresh" id="schedCancelBtn">إلغاء</button>
      </div>
      <p class="auth-msg error" id="schedError" hidden></p>
    </div>
  `;
}

function bindScheduleForm(sched, pages) {
  const wrap = document.getElementById('scheduleFormWrap');

  // Interval custom toggle
  const intervalSel = document.getElementById('schedInterval');
  const intervalCustom = document.getElementById('schedIntervalCustom');
  intervalSel.addEventListener('change', () => {
    intervalCustom.hidden = intervalSel.value !== 'custom';
  });

  // Date range custom toggle
  const dateRangeSel = document.getElementById('schedDateRange');
  const customHours = document.getElementById('schedCustomHours');
  dateRangeSel.addEventListener('change', () => {
    customHours.hidden = dateRangeSel.value !== 'custom';
  });

  // All pages toggle
  const allCheck = document.getElementById('schedPagesAll');
  const pagesList = document.getElementById('schedPagesList');
  allCheck.addEventListener('change', () => {
    pagesList.hidden = allCheck.checked;
  });

  // Save
  document.getElementById('schedSaveBtn').addEventListener('click', async () => {
    const errEl = document.getElementById('schedError');
    errEl.hidden = true;

    const name = document.getElementById('schedName').value.trim();
    if (!name) {
      errEl.textContent = 'الاسم مطلوب';
      errEl.hidden = false;
      return;
    }

    let intervalMinutes;
    if (intervalSel.value === 'custom') {
      intervalMinutes = parseInt(intervalCustom.value) || 60;
    } else {
      intervalMinutes = parseInt(intervalSel.value);
    }
    if (intervalMinutes < 15) intervalMinutes = 15;

    const allSelected = allCheck.checked;
    const selectedPages = allSelected ? [] :
      Array.from(document.querySelectorAll('.schedule-page-check:checked')).map(c => c.value);

    const body = {
      name,
      enabled: sched ? sched.enabled : true,
      interval_minutes: intervalMinutes,
      date_range_preset: dateRangeSel.value,
      custom_hours_back: parseInt(customHours.value) || 24,
      pages: selectedPages,
      source: document.getElementById('schedSource').value,
    };

    const method = sched ? 'PATCH' : 'POST';
    const url = sched ? `/api/schedules/${sched.id}` : '/api/schedules';

    try {
      const res = await fetch(url, {
        method,
        headers: {'Content-Type': 'application/json'},
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || 'فشل';
        errEl.hidden = false;
        return;
      }
      showToast(sched ? '✅ تم الحفظ' : '✅ تم إنشاء المهمة', 'success');
      loadSchedulesTab();
    } catch (e) {
      errEl.textContent = 'خطأ: ' + e.message;
      errEl.hidden = false;
    }
  });

  // Cancel
  document.getElementById('schedCancelBtn').addEventListener('click', () => {
    wrap.hidden = true;
    wrap.innerHTML = '';
  });
}

function renderSourcesSettings(sources) {
  const sorted = [...sources].sort((a, b) => (a.priority || 99) - (b.priority || 99));
  return `
    <div class="sources-settings">
      <p class="settings-intro">
        فعّل مصدراً واحداً على الأقل لسحب المنشورات.
        <br><strong>💡 نصيحة:</strong> اسحب البطاقات لإعادة ترتيب الأولوية. الأولى في القائمة = الأعلى أولوية.
      </p>
      <div class="sources-list" id="sourcesList">
        ${sorted.map((s, idx) => renderSourceCard(s, idx + 1)).join('')}
      </div>
    </div>
  `;
}

function renderSourceCard(s, priorityIndex) {
  const cPanelOk = s.source_name !== 'playwright';
  const prio = priorityIndex ?? s.priority;
  return `
    <div class="source-config-card ${s.enabled ? 'enabled' : 'disabled'}" data-source="${s.source_name}" draggable="true">
      <div class="source-config-head" role="button" tabindex="0">
        <div class="source-drag-handle" title="اسحب لإعادة الترتيب">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/>
            <circle cx="15" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
          </svg>
        </div>
        <span class="source-priority-badge">${prio}</span>
        <div class="source-config-info">
          <span class="source-icon-lg">${s.icon}</span>
          <div class="source-config-text">
            <strong>${s.label}</strong>
            <span class="source-price">${s.price}</span>
            <p class="source-desc">${s.description}</p>
          </div>
        </div>
        <label class="switch" onclick="event.stopPropagation()">
          <input type="checkbox" class="source-toggle" ${s.enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
        <button class="source-collapse-btn" type="button" aria-label="توسيع/طي التفاصيل">
          <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>

      ${!cPanelOk ? `
        <div class="alert alert-warn source-warn-banner">
          ⚠️ Playwright لا يعمل على cPanel (يحتاج Chromium). للإنتاج استخدم Apify أو FetchRSS.
        </div>
      ` : ''}

      <div class="source-config-body" hidden>
        ${s.needs_token ? `
          <div class="form-field">
            <label>${s.token_label}</label>
            <div class="token-input-row">
              <input type="password" class="input source-token-input" placeholder="${s.has_token ? '••••••••••• (محفوظ)' : 'الصق هنا'}" dir="ltr">
              <button class="btn-trigger btn-sm source-save-token" type="button">حفظ</button>
            </div>
            <span class="field-help">${s.token_help}</span>
            ${s.signup_url ? `<div class="source-help-links">
              <a href="${s.signup_url}" target="_blank" rel="noopener">➤ إنشاء حساب</a>
              ${s.token_url ? `<a href="${s.token_url}" target="_blank" rel="noopener">➤ الحصول على Token</a>` : ''}
            </div>` : ''}
          </div>
        ` : `
          <div class="info-box">
            ℹ️ ${s.token_help}
            ${s.signup_url ? `<br><a href="${s.signup_url}" target="_blank" rel="noopener">➤ فتح ${s.label}</a>` : ''}
          </div>
        `}

        ${s.source_name === 'apify' ? renderApifyExtraConfig(s) : ''}
      </div>
    </div>
  `;
}

function renderApifyExtraConfig(s) {
  return `
    <div class="form-field source-extra-config">
      <label>Actor ID</label>
      <div class="locked-value">
        <span class="lock-icon">🔒</span>
        <code>curious_coder/facebook-post-scraper</code>
      </div>
      <span class="field-help">
        الـ actor مقفول على <code>curious_coder/facebook-post-scraper</code> ولا يمكن تغييره.
        <a href="https://apify.com/curious_coder/facebook-post-scraper" target="_blank" rel="noopener">صفحة الـ Actor على Apify ↗</a>
      </span>
    </div>
  `;
}

function bindSourceCards() {
  const list = document.getElementById('sourcesList');
  if (!list) return;

  // === Toggle enabled (switch) ===
  list.querySelectorAll('.source-toggle').forEach(toggle => {
    toggle.addEventListener('change', async (e) => {
      e.stopPropagation();
      const card = toggle.closest('.source-config-card');
      const sourceName = card.dataset.source;
      card.classList.toggle('enabled', toggle.checked);
      card.classList.toggle('disabled', !toggle.checked);

      const res = await fetch(`/api/sources/${sourceName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled: toggle.checked }),
      });
      if (res.ok) {
        showToast(toggle.checked ? `✅ ${sourceName} مفعّل` : `⊘ ${sourceName} معطّل`, 'success');
      }
    });
  });

  // === Save token ===
  list.querySelectorAll('.source-save-token').forEach(saveBtn => {
    saveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const card = saveBtn.closest('.source-config-card');
      const sourceName = card.dataset.source;
      const tokenInput = card.querySelector('.source-token-input');
      const token = tokenInput.value.trim();
      if (!token) {
        showToast('الصق التوكن أولاً', 'error');
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳';
      try {
        const res = await fetch(`/api/sources/${sourceName}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          tokenInput.value = '';
          tokenInput.placeholder = '••••••••••• (محفوظ)';
          showToast('✅ تم حفظ التوكن', 'success');
        } else {
          showToast('فشل الحفظ', 'error');
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, 'error');
      }
      saveBtn.disabled = false;
      saveBtn.textContent = 'حفظ';
    });
  });

  // Apify actor_id مقفول في الكود - لا يمكن تغييره من الـ UI

  // === Collapse/Expand toggle ===
  list.querySelectorAll('.source-config-card').forEach(card => {
    const head = card.querySelector('.source-config-head');
    const body = card.querySelector('.source-config-body');
    const chev = card.querySelector('.chev');

    const toggleCollapse = (e) => {
      // Don't toggle if user clicked the switch or drag handle
      if (e.target.closest('.switch') || e.target.closest('.source-drag-handle')) return;
      const isOpen = !body.hidden;
      body.hidden = isOpen;
      card.classList.toggle('expanded', !isOpen);
      if (chev) chev.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
    };

    head.addEventListener('click', toggleCollapse);
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCollapse(e);
      }
    });
  });

  // === Drag and drop reordering ===
  let draggedEl = null;

  list.querySelectorAll('.source-config-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedEl = card;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.source);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      list.querySelectorAll('.source-config-card').forEach(c => c.classList.remove('drag-over'));
      draggedEl = null;
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedEl && card !== draggedEl) {
        card.classList.add('drag-over');
      }
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (!draggedEl || draggedEl === card) return;

      // Reorder in DOM
      const rect = card.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      if (after) {
        card.insertAdjacentElement('afterend', draggedEl);
      } else {
        card.insertAdjacentElement('beforebegin', draggedEl);
      }

      await saveSourcesPriority();
    });
  });
}

async function saveSourcesPriority() {
  const list = document.getElementById('sourcesList');
  if (!list) return;
  const cards = Array.from(list.querySelectorAll('.source-config-card'));

  // Update priority badges
  cards.forEach((card, idx) => {
    const badge = card.querySelector('.source-priority-badge');
    if (badge) badge.textContent = idx + 1;
  });

  // Persist priorities (sequential, starting from 1)
  const updates = cards.map((card, idx) => ({
    name: card.dataset.source,
    priority: idx + 1,
  }));

  try {
    await Promise.all(updates.map(u =>
      fetch(`/api/sources/${u.name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ priority: u.priority }),
      })
    ));
    showToast('✅ تم تحديث الأولوية', 'success');
  } catch (e) {
    showToast('فشل حفظ الترتيب', 'error');
  }
}

function renderAccountSettings() {
  const u = AUTH ? AUTH.user : null;
  if (!u) return '';
  return `
    <div class="account-settings">
      <h3>المعلومات الشخصية</h3>
      <form id="profileForm" class="profile-form">
        <div class="form-field">
          <label>اسم المستخدم</label>
          <input type="text" id="profUsername" class="input" value="${escapeHtml(u.username)}" readonly disabled>
          <span class="field-help">لا يمكن تغيير اسم المستخدم</span>
        </div>
        <div class="form-field">
          <label>الاسم المعروض</label>
          <input type="text" id="profDisplayName" class="input" value="${escapeHtml(u.display_name || '')}" placeholder="اسمك الكامل">
        </div>
        <div class="form-field">
          <label>البريد الإلكتروني</label>
          <input type="email" id="profEmail" class="input" value="${escapeHtml(u.email || '')}" placeholder="you@example.com" dir="ltr">
        </div>
        <div class="form-field">
          <label>الدور</label>
          <input type="text" class="input" value="${u.role === 'admin' ? '👑 مشرف' : 'مستخدم'}" readonly disabled>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-trigger">💾 حفظ التغييرات</button>
        </div>
        <p class="auth-msg success" id="profSuccess" hidden></p>
        <p class="auth-msg error" id="profError" hidden></p>
      </form>

      <h3>تغيير كلمة السر</h3>
      <form id="changePasswordForm" class="profile-form">
        <div class="form-field">
          <label>كلمة السر الحالية</label>
          <input type="password" id="currentPass" class="input" required>
        </div>
        <div class="form-field">
          <label>كلمة السر الجديدة (6+ أحرف)</label>
          <input type="password" id="newPass" class="input" required minlength="6">
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-trigger">🔐 تغيير كلمة السر</button>
        </div>
        <p class="auth-msg error" id="passError" hidden></p>
      </form>
    </div>
  `;
}

function bindAccountSettings() {
  // Profile update
  const profForm = document.getElementById('profileForm');
  if (profForm) {
    profForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('profError');
      const okEl = document.getElementById('profSuccess');
      errEl.hidden = true;
      okEl.hidden = true;

      const displayName = document.getElementById('profDisplayName').value.trim();
      const email = document.getElementById('profEmail').value.trim();

      const btn = profForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = '⏳ جاري الحفظ…';

      try {
        const res = await fetch('/api/auth/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ display_name: displayName, email }),
        });
        const data = await res.json();
        if (!res.ok) {
          errEl.textContent = data.error || 'فشل الحفظ';
          errEl.hidden = false;
        } else {
          AUTH.user = data.user || AUTH.user;
          renderUserMenu();
          okEl.textContent = '✅ تم حفظ التغييرات';
          okEl.hidden = false;
          showToast('✅ تم حفظ البيانات', 'success');
        }
      } catch (e) {
        errEl.textContent = 'خطأ: ' + e.message;
        errEl.hidden = false;
      }
      btn.disabled = false;
      btn.textContent = '💾 حفظ التغييرات';
    });
  }

  // Change password
  const passForm = document.getElementById('changePasswordForm');
  if (passForm) {
    passForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('passError');
      errEl.hidden = true;
      const current = document.getElementById('currentPass').value;
      const newPass = document.getElementById('newPass').value;

      const btn = passForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = '⏳ جاري التغيير…';

      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ current_password: current, new_password: newPass }),
        });
        if (res.ok) {
          showToast('✅ تم تغيير كلمة السر', 'success');
          passForm.reset();
        } else {
          const d = await res.json();
          errEl.textContent = d.error || 'فشل';
          errEl.hidden = false;
        }
      } catch (err) {
        errEl.textContent = 'خطأ: ' + err.message;
        errEl.hidden = false;
      }
      btn.disabled = false;
      btn.textContent = '🔐 تغيير كلمة السر';
    });
  }
}

async function loadUsersTab(forceReload = false) {
  const pane = document.getElementById('settings-users');
  if (!pane) return;
  if (!forceReload && pane.dataset.loaded === '1') return;
  pane.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const res = await fetch('/api/admin/users', { credentials: 'include' });
    if (!res.ok) {
      pane.innerHTML = '<p class="note">فشل التحميل</p>';
      return;
    }
    const data = await res.json();
    const me = (window.AUTH && window.AUTH.user) ? window.AUTH.user : {};
    pane.innerHTML = renderUsersTab(data.users || [], me);
    pane.dataset.loaded = '1';
    bindUsersTab();
  } catch (e) {
    pane.innerHTML = `<p class="note">خطأ: ${escapeHtml(e.message)}</p>`;
  }
}

function renderUsersTab(users, me) {
  return `
    <div class="users-list">
      <div class="users-header">
        <h3>إدارة المستخدمين <span class="count-badge">${users.length}</span></h3>
        <button class="btn-trigger btn-sm" id="btnAddUser" type="button">➕ مستخدم جديد</button>
      </div>

      <div id="addUserFormWrap" hidden>${renderAddUserForm()}</div>

      <div class="users-table">
        ${users.length === 0
          ? '<p class="note">لا يوجد مستخدمون بعد.</p>'
          : users.map(u => renderUserRow(u, me)).join('')
        }
      </div>
    </div>
  `;
}

function renderAddUserForm() {
  return `
    <form class="user-add-form card-soft" id="addUserForm">
      <h4>➕ إضافة مستخدم جديد</h4>
      <div class="form-grid">
        <div class="form-field">
          <label>اسم المستخدم *</label>
          <input type="text" class="input" name="username" required minlength="3" maxlength="40" dir="ltr" placeholder="username">
        </div>
        <div class="form-field">
          <label>كلمة السر *</label>
          <input type="password" class="input" name="password" required minlength="6" dir="ltr" placeholder="••••••">
        </div>
        <div class="form-field">
          <label>الاسم الظاهر</label>
          <input type="text" class="input" name="display_name" maxlength="100" placeholder="اسم المستخدم الكامل">
        </div>
        <div class="form-field">
          <label>البريد الإلكتروني</label>
          <input type="email" class="input" name="email" dir="ltr" placeholder="user@example.com">
        </div>
        <div class="form-field">
          <label>الدور</label>
          <select class="select" name="role">
            <option value="user">👤 مستخدم</option>
            <option value="admin">👑 مشرف</option>
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn-refresh" id="cancelAddUser">إلغاء</button>
        <button type="submit" class="btn-trigger">💾 إنشاء</button>
      </div>
    </form>
  `;
}

function renderUserRow(u, me) {
  const isSelf = me && me.id === u.id;
  const isAdmin = u.role === 'admin';
  const active = u.is_active !== 0 && u.is_active !== false;
  return `
    <div class="user-row" data-uid="${u.id}">
      <div class="user-row-info">
        <div class="user-avatar-sm">${escapeHtml(String(u.display_name || u.username || '?').trim().slice(0,1))}</div>
        <div>
          <strong>${escapeHtml(u.display_name || u.username)}</strong>
          <div class="user-sub">
            <span>@${escapeHtml(u.username)}</span>
            ${u.email ? `<span>· ${escapeHtml(u.email)}</span>` : ''}
          </div>
        </div>
        <span class="user-role ${isAdmin ? 'admin' : ''}">${isAdmin ? '👑 مشرف' : 'مستخدم'}</span>
        ${!active ? '<span class="user-role disabled">معطّل</span>' : ''}
        ${isSelf ? '<span class="user-role self">أنت</span>' : ''}
      </div>
      <div class="user-row-meta">
        <span>${u.last_login ? 'آخر دخول: ' + formatRelTime(u.last_login) : 'لم يدخل بعد'}</span>
      </div>
      <div class="user-row-actions">
        <button class="btn-refresh btn-sm" data-action="edit" title="تعديل المستخدم">✏️ تعديل</button>
        <button class="btn-refresh btn-sm" data-action="reset-pass" title="إعادة تعيين كلمة السر">🔐 كلمة سر</button>
        <button class="btn-refresh btn-sm" data-action="toggle-role" title="${isAdmin ? 'إزالة صلاحية المشرف' : 'ترقية إلى مشرف'}" ${isSelf ? 'disabled' : ''}>${isAdmin ? '⬇️ إزالة إشراف' : '⬆️ ترقية'}</button>
        <button class="btn-refresh btn-sm" data-action="toggle-active" title="${active ? 'تعطيل الحساب' : 'تفعيل الحساب'}" ${isSelf ? 'disabled' : ''}>${active ? '⏸️ تعطيل' : '▶️ تفعيل'}</button>
        <button class="btn-refresh btn-sm btn-danger" data-action="delete" title="حذف المستخدم" ${isSelf ? 'disabled' : ''}>🗑️ حذف</button>
      </div>
    </div>
  `;
}

function bindUsersTab() {
  // Add user toggle
  const btnAdd = document.getElementById('btnAddUser');
  const wrap = document.getElementById('addUserFormWrap');
  if (btnAdd && wrap) {
    btnAdd.addEventListener('click', () => {
      wrap.hidden = !wrap.hidden;
      if (!wrap.hidden) {
        wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const first = wrap.querySelector('input[name="username"]');
        if (first) setTimeout(() => first.focus(), 100);
      }
    });
  }

  const cancelAdd = document.getElementById('cancelAddUser');
  if (cancelAdd) cancelAdd.addEventListener('click', () => { wrap.hidden = true; });

  // Add user form submit
  const addForm = document.getElementById('addUserForm');
  if (addForm) {
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(addForm);
      const body = {
        username: (fd.get('username') || '').toString().trim(),
        password: (fd.get('password') || '').toString(),
        display_name: (fd.get('display_name') || '').toString().trim() || null,
        email: (fd.get('email') || '').toString().trim() || null,
        role: (fd.get('role') || 'user').toString(),
      };
      const submitBtn = addForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'جاري الإنشاء...';
      try {
        const r = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body)
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          showToast(j.error || 'فشل الإنشاء', 'error');
          return;
        }
        showToast('تم إنشاء المستخدم ✓', 'success');
        await loadUsersTab(true);
      } catch (err) {
        showToast('خطأ: ' + err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 إنشاء';
      }
    });
  }

  // Row actions (event delegation)
  const pane = document.getElementById('settings-users');
  if (!pane) return;
  pane.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('.user-row');
    if (!row) return;
    const uid = parseInt(row.dataset.uid, 10);
    const action = btn.dataset.action;
    const nameEl = row.querySelector('strong');
    const uname = nameEl ? nameEl.textContent : `#${uid}`;

    if (action === 'delete') {
      if (!confirm(`حذف المستخدم "${uname}"؟ لا يمكن التراجع.`)) return;
      await apiAdminUser('DELETE', uid);
    }
    else if (action === 'reset-pass') {
      const pw = prompt(`كلمة سر جديدة للمستخدم "${uname}" (6 أحرف على الأقل):`);
      if (!pw) return;
      if (pw.length < 6) { showToast('كلمة السر قصيرة', 'error'); return; }
      await apiAdminUser('PATCH', uid, { password: pw }, 'تم تحديث كلمة السر');
    }
    else if (action === 'toggle-role') {
      const isAdminNow = row.querySelector('.user-role.admin');
      const newRole = isAdminNow ? 'user' : 'admin';
      const label = newRole === 'admin' ? 'ترقية إلى مشرف' : 'إزالة صلاحية المشرف';
      if (!confirm(`${label} للمستخدم "${uname}"؟`)) return;
      await apiAdminUser('PATCH', uid, { role: newRole }, 'تم تحديث الدور');
    }
    else if (action === 'toggle-active') {
      const disabled = !!row.querySelector('.user-role.disabled');
      await apiAdminUser('PATCH', uid, { is_active: disabled }, disabled ? 'تم تفعيل الحساب' : 'تم تعطيل الحساب');
    }
    else if (action === 'edit') {
      openEditUserModal(uid, row);
    }
  });
}

async function apiAdminUser(method, uid, body = null, okMsg = 'تم') {
  try {
    const opts = { method, credentials: 'include' };
    if (body) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(`/api/admin/users/${uid}`, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      showToast(j.error || 'فشل التحديث', 'error');
      return false;
    }
    showToast(okMsg, 'success');
    await loadUsersTab(true);
    return true;
  } catch (e) {
    showToast('خطأ: ' + e.message, 'error');
    return false;
  }
}

function openEditUserModal(uid, row) {
  const name = row.querySelector('strong')?.textContent || '';
  const subSpans = row.querySelectorAll('.user-sub span');
  const username = (subSpans[0]?.textContent || '').replace(/^@/, '');
  const email = (subSpans[1]?.textContent || '').replace(/^·\s*/, '');

  openModal(`✏️ تعديل المستخدم @${username}`, `
    <form id="editUserForm" class="user-add-form">
      <div class="form-field">
        <label>الاسم الظاهر</label>
        <input type="text" class="input" name="display_name" value="${escapeHtml(name)}" maxlength="100">
      </div>
      <div class="form-field">
        <label>البريد الإلكتروني</label>
        <input type="email" class="input" name="email" value="${escapeHtml(email)}" dir="ltr">
      </div>
      <div class="form-actions">
        <button type="button" class="btn-refresh" id="cancelEditUser">إلغاء</button>
        <button type="submit" class="btn-trigger">💾 حفظ</button>
      </div>
    </form>
  `, 'sm');

  document.getElementById('cancelEditUser')?.addEventListener('click', closeModal);
  document.getElementById('editUserForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      display_name: (fd.get('display_name') || '').toString().trim(),
      email: (fd.get('email') || '').toString().trim() || null,
    };
    const ok = await apiAdminUser('PATCH', uid, body, 'تم حفظ التعديلات ✓');
    if (ok) closeModal();
  });
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
  els.managePagesBtn.addEventListener('click', openPagesModal);
  els.historyBtn.addEventListener('click', openHistoryModal);
  if (els.analyticsBtn) els.analyticsBtn.addEventListener('click', openAnalyticsModal);
  if (els.settingsBtn) els.settingsBtn.addEventListener('click', openSettingsModal);

  // User menu
  const userBtn = document.getElementById('userBtn');
  const userDropdown = document.getElementById('userDropdown');
  if (userBtn && userDropdown) {
    userBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.hidden = !userDropdown.hidden;
    });
    document.addEventListener('click', () => {
      userDropdown.hidden = true;
    });
  }
  const menuLogout = document.getElementById('menuLogout');
  if (menuLogout) {
    menuLogout.addEventListener('click', () => {
      if (confirm('تسجيل الخروج؟')) {
        if (typeof logout === 'function') logout();
      }
    });
  }
  const menuChangePass = document.getElementById('menuChangePass');
  if (menuChangePass) {
    menuChangePass.addEventListener('click', () => {
      openSettingsModal();
      setTimeout(() => {
        const accountTab = document.querySelector('[data-tab="account"]');
        if (accountTab) accountTab.click();
      }, 200);
    });
  }
  const menuManageUsers = document.getElementById('menuManageUsers');
  if (menuManageUsers) {
    menuManageUsers.addEventListener('click', () => {
      openSettingsModal();
      setTimeout(() => {
        const usersTab = document.querySelector('[data-tab="users"]');
        if (usersTab) usersTab.click();
      }, 200);
    });
  }

  // Modal — يُغلق فقط بزر × أو Escape، النقر خارجه لا يغلقه
  els.modalClose.addEventListener('click', closeModal);
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

// ========= NOTE: init() now called from auth.js after successful auth =========
// init() auto-runs when auth.js finishes bootstrap.
