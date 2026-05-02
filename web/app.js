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
  // Multi-select filter selections (Set of values - empty = all)
  multiSelect: {
    page:     new Set(),
    source:   new Set(),
    postType: new Set(),
  },
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
  // filters (single-value)
  sortFilter: document.getElementById('sortFilter'),
  searchInput: document.getElementById('searchInput'),
  dateFrom: document.getElementById('dateFrom'),
  dateTo: document.getElementById('dateTo'),
  minReactions: document.getElementById('minReactions'),
  maxReactions: document.getElementById('maxReactions'),
  minComments: document.getElementById('minComments'),
  // quick filters (الموجودون داخل multiselect "quick")
  hasImageOnly: document.getElementById('hasImageOnly'),
  hasVideoOnly: document.getElementById('hasVideoOnly'),
  textOnly: document.getElementById('textOnly'),
  highEngagementOnly: document.getElementById('highEngagementOnly'),
  lowEngagementOnly: document.getElementById('lowEngagementOnly'),
  hasCommentsOnly: document.getElementById('hasCommentsOnly'),
  resetFilters: document.getElementById('resetFilters'),
  // results
  postsGrid: document.getElementById('postsGrid'),
  resultCount: document.getElementById('resultCount'),
  activeFiltersBadge: document.getElementById('activeFiltersBadge'),
  // buttons
  refreshBtn: document.getElementById('refreshBtn'),
  triggerBtn: document.getElementById('triggerBtn'),
  exportBtn: document.getElementById('exportBtn'),
  // (historyBtn / settingsBtn / managePagesBtn / analyticsBtn moved to user menu)
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

  // Check if admin is impersonating another user
  checkImpersonationBanner();

  await loadIndex();
  await loadPagesConfig();   // يجب قبل loadAllPages عشان populate multiselect صح
  await loadAllPages();
  await loadSourcesStatus();
  await loadHistory();

  setDefaultDateRange();
  restoreFilters();

  // restore pagination prefs
  try {
    const pp = parseInt(localStorage.getItem('marsad_per_page'));
    if (pp >= 12 && pp <= 200) STATE.perPage = pp;
  } catch {}

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
  // الفلاتر تبدأ فاضية افتراضياً — المستخدم يطبّق فلتر إذا أراد
  // (سلوك سابق كان يعبي آخر 24 ساعة تلقائياً مما خفّى المنشورات الأقدم)
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
      _refreshPageFilterList();
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
      _refreshPageFilterList();
      return;
    }
  } catch {}

  // 3) From index.json fallback
  STATE.pagesConfig = (STATE.index?.pages || []).map(p => ({
    slug: p.slug, name: p.name, url: p.url,
    max_posts: 30, source: 'auto', enabled: true,
  }));
  _refreshPageFilterList();
}

function _refreshPageFilterList() {
  // قد يكون الـ DOM لسا مش جاهز لما يُستدعى من loadPagesConfig في init
  // لذلك نتحقق ونتجاهل بأمان لو العنصر مش موجود.
  const list = document.getElementById('pageFilterList');
  if (list) {
    populatePageFilterMultiselect();
    syncMultiselectCheckboxesFromState();
  }
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
  // page filter is now a multiselect — populated from STATE.pagesConfig
  // (which has more info than STATE.index.pages: city, max_posts, etc).
  // This is called whenever pages list changes (after a scrape, etc).
  populatePageFilterMultiselect();
  // re-apply STATE selection to the freshly-populated checkboxes
  syncMultiselectCheckboxesFromState();
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

  // Multi-select: pages
  if (STATE.multiSelect.page.size > 0) {
    posts = posts.filter(p => STATE.multiSelect.page.has(p.page_slug));
    activeFilters++;
  }

  // Multi-select: sources
  if (STATE.multiSelect.source.size > 0) {
    posts = posts.filter(p => STATE.multiSelect.source.has(p.source));
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

  const maxReact = parseInt(els.maxReactions?.value) || 0;
  if (maxReact > 0) {
    posts = posts.filter(p => (p.reactions || 0) <= maxReact);
    activeFilters++;
  }

  const minComm = parseInt(els.minComments.value) || 0;
  if (minComm > 0) {
    posts = posts.filter(p => (p.comments || 0) >= minComm);
    activeFilters++;
  }

  // Multi-select: post types
  if (STATE.multiSelect.postType.size > 0) {
    posts = posts.filter(p => STATE.multiSelect.postType.has(p.post_type || 'text'));
    activeFilters++;
  }

  if (els.hasImageOnly?.checked) {
    posts = posts.filter(p => !!p.image_url || (p.media || []).some(m => m.type === 'image'));
    activeFilters++;
  }

  if (els.hasVideoOnly?.checked) {
    posts = posts.filter(p => !!p.video_url || (p.media || []).some(m => m.type === 'video'));
    activeFilters++;
  }

  if (els.textOnly?.checked) {
    posts = posts.filter(p => !p.image_url && !p.video_url && (p.media || []).length === 0);
    activeFilters++;
  }

  if (els.highEngagementOnly?.checked) {
    posts = posts.filter(p => (p.reactions || 0) >= 1000);
    activeFilters++;
  }

  if (els.lowEngagementOnly?.checked) {
    posts = posts.filter(p => (p.reactions || 0) < 50);
    activeFilters++;
  }

  if (els.hasCommentsOnly?.checked) {
    posts = posts.filter(p => (p.comments || 0) > 0);
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

  // أظهر زر "مسح الفلاتر" فقط عند وجود فلاتر نشطة
  if (els.resetFilters) {
    els.resetFilters.hidden = activeFilters === 0;
  }

  saveFilters();
  // إعادة تعيين رقم الصفحة عند تغيير الفلاتر (يبدأ من 1)
  STATE.currentPage = 1;
  updateStats();   // refresh the top stat cards to reflect the filtered subset
  renderPosts();
  // لو المستخدم في analytics view → جدّد الإحصائيات أيضاً
  if (STATE.currentView === 'analytics') renderAnalyticsView();
}

function saveFilters() {
  try {
    localStorage.setItem(LS.filters, JSON.stringify({
      pages: Array.from(STATE.multiSelect.page),
      sources: Array.from(STATE.multiSelect.source),
      postTypes: Array.from(STATE.multiSelect.postType),
      sort: els.sortFilter.value,
      search: els.searchInput.value,
      dateFrom: els.dateFrom.value,
      dateTo: els.dateTo.value,
      minReactions: els.minReactions.value,
      maxReactions: els.maxReactions?.value || '',
      minComments: els.minComments.value,
      hasImageOnly: !!els.hasImageOnly?.checked,
      hasVideoOnly: !!els.hasVideoOnly?.checked,
      textOnly: !!els.textOnly?.checked,
      highEngagementOnly: !!els.highEngagementOnly?.checked,
      lowEngagementOnly: !!els.lowEngagementOnly?.checked,
      hasCommentsOnly: !!els.hasCommentsOnly?.checked,
    }));
  } catch {}
}

function restoreFilters() {
  try {
    const saved = localStorage.getItem(LS.filters);
    if (!saved) return;
    const f = JSON.parse(saved);

    // Multi-select restoration: STATE + checkbox restoration done after DOM ready
    if (Array.isArray(f.pages))     STATE.multiSelect.page     = new Set(f.pages);
    if (Array.isArray(f.sources))   STATE.multiSelect.source   = new Set(f.sources);
    if (Array.isArray(f.postTypes)) STATE.multiSelect.postType = new Set(f.postTypes);

    if (f.sort) els.sortFilter.value = f.sort;
    if (f.search) els.searchInput.value = f.search;
    if (f.dateFrom) els.dateFrom.value = f.dateFrom;
    if (f.dateTo) els.dateTo.value = f.dateTo;
    if (f.minReactions) els.minReactions.value = f.minReactions;
    if (f.maxReactions && els.maxReactions) els.maxReactions.value = f.maxReactions;
    if (f.minComments) els.minComments.value = f.minComments;
    if (f.hasImageOnly && els.hasImageOnly) els.hasImageOnly.checked = true;
    if (f.hasVideoOnly && els.hasVideoOnly) els.hasVideoOnly.checked = true;
    if (f.textOnly && els.textOnly) els.textOnly.checked = true;
    if (f.highEngagementOnly && els.highEngagementOnly) els.highEngagementOnly.checked = true;
    if (f.lowEngagementOnly && els.lowEngagementOnly) els.lowEngagementOnly.checked = true;
    if (f.hasCommentsOnly && els.hasCommentsOnly) els.hasCommentsOnly.checked = true;
  } catch {}
}

/**
 * يعكس قيم STATE.multiSelect على الـ checkboxes في الـ DOM.
 * يُستدعى بعد setupMultiselects() أو populatePageFilterMultiselect().
 */
function syncMultiselectCheckboxesFromState() {
  document.querySelectorAll('.multiselect').forEach(ms => {
    const filterId = ms.dataset.filter;
    if (!filterId || filterId === 'quick') return;   // quick filters use els.* directly
    const set = STATE.multiSelect[filterId];
    if (!set) return;
    ms.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = set.has(cb.value);
    });
    updateMultiselectLabel(ms);
  });
  // أيضاً sync labels لـ quick filters
  document.querySelectorAll('.multiselect[data-filter="quick"]').forEach(ms => updateMultiselectLabel(ms));
}

function resetAllFilters() {
  // Clear multi-selects
  STATE.multiSelect.page.clear();
  STATE.multiSelect.source.clear();
  STATE.multiSelect.postType.clear();
  document.querySelectorAll('.multiselect input[type="checkbox"]').forEach(cb => cb.checked = false);
  document.querySelectorAll('.multiselect').forEach(ms => updateMultiselectLabel(ms));

  els.sortFilter.value = 'newest';
  els.searchInput.value = '';
  els.minReactions.value = '';
  if (els.maxReactions) els.maxReactions.value = '';
  els.minComments.value = '';
  // checkboxes inside quick-filters multiselect get reset by the loop above
  els.dateFrom.value = '';
  els.dateTo.value = '';
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

// ==================== Multiselect dropdown component ====================

/**
 * يبني عناصر القائمة لفلتر الصفحة من STATE.pagesConfig (يُستدعى بعد التحميل).
 */
function populatePageFilterMultiselect() {
  const list = document.getElementById('pageFilterList');
  if (!list) return;
  list.innerHTML = STATE.pagesConfig.map(p => `
    <label class="ms-item" data-search="${escapeHtml(((p.name || '') + ' ' + (p.url || '') + ' ' + (p.city || '')).toLowerCase())}">
      <input type="checkbox" value="${escapeHtml(p.slug)}">
      <span>${escapeHtml(p.name || p.slug)}</span>
      ${p.city ? `<small class="ms-item-meta">${escapeHtml(p.city)}</small>` : ''}
    </label>
  `).join('');
  // أعد ربط بعد إعادة الـ render
  bindMultiselectInputs(document.querySelector('.multiselect[data-filter="page"]'));
}

function setupMultiselects() {
  document.querySelectorAll('.multiselect').forEach(ms => {
    const trigger = ms.querySelector('.multiselect-trigger');
    const dropdown = ms.querySelector('.multiselect-dropdown');
    const search = ms.querySelector('.multiselect-search');
    const selectAllBtn = ms.querySelector('.ms-select-all');
    const clearBtn = ms.querySelector('.ms-clear');
    const filterId = ms.dataset.filter;

    // toggle dropdown
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      // close others
      document.querySelectorAll('.multiselect-dropdown').forEach(d => {
        if (d !== dropdown) d.hidden = true;
      });
      document.querySelectorAll('.multiselect.open').forEach(o => {
        if (o !== ms) o.classList.remove('open');
      });
      const opening = dropdown.hidden;
      dropdown.hidden = !dropdown.hidden;
      ms.classList.toggle('open', opening);
      if (opening && search) setTimeout(() => search.focus(), 50);
    });

    // search
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        ms.querySelectorAll('.ms-item').forEach(item => {
          const blob = item.dataset.search || item.textContent.toLowerCase();
          item.hidden = q && !blob.includes(q);
        });
      });
    }

    // select all
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        ms.querySelectorAll('.ms-item:not([hidden]) input[type="checkbox"]').forEach(cb => {
          cb.checked = true;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    }

    // clear
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        ms.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          cb.checked = false;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    }

    bindMultiselectInputs(ms);
  });

  // close on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.multiselect')) {
      document.querySelectorAll('.multiselect-dropdown').forEach(d => d.hidden = true);
      document.querySelectorAll('.multiselect.open').forEach(o => o.classList.remove('open'));
    }
  });
}

function bindMultiselectInputs(ms) {
  if (!ms) return;
  const filterId = ms.dataset.filter;
  ms.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      updateMultiselectLabel(ms);
      // update STATE.multiSelect for the structured filters; quick filters
      // are still read directly from els (their checkboxes are in there).
      if (filterId && filterId !== 'quick' && STATE.multiSelect[filterId]) {
        const set = STATE.multiSelect[filterId];
        if (cb.checked) set.add(cb.value);
        else set.delete(cb.value);
      }
      applyFilters();
    });
  });
  updateMultiselectLabel(ms);
}

function updateMultiselectLabel(ms) {
  const labelEl = ms.querySelector('.multiselect-label');
  if (!labelEl) return;
  const checked = Array.from(ms.querySelectorAll('input[type="checkbox"]:checked'));
  const allCount = ms.querySelectorAll('input[type="checkbox"]').length;
  const filterId = ms.dataset.filter;

  ms.classList.toggle('has-selection', checked.length > 0);

  const allLabels = {
    page: 'كل الصفحات',
    source: 'كل المصادر',
    postType: 'كل الأنواع',
    quick: 'بدون فلاتر',
  };

  if (checked.length === 0) {
    labelEl.textContent = allLabels[filterId] || 'الكل';
    return;
  }
  if (checked.length === allCount && filterId !== 'quick') {
    labelEl.textContent = allLabels[filterId] || 'الكل';
    return;
  }
  if (checked.length === 1) {
    const lbl = checked[0].nextElementSibling?.textContent?.trim() || checked[0].value;
    labelEl.textContent = lbl;
  } else {
    labelEl.textContent = `${checked.length} محدّد`;
  }
}

// ========= Render =========

function renderPosts() {
  const posts = STATE.filtered;
  els.resultCount.textContent = `${posts.length.toLocaleString('en-US')} منشور`;

  if (posts.length === 0) {
    showEmpty('لا توجد نتائج تطابق الفلاتر الحالية');
    _renderPagination(0, 1, 24);
    return;
  }

  // Pagination
  const perPage = STATE.perPage || 24;
  const total = posts.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  // Clamp current page to valid range (إذا تغيّرت الفلاتر بعد ما كان المستخدم في صفحة آخيرة)
  if (!STATE.currentPage || STATE.currentPage > totalPages) STATE.currentPage = 1;
  if (STATE.currentPage < 1) STATE.currentPage = 1;
  const page = STATE.currentPage;
  const start = (page - 1) * perPage;
  const slice = posts.slice(start, start + perPage);

  // طبقّ layout view (cards / list) من STATE
  const layout = STATE.postsLayout || 'cards';
  els.postsGrid.classList.toggle('layout-list', layout === 'list');
  els.postsGrid.classList.toggle('layout-cards', layout !== 'list');

  els.postsGrid.innerHTML = slice.map((post, i) =>
    layout === 'list' ? renderPostListRow(post, i) : renderPostCard(post, i)
  ).join('');

  _renderPagination(total, page, perPage);

  // Click handlers — يدعم card view و list view
  document.querySelectorAll('.post-card.clickable, .post-list-row.clickable').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('a, input, button')) return;
      const postId = item.dataset.postId;
      const slug = item.dataset.postSlug;
      const post = STATE.allPosts.find(p => p.post_id === postId && p.page_slug === slug);
      if (post) openPostDetailModal(post);
    });
  });

  // Checkbox change
  document.querySelectorAll('.post-select').forEach(cb => {
    cb.addEventListener('change', updateBulkButtonVisibility);
    cb.addEventListener('click', e => e.stopPropagation());
  });

  // Delete button — يعمل لكلا layouts
  document.querySelectorAll('.btn-delete-post').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const item = btn.closest('.post-card, .post-list-row');
      if (!item) return;
      const pid = item.dataset.postInternal;
      if (!pid) return;
      if (!confirm('حذف هذا المنشور؟')) return;
      const res = await fetch(`/api/posts/${pid}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (res.ok) {
        item.style.opacity = '0';
        setTimeout(() => {
          item.remove();
          showToast('تم الحذف', 'success');
          loadAllPages().then(applyFilters);
        }, 200);
      } else {
        showToast('فشل الحذف', 'error');
      }
    });
  });
}

// ==================== Media Library ====================

function openMediaLibrary() {
  // اجمع كل الصور + الفيديوهات من كل المنشورات
  const allImages = [];
  const allVideos = [];
  STATE.allPosts.forEach(p => {
    const media = Array.isArray(p.media) ? p.media : [];
    media.forEach(m => {
      if (!m.url) return;
      const item = {
        url: m.url,
        thumbnail: m.thumbnail || m.url,
        page_name: p.page_name,
        post_id: p.post_id,
        page_slug: p.page_slug,
        post_text: (p.text || '').slice(0, 100),
        post_url: p.post_url,
      };
      if (m.type === 'video') allVideos.push(item);
      else allImages.push(item);
    });
    if (p.image_url && !media.some(m => m.url === p.image_url)) {
      allImages.push({
        url: p.image_url, thumbnail: p.image_url,
        page_name: p.page_name, post_id: p.post_id, page_slug: p.page_slug,
        post_text: (p.text || '').slice(0, 100), post_url: p.post_url,
      });
    }
  });

  openModal('🖼 مكتبة الوسائط', `
    <div class="media-lib">
      <div class="media-lib-tabs">
        <button class="media-tab active" data-mtab="images">🖼 صور (${allImages.length})</button>
        <button class="media-tab" data-mtab="videos">🎥 فيديوهات (${allVideos.length})</button>
      </div>
      <p class="note">انقر على أي صورة لفتحها داخلياً. الفيديوهات تفتح على فيسبوك.</p>

      <div class="media-lib-pane" data-mtab="images">
        ${allImages.length === 0
          ? '<div class="empty"><p>لا توجد صور بعد.</p></div>'
          : `<div class="media-lib-grid">
               ${allImages.map((m, i) => `
                 <button type="button" class="media-tile" data-mtype="image" data-idx="${i}" title="${escapeHtml(m.post_text)}">
                   <img src="${escapeHtml(proxyMediaUrl(m.thumbnail))}" alt="" loading="lazy" onerror="this.parentElement.classList.add('img-broken')">
                   <span class="media-tile-label">${escapeHtml(m.page_name)}</span>
                 </button>
               `).join('')}
             </div>`
        }
      </div>

      <div class="media-lib-pane" data-mtab="videos" hidden>
        ${allVideos.length === 0
          ? '<div class="empty"><p>لا توجد فيديوهات بعد.</p></div>'
          : `<div class="media-lib-grid">
               ${allVideos.map((m, i) => `
                 <a href="${escapeHtml(ensureFullFbUrl(m.post_url || m.url))}" target="_blank" rel="noopener" class="media-tile video-tile" title="${escapeHtml(m.post_text)}">
                   ${m.thumbnail
                     ? `<img src="${escapeHtml(proxyMediaUrl(m.thumbnail))}" alt="" loading="lazy" onerror="this.parentElement.classList.add('img-broken')">`
                     : '<div class="video-tile-bg"></div>'
                   }
                   <span class="play-overlay"></span>
                   <span class="media-tile-label">${escapeHtml(m.page_name)}</span>
                 </a>
               `).join('')}
             </div>`
        }
      </div>
    </div>
  `, 'lg');

  // Tab switching
  document.querySelectorAll('.media-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const k = tab.dataset.mtab;
      document.querySelectorAll('.media-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.media-lib-pane').forEach(p => p.hidden = p.dataset.mtab !== k);
    });
  });

  // Image tile click → lightbox
  document.querySelectorAll('.media-tile[data-mtype="image"]').forEach(tile => {
    tile.addEventListener('click', () => {
      const idx = parseInt(tile.dataset.idx);
      openLightbox(allImages.map(x => x.url), idx);
    });
  });
}

// ==================== Image Lightbox ====================
const LB = {
  images: [],     // array of urls (original, not proxied)
  index: 0,
  caption: '',
};

function openLightbox(images, index = 0, caption = '') {
  if (!Array.isArray(images) || images.length === 0) return;
  LB.images = images;
  LB.index = Math.max(0, Math.min(index, images.length - 1));
  LB.caption = caption || '';

  const lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.hidden = false;
  document.body.style.overflow = 'hidden';
  _lightboxRender();

  // bind once
  if (!lb.dataset.bound) {
    document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
    document.getElementById('lightboxPrev').addEventListener('click', () => _lightboxStep(-1));
    document.getElementById('lightboxNext').addEventListener('click', () => _lightboxStep(+1));
    lb.addEventListener('click', (e) => {
      // close on backdrop click only (not on image / buttons)
      if (e.target === lb) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (lb.hidden) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowRight') _lightboxStep(-1);  // RTL: right = prev
      else if (e.key === 'ArrowLeft')  _lightboxStep(+1);
    });
    lb.dataset.bound = '1';
  }
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (lb) lb.hidden = true;
  document.body.style.overflow = '';
}

function _lightboxStep(delta) {
  const n = LB.images.length;
  if (n <= 1) return;
  LB.index = (LB.index + delta + n) % n;
  _lightboxRender();
}

function _lightboxRender() {
  const img = document.getElementById('lightboxImg');
  const counter = document.getElementById('lightboxCounter');
  const download = document.getElementById('lightboxDownload');
  const openNew = document.getElementById('lightboxOpenNew');

  const url = LB.images[LB.index] || '';
  const proxied = proxyMediaUrl(url);
  if (img) {
    img.classList.remove('loaded');
    img.onload = () => img.classList.add('loaded');
    img.src = proxied;
  }
  if (counter) counter.textContent = `${LB.index + 1} / ${LB.images.length}`;
  if (download) {
    download.href = proxied;
    const fname = (url.split('?')[0].split('/').pop() || 'image').slice(0, 60);
    download.download = fname || 'image';
  }
  if (openNew) openNew.href = proxied;

  // Hide nav buttons if only 1 image
  document.getElementById('lightboxPrev').style.visibility = LB.images.length > 1 ? 'visible' : 'hidden';
  document.getElementById('lightboxNext').style.visibility = LB.images.length > 1 ? 'visible' : 'hidden';
}

// ==================== Pagination ====================

function _renderPagination(total, page, perPage) {
  let bar = document.getElementById('postsPagination');
  const grid = els.postsGrid;
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'postsPagination';
    bar.className = 'pagination-bar';
    if (grid && grid.parentNode) grid.parentNode.insertBefore(bar, grid);
  } else if (grid && bar.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_PRECEDING) {
    // bar is currently AFTER grid — move it before
    grid.parentNode.insertBefore(bar, grid);
  }
  if (total === 0) { bar.innerHTML = ''; return; }

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  // قائمة الصفحات اللازم عرضها (أول، الجوار، آخر)
  const pages = _paginationPages(page, totalPages);

  bar.innerHTML = `
    <div class="pg-info">
      <span>${start}–${end} من ${formatNum(total)}</span>
      <div class="pg-pp">
        <label>عدد لكل صفحة:</label>
        <select id="pgPerPage" class="select-sm">
          ${[12, 24, 48, 96, 200].map(n => `<option value="${n}" ${n === perPage ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="pg-controls">
      <button class="pg-btn" data-pg="first" ${page === 1 ? 'disabled' : ''} title="الأولى">⏮</button>
      <button class="pg-btn" data-pg="prev"  ${page === 1 ? 'disabled' : ''} title="السابق">‹</button>
      ${pages.map(p => p === '...'
        ? `<span class="pg-ellipsis">…</span>`
        : `<button class="pg-btn ${p === page ? 'active' : ''}" data-pg="${p}">${p}</button>`
      ).join('')}
      <button class="pg-btn" data-pg="next" ${page === totalPages ? 'disabled' : ''} title="التالي">›</button>
      <button class="pg-btn" data-pg="last" ${page === totalPages ? 'disabled' : ''} title="الأخيرة">⏭</button>
    </div>
  `;

  // listeners
  bar.querySelectorAll('.pg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.pg;
      let next = page;
      if (t === 'first') next = 1;
      else if (t === 'last') next = totalPages;
      else if (t === 'prev') next = page - 1;
      else if (t === 'next') next = page + 1;
      else next = parseInt(t);
      if (next >= 1 && next <= totalPages && next !== page) {
        STATE.currentPage = next;
        renderPosts();
        // scroll إلى أعلى الـ grid
        els.postsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  const ppSelect = bar.querySelector('#pgPerPage');
  if (ppSelect) {
    ppSelect.addEventListener('change', () => {
      STATE.perPage = parseInt(ppSelect.value) || 24;
      try { localStorage.setItem('marsad_per_page', STATE.perPage); } catch {}
      // حافظ على نفس المنشور المرئي (تقريباً)
      const newTotalPages = Math.max(1, Math.ceil(total / STATE.perPage));
      const firstVisibleIndex = (page - 1) * perPage;
      STATE.currentPage = Math.min(newTotalPages, Math.floor(firstVisibleIndex / STATE.perPage) + 1);
      renderPosts();
    });
  }
}

function _paginationPages(current, total) {
  // يعرض: 1 ... (current-1) (current) (current+1) ... (total)
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

// ==================== Post Card / List rendering ====================

function _postBaseData(post) {
  const media = Array.isArray(post.media) ? post.media : [];
  const images = media.filter(m => m.type === 'image' || (m.type !== 'video' && m.url));
  const videos = media.filter(m => m.type === 'video');
  const primaryImage = post.image_url
    || (images[0] && images[0].url)
    || (media[0] && media[0].thumbnail)
    || '';
  const hasVideo = !!post.video_url || videos.length > 0;
  const mediaCount = images.length + videos.length;
  return { media, images, videos, primaryImage, hasVideo, mediaCount };
}

function renderPostCard(post, i) {
  const reactions = post.reactions || 0;
  const comments = post.comments || 0;
  const shares = post.shares || 0;
  const isHigh = reactions >= 1000;
  const hasEngagement = reactions || comments || shares;
  const sourceBadge = renderSourceBadge(post.source);
  const typeBadge = postTypeBadge(post.post_type || 'text');
  const hasComments = (post.comments_data || []).length > 0;

  const { primaryImage, hasVideo, mediaCount } = _postBaseData(post);

  // كل البطاقات الآن لها media area بنفس الحجم لتوحيد المظهر
  // (لو ما في صورة → placeholder رمادي مع أيقونة نوع المنشور)
  const mediaArea = primaryImage
    ? `<div class="post-image ${hasVideo ? 'has-video' : ''}">
         <img src="${escapeHtml(proxyMediaUrl(primaryImage))}" alt="" loading="lazy"
              onerror="this.parentElement.classList.add('img-broken')">
         ${hasVideo ? '<span class="play-overlay" aria-hidden="true"></span>' : ''}
         ${mediaCount > 1 ? `<span class="media-count-chip">+${mediaCount - 1}</span>` : ''}
       </div>`
    : `<div class="post-image post-image-placeholder">
         <div class="placeholder-icon">${_typeIconBig(post.post_type)}</div>
       </div>`;

  return `
    <article class="post-card clickable" data-post-id="${escapeHtml(post.post_id)}" data-post-slug="${escapeHtml(post.page_slug)}" data-post-internal="${post.id || ''}" style="animation-delay: ${Math.min(i * 30, 600)}ms">
      <div class="post-checkbox-wrap">
        <input type="checkbox" class="post-select" data-post-id="${post.id || ''}">
      </div>
      <button class="btn-delete-post" title="حذف هذا المنشور" type="button">×</button>
      ${mediaArea}
      <div class="post-card-body">
        <div class="post-header">
          <div class="post-page">${escapeHtml(post.page_name)}</div>
          <div class="post-time">${formatTime(post.timestamp_text, post.published_at || post.scraped_at)}</div>
        </div>
        <div class="post-meta-row">${typeBadge}${sourceBadge}</div>
        <div class="post-text">${escapeHtml(post.text || '')}</div>
        <div class="post-engagement">
          ${hasEngagement ? `
            <div class="engagement-item ${isHigh ? 'high' : ''}" title="تفاعلات">❤ <strong>${formatNum(reactions)}</strong></div>
            <div class="engagement-item ${hasComments ? 'has-detail' : ''}" title="تعليقات">💬 <strong>${formatNum(comments)}</strong></div>
            <div class="engagement-item" title="مشاركات">↗ <strong>${formatNum(shares)}</strong></div>
          ` : `<div class="engagement-item no-data">⊘ بدون تفاعلات</div>`}
        </div>
      </div>
    </article>
  `;
}

function renderPostListRow(post, i) {
  const reactions = post.reactions || 0;
  const comments = post.comments || 0;
  const shares = post.shares || 0;
  const sourceBadge = renderSourceBadge(post.source);
  const typeBadge = postTypeBadge(post.post_type || 'text');

  const { primaryImage, hasVideo, mediaCount } = _postBaseData(post);
  const thumb = primaryImage
    ? `<div class="list-thumb ${hasVideo ? 'has-video' : ''}">
         <img src="${escapeHtml(proxyMediaUrl(primaryImage))}" alt="" loading="lazy"
              onerror="this.parentElement.classList.add('img-broken')">
         ${hasVideo ? '<span class="play-overlay-sm"></span>' : ''}
         ${mediaCount > 1 ? `<span class="media-count-chip">+${mediaCount - 1}</span>` : ''}
       </div>`
    : `<div class="list-thumb placeholder">${_typeIconBig(post.post_type)}</div>`;

  return `
    <article class="post-list-row clickable" data-post-id="${escapeHtml(post.post_id)}" data-post-slug="${escapeHtml(post.page_slug)}" data-post-internal="${post.id || ''}">
      <input type="checkbox" class="post-select list-cb" data-post-id="${post.id || ''}" onclick="event.stopPropagation()">
      ${thumb}
      <div class="list-content">
        <div class="list-head">
          <strong class="list-page">${escapeHtml(post.page_name)}</strong>
          <span class="list-time">${formatTime(post.timestamp_text, post.published_at || post.scraped_at)}</span>
          ${typeBadge}
          ${sourceBadge}
        </div>
        <div class="list-text">${escapeHtml((post.text || '').slice(0, 220))}${(post.text || '').length > 220 ? '…' : ''}</div>
        <div class="list-engagement">
          <span title="تفاعلات">❤ ${formatNum(reactions)}</span>
          <span title="تعليقات">💬 ${formatNum(comments)}</span>
          <span title="مشاركات">↗ ${formatNum(shares)}</span>
        </div>
      </div>
      <button class="btn-icon-sm btn-delete-post list-delete" title="حذف" type="button" onclick="event.stopPropagation()">×</button>
    </article>
  `;
}

function _typeIconBig(type) {
  const icons = { video: '🎥', photo: '🖼', link: '🔗', live: '🔴', event: '📅', text: '📝' };
  return icons[type] || '📝';
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
 * هل هذا رابط فيديو يشتغل مباشرة في &lt;video&gt;؟
 * - ينتهي بـ .mp4 / .mov / .webm / .m4v / .mkv
 * - أو مضيف معروف يعطي ملفات فيديو مباشرة (video.fbcdn.net مثلاً)
 *
 * URLs مثل https://www.facebook.com/reel/123 ليست ملفات فيديو
 * (إنها صفحات HTML)، فلازم نفتحها على فيسبوك بدلاً من <video>.
 */
function isPlayableVideoUrl(url) {
  if (!url) return false;
  const u = String(url).toLowerCase();
  // امتدادات صريحة
  if (/\.(mp4|mov|webm|m4v|mkv|ts)(\?|$)/.test(u)) return true;
  // مضيفات معروفة
  if (u.includes('video.fbcdn.net') || u.includes('video-')) return true;
  // FB reels/watch/posts/photo URLs - صفحات HTML، مش playable
  if (/facebook\.com\/(reel|watch|video|posts|photo|share)/.test(u)) return false;
  if (u.startsWith('https://fb.watch/') || u.startsWith('https://www.fb.watch/')) return false;
  // غير محسوم — اعتبره غير playable للأمان (يفتح على فيسبوك)
  return false;
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

// ==================== Icon library (inline SVG) ====================
// أيقونات Lucide-style 16px stroke-width=2 (للعناوين والأزرار)
const ICONS = {
  download:   '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  upload:     '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  trash:      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  save:       '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  edit:       '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  plus:       '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  x:          '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  check:      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  filter:     '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
  search:     '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  copy:       '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  link:       '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  play:       '<svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  refresh:    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><polyline points="21 3 21 8 16 8"/></svg>',
  settings:   '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  user:       '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  users:      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  lock:       '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  clock:      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  calendar:   '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  page:       '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  image:      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  video:      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
  bar_chart:  '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  zap:        '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  alert:      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  external:   '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  file_text:  '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  message:    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  share:      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
  heart:      '<svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  film:       '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>',
  printer:    '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
};

function ic(name) { return ICONS[name] || ''; }

/**
 * Dialog مخصّص لحذف صفحة - يعطي ثلاث خيارات:
 *   - "with-posts": حذف الصفحة + كل منشوراتها
 *   - "page-only":  حذف الصفحة فقط (المنشورات تبقى)
 *   - null:         إلغاء
 * يُرجع Promise يحلّ بأحد القيم الثلاث.
 */
function _showDeletePageChoice(pageName) {
  return new Promise((resolve) => {
    // overlay مستقل عن modal-overlay الرئيسي
    const overlay = document.createElement('div');
    overlay.className = 'mini-confirm-overlay';
    overlay.innerHTML = `
      <div class="mini-confirm-box">
        <h3>حذف "${escapeHtml(pageName)}"</h3>
        <p>اختر ما تريد حذفه:</p>
        <div class="mini-confirm-actions">
          <button class="btn-refresh" data-act="cancel" type="button">إلغاء</button>
          <button class="btn-refresh" data-act="page-only" type="button">حذف الصفحة فقط (الإبقاء على المنشورات)</button>
          <button class="btn-trigger btn-danger-strong" data-act="with-posts" type="button">🗑 حذف الصفحة + كل منشوراتها</button>
        </div>
      </div>
    `;
    const close = (val) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
      const btn = e.target.closest('button[data-act]');
      if (btn) {
        const act = btn.dataset.act;
        close(act === 'cancel' ? null : act);
      }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  });
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

// ==================== Posts Export (advanced) ====================
const EXPORT_FIELDS = [
  { id: 'page_name',           label: 'اسم الصفحة',     get: p => p.page_name || '' },
  { id: 'page_slug',           label: 'كود الصفحة (slug)', get: p => p.page_slug || '', off: true },
  { id: 'text',                label: 'النص',           get: p => p.text || '' },
  { id: 'post_type',           label: 'نوع المنشور',     get: p => p.post_type || 'text' },
  { id: 'reactions',           label: 'تفاعلات',        get: p => p.reactions || 0 },
  { id: 'comments',            label: 'تعليقات',        get: p => p.comments || 0 },
  { id: 'shares',              label: 'مشاركات',        get: p => p.shares || 0 },
  { id: 'engagement_total',    label: 'إجمالي التفاعل',  get: p => (p.reactions || 0) + (p.comments || 0) + (p.shares || 0) },
  { id: 'date',                label: 'التاريخ',        get: p => splitDateTime(p.published_at || p.scraped_at).date },
  { id: 'time',                label: 'الوقت',          get: p => splitDateTime(p.published_at || p.scraped_at).time },
  { id: 'datetime',            label: 'تاريخ + وقت',    get: p => p.published_at || p.scraped_at || '', off: true },
  { id: 'source',              label: 'المصدر',         get: p => p.source || '' },
  { id: 'post_url',            label: 'رابط المنشور',   get: p => p.post_url || '' },
  { id: 'image_url',           label: 'رابط الصورة',    get: p => p.image_url || '', off: true },
  { id: 'video_url',           label: 'رابط الفيديو',   get: p => p.video_url || '', off: true },
  { id: 'media_count',         label: 'عدد الميديا',    get: p => (p.media || []).length, off: true },
  { id: 'hashtags',            label: 'هاشتاقات',       get: p => (p.hashtags || []).join(' '), off: true },
  { id: 'comments_count_real', label: 'تعليقات منزّلة', get: p => (p.comments_data || []).length, off: true },
  { id: 'author_name',         label: 'الكاتب',         get: p => p.author_name || '', off: true },
  { id: 'is_pinned',           label: 'مثبّت؟',         get: p => p.is_pinned ? '✓' : '', off: true },
  { id: 'is_sponsored',        label: 'مموَّل؟',         get: p => p.is_sponsored ? '✓' : '', off: true },
  { id: 'scraped_at_date',     label: 'تاريخ السحب',    get: p => splitDateTime(p.scraped_at).date, off: true },
  { id: 'scraped_at_time',     label: 'وقت السحب',      get: p => splitDateTime(p.scraped_at).time, off: true },
];

function splitDateTime(iso) {
  if (!iso) return { date: '', time: '' };
  const s = String(iso);
  // ISO 8601: 2026-04-25T14:30:00 — split at T
  // Or "2026-04-25 14:30:00" — split at space (MySQL DATETIME format)
  let tIdx = s.indexOf('T');
  if (tIdx === -1) tIdx = s.indexOf(' ');
  if (tIdx === -1) return { date: s.slice(0, 10), time: '' };
  return { date: s.slice(0, 10), time: s.slice(tIdx + 1, tIdx + 9) };
}

// ---------- Export config persistence ----------
const EXPORT_CFG_KEY = 'marsad_export_config_v1';

function _loadExportConfig() {
  try {
    const raw = localStorage.getItem(EXPORT_CFG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (!cfg || typeof cfg !== 'object') return null;
    return cfg;
  } catch { return null; }
}

function _saveExportConfig(cfg) {
  try { localStorage.setItem(EXPORT_CFG_KEY, JSON.stringify(cfg)); } catch {}
}

/**
 * يبني عناصر الحقول حسب الترتيب المحفوظ + أعمدة custom المضافة.
 */
function _buildExportFieldItems() {
  const cfg = _loadExportConfig() || {};
  const savedOrder   = Array.isArray(cfg.order) ? cfg.order : [];
  const savedEnabled = Array.isArray(cfg.enabled) ? new Set(cfg.enabled) : null;
  const customCols   = Array.isArray(cfg.custom) ? cfg.custom : [];

  // الحقول الأساسية: بترتيب savedOrder، أو الترتيب الافتراضي لو مش محفوظ
  let fieldsList = [];
  if (savedOrder.length) {
    // اتبع الترتيب المحفوظ، وأضف أي حقول جديدة (مش بالـ savedOrder) في الأخير
    const knownIds = new Set(EXPORT_FIELDS.map(f => f.id));
    for (const fid of savedOrder) {
      if (fid.startsWith('custom:')) {
        const cust = customCols.find(c => c.id === fid);
        if (cust) fieldsList.push({ kind: 'custom', def: cust });
      } else if (knownIds.has(fid)) {
        const def = EXPORT_FIELDS.find(f => f.id === fid);
        fieldsList.push({ kind: 'std', def });
      }
    }
    // أي custom cols غير موجودين بالـ savedOrder → أضفهم
    for (const c of customCols) {
      if (!savedOrder.includes(c.id)) fieldsList.push({ kind: 'custom', def: c });
    }
    // أي حقول std غير موجودة → أضفها بعد
    for (const f of EXPORT_FIELDS) {
      if (!savedOrder.includes(f.id)) fieldsList.push({ kind: 'std', def: f });
    }
  } else {
    fieldsList = EXPORT_FIELDS.map(f => ({ kind: 'std', def: f }));
    // ضف أعمدة custom محفوظة (لو في)
    for (const c of customCols) fieldsList.push({ kind: 'custom', def: c });
  }

  return fieldsList.map(item => {
    const f = item.def;
    let isEnabled;
    if (savedEnabled) {
      isEnabled = savedEnabled.has(f.id);
    } else {
      // أول مرة - استعمل الـ defaults
      isEnabled = item.kind === 'custom' ? true : !f.off;
    }
    const isCustom = item.kind === 'custom';
    return `
      <label class="export-field-item ${isEnabled ? 'checked' : ''} ${isCustom ? 'is-custom' : ''}" draggable="true" data-field="${escapeHtml(f.id)}">
        <span class="drag-grip" aria-hidden="true">⠿</span>
        <input type="checkbox" class="export-field-cb" ${isEnabled ? 'checked' : ''}>
        <span class="ef-label">${escapeHtml(f.label)}</span>
        ${isCustom ? '<button type="button" class="ef-remove" title="حذف العمود" aria-label="حذف">×</button>' : ''}
      </label>
    `;
  }).join('');
}

/**
 * يجمع الترتيب + التفعيل + الأعمدة custom من الـ DOM ويحفظ.
 */
function _persistExportConfig() {
  const items = Array.from(document.querySelectorAll('#exportFields .export-field-item'));
  const order = items.map(i => i.dataset.field);
  const enabled = items
    .filter(i => i.querySelector('input').checked)
    .map(i => i.dataset.field);

  const customCols = [];
  items.forEach(i => {
    if (i.dataset.field.startsWith('custom:')) {
      const lbl = i.querySelector('.ef-label')?.textContent || '';
      customCols.push({ id: i.dataset.field, label: lbl });
    }
  });

  _saveExportConfig({ order, enabled, custom: customCols });
}

function exportCSV() {
  // الزر القديم - الآن يفتح modal التصدير المتقدم
  openExportModal();
}

function openExportModal() {
  const posts = STATE.filtered || [];
  if (posts.length === 0) {
    showToast('لا توجد منشورات للتصدير - عدّل الفلاتر أولاً', 'error');
    return;
  }
  const totalCount = STATE.allPosts.length;
  const filteredCount = posts.length;
  const isFiltered = filteredCount !== totalCount;

  openModal('تصدير المنشورات', `
    <div class="export-modal">
      <div class="export-info">
        <div class="export-stat">
          <span class="export-num">${formatNum(filteredCount)}</span>
          <span class="export-lbl">منشور</span>
        </div>
        ${isFiltered
          ? `<div class="alert alert-info" style="margin:0;flex:1">
               🔍 <strong>تصدير وفق الفلاتر النشطة</strong> — ${filteredCount} من أصل ${totalCount}.
             </div>`
          : `<div class="alert" style="margin:0;flex:1;background:var(--ink-50);border-color:var(--border)">
               ℹ️ سيُصدَّر <strong>كل ${totalCount}</strong> منشور (لا توجد فلاتر نشطة).
             </div>`}
      </div>

      <div class="export-section">
        <h4>${ic('file_text')} صيغة الملف</h4>
        <div class="format-options">
          <label class="format-option">
            <input type="radio" name="exportFormat" value="xlsx" checked>
            <span class="format-icon">${ic('bar_chart')}</span>
            <strong>Excel (.xlsx)</strong>
            <small>الأفضل للمشاركة والتحليل</small>
          </label>
          <label class="format-option">
            <input type="radio" name="exportFormat" value="csv">
            <span class="format-icon">${ic('file_text')}</span>
            <strong>CSV</strong>
            <small>متوافق مع كل البرامج</small>
          </label>
          <label class="format-option">
            <input type="radio" name="exportFormat" value="json">
            <span class="format-icon">${ic('link')}</span>
            <strong>JSON</strong>
            <small>للمطورين والـ APIs</small>
          </label>
        </div>
      </div>

      <div class="export-section">
        <div class="export-section-head">
          <h4>${ic('settings')} الحقول المضمّنة</h4>
          <div class="export-section-actions">
            <button class="btn-refresh btn-sm" id="exportSelectAll" type="button">حدد الكل</button>
            <button class="btn-refresh btn-sm" id="exportSelectNone" type="button">مسح</button>
            <button class="btn-refresh btn-sm" id="exportSelectDefaults" type="button">افتراضي</button>
          </div>
        </div>
        <p class="note" style="margin:6px 0">اسحب لإعادة الترتيب · اضغط لتفعيل/إلغاء · إعداداتك تُحفظ تلقائياً</p>
        <div class="export-fields" id="exportFields">
          ${_buildExportFieldItems()}
        </div>
        <div class="export-add-custom">
          <input type="text" id="exportCustomColName" class="input" placeholder="أضف عمود جديد (مثلاً: تصنيف)" maxlength="40">
          <button class="btn-trigger btn-sm" id="exportAddCustomCol" type="button">+ إضافة عمود</button>
        </div>
      </div>

      <div class="export-section">
        <h4>${ic('filter')} ترتيب الصفوف</h4>
        <select id="exportSort" class="select" style="max-width:300px">
          <option value="newest">الأحدث أولاً</option>
          <option value="oldest">الأقدم أولاً</option>
          <option value="reactions">الأعلى تفاعلاً</option>
          <option value="comments">الأكثر تعليقاً</option>
          <option value="shares">الأكثر مشاركة</option>
          <option value="page">حسب اسم الصفحة</option>
        </select>
      </div>

      <div class="export-section">
        <h4>${ic('file_text')} عدد المنشورات</h4>
        <div class="form-inline" style="gap:8px;align-items:center;flex-wrap:wrap">
          <label class="radio-chip">
            <input type="radio" name="exportLimit" value="all" checked>
            <span>الكل (${filteredCount})</span>
          </label>
          <label class="radio-chip">
            <input type="radio" name="exportLimit" value="custom">
            <span>عدد محدد</span>
          </label>
          <input type="number" id="exportLimitN" class="input" min="1" max="${filteredCount}" value="100" placeholder="مثلاً 100" style="max-width:160px" disabled>
        </div>
      </div>

      <div class="export-section">
        <h4>${ic('file_text')} اسم الملف</h4>
        <input type="text" id="exportFilename" class="input" placeholder="marsad_posts" dir="ltr"
               value="marsad_posts_${new Date().toISOString().slice(0, 10)}">
      </div>

      <div class="export-actions">
        <button class="btn-refresh" id="exportCancelBtn" type="button">إلغاء</button>
        <button class="btn-trigger has-icon" id="exportConfirmBtn" type="button">${ic('download')}<span>تصدير</span></button>
      </div>
    </div>
  `, 'lg');

  bindExportModal();
}

function bindExportModal() {
  const fieldsEl = document.getElementById('exportFields');

  // Click/drag handlers via shared helper (also persists changes)
  fieldsEl.querySelectorAll('.export-field-item').forEach(item => {
    _attachExportFieldHandlers(item);
  });

  document.getElementById('exportSelectAll')?.addEventListener('click', () => {
    fieldsEl.querySelectorAll('.export-field-item').forEach(i => {
      i.querySelector('input').checked = true;
      i.classList.add('checked');
    });
    _persistExportConfig();
  });
  document.getElementById('exportSelectNone')?.addEventListener('click', () => {
    fieldsEl.querySelectorAll('.export-field-item').forEach(i => {
      i.querySelector('input').checked = false;
      i.classList.remove('checked');
    });
    _persistExportConfig();
  });
  document.getElementById('exportSelectDefaults')?.addEventListener('click', () => {
    fieldsEl.querySelectorAll('.export-field-item').forEach(i => {
      const fid = i.dataset.field;
      const def = EXPORT_FIELDS.find(f => f.id === fid);
      const isCustom = fid.startsWith('custom:');
      const on = isCustom ? true : (def && !def.off);
      i.querySelector('input').checked = on;
      i.classList.toggle('checked', on);
    });
    _persistExportConfig();
  });

  // Add custom column
  const addBtn = document.getElementById('exportAddCustomCol');
  const addInput = document.getElementById('exportCustomColName');
  if (addBtn && addInput) {
    const onAdd = () => {
      const name = addInput.value.trim();
      if (!name) {
        showToast('أدخل اسم العمود', 'error');
        return;
      }
      // generate id
      const id = 'custom:' + name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_؀-ۿ]/g, '').slice(0, 32) + '_' + Date.now().toString(36).slice(-4);
      const itemEl = document.createElement('label');
      itemEl.className = 'export-field-item is-custom checked';
      itemEl.draggable = true;
      itemEl.dataset.field = id;
      itemEl.innerHTML = `
        <span class="drag-grip" aria-hidden="true">⠿</span>
        <input type="checkbox" class="export-field-cb" checked>
        <span class="ef-label">${escapeHtml(name)}</span>
        <button type="button" class="ef-remove" title="حذف العمود" aria-label="حذف">×</button>
      `;
      fieldsEl.appendChild(itemEl);
      addInput.value = '';
      _attachExportFieldHandlers(itemEl);
      _persistExportConfig();
      showToast(`أُضيف عمود "${name}" — سيظهر فارغاً في الملف، وسيظل محفوظاً للمرات القادمة`, 'success');
    };
    addBtn.addEventListener('click', onAdd);
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onAdd(); }
    });
  }

  // Remove custom column (event delegation)
  fieldsEl.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.ef-remove');
    if (!removeBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const item = removeBtn.closest('.export-field-item');
    if (item) {
      item.remove();
      _persistExportConfig();
    }
  });

  document.querySelectorAll('input[name="exportLimit"]').forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('exportLimitN').disabled = r.value !== 'custom';
    });
  });

  document.getElementById('exportCancelBtn')?.addEventListener('click', closeModal);
  document.getElementById('exportConfirmBtn')?.addEventListener('click', performExport);
}

/**
 * يربط handlers (toggle + drag) لعنصر export-field-item جديد
 * (مستخدم لإضافة custom column).
 *
 * ملاحظة: العنصر <label> فبالـ HTML المتصفح بيعمل toggle تلقائياً
 * لما تنقر على الـ label. لذلك ما نضيف click handler يدوي عشان
 * ما يصير double-toggle. فقط نسجّل على الـ change event.
 */
function _attachExportFieldHandlers(item) {
  const cb = item.querySelector('.export-field-cb');
  // المتصفح بيعمل toggle للـ checkbox تلقائياً عند click على <label>
  // — نتابع التغيير عبر change event فقط
  cb.addEventListener('change', () => {
    item.classList.toggle('checked', cb.checked);
    _persistExportConfig();
  });

  // drag
  item.addEventListener('dragstart', (e) => {
    item.classList.add('dragging');
    window._dragged = item;
    e.dataTransfer.effectAllowed = 'move';
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.querySelectorAll('.export-field-item').forEach(i => i.classList.remove('drag-over'));
    window._dragged = null;
    _persistExportConfig();
  });
  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (item === window._dragged) return;
    item.classList.add('drag-over');
  });
  item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
  item.addEventListener('drop', (e) => {
    e.preventDefault();
    const dragged = window._dragged;
    if (!dragged || dragged === item) return;
    const rect = item.getBoundingClientRect();
    const after = (e.clientY - rect.top) > rect.height / 2;
    item.parentNode.insertBefore(dragged, after ? item.nextSibling : item);
  });
}

async function performExport() {
  const btn = document.getElementById('exportConfirmBtn');
  btn.disabled = true;
  btn.textContent = '⏳ جاري التحضير…';

  try {
    const fmt = document.querySelector('input[name="exportFormat"]:checked').value;
    const sort = document.getElementById('exportSort').value;
    const filename = (document.getElementById('exportFilename').value.trim() || 'marsad_posts');

    const fieldsOrder = Array.from(document.querySelectorAll('#exportFields .export-field-item'));
    const chosen = fieldsOrder
      .filter(i => i.querySelector('input').checked)
      .map(i => {
        const fid = i.dataset.field;
        if (fid.startsWith('custom:')) {
          const lbl = i.querySelector('.ef-label')?.textContent || 'عمود مخصص';
          return { id: fid, label: lbl, get: () => '' };
        }
        return EXPORT_FIELDS.find(f => f.id === fid);
      })
      .filter(Boolean);

    if (!chosen.length) {
      showToast('اختر حقلاً واحداً على الأقل', 'error');
      btn.disabled = false;
      btn.textContent = '📤 تصدير';
      return;
    }

    // Persist final order/selection to localStorage
    _persistExportConfig();

    let posts = [...STATE.filtered];
    posts.sort((a, b) => {
      const aDate = new Date(a.published_at || a.scraped_at || 0);
      const bDate = new Date(b.published_at || b.scraped_at || 0);
      switch (sort) {
        case 'oldest':    return aDate - bDate;
        case 'reactions': return (b.reactions || 0) - (a.reactions || 0);
        case 'comments':  return (b.comments || 0) - (a.comments || 0);
        case 'shares':    return (b.shares || 0) - (a.shares || 0);
        case 'page':      return (a.page_name || '').localeCompare(b.page_name || '', 'ar');
        case 'newest':
        default:          return bDate - aDate;
      }
    });

    const limitMode = document.querySelector('input[name="exportLimit"]:checked').value;
    if (limitMode === 'custom') {
      const n = parseInt(document.getElementById('exportLimitN').value) || posts.length;
      posts = posts.slice(0, n);
    }

    const headers = chosen.map(f => f.label);
    const rows = posts.map(p => chosen.map(f => f.get(p)));

    if (fmt === 'csv') {
      _exportPostsCsv(headers, rows, filename + '.csv');
    } else if (fmt === 'json') {
      const objs = posts.map(p => {
        const o = {};
        chosen.forEach(f => { o[f.label] = f.get(p); });
        return o;
      });
      _exportPostsJson(objs, filename + '.json');
    } else {
      showToast('⏳ جاري تحميل مكتبة Excel…', 'info');
      await loadXLSXLib();
      _exportPostsXlsx(headers, rows, filename + '.xlsx');
    }

    showToast(`✅ تم تصدير ${posts.length} منشور`, 'success');
    closeModal();
  } catch (e) {
    showToast('فشل التصدير: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '📤 تصدير';
  }
}

function _exportPostsCsv(headers, rows, filename) {
  const escape = (v) => {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const csv = '﻿' + [
    headers.map(escape).join(','),
    ...rows.map(r => r.map(escape).join(',')),
  ].join('\r\n');
  _triggerExportDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
}

function _exportPostsJson(objs, filename) {
  _triggerExportDownload(
    new Blob([JSON.stringify(objs, null, 2)], { type: 'application/json;charset=utf-8' }),
    filename
  );
}

function _exportPostsXlsx(headers, rows, filename) {
  if (!window.XLSX) throw new Error('XLSX library not loaded');
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (!ws['!views']) ws['!views'] = [{}];
  ws['!views'][0].RTL = true;
  ws['!cols'] = headers.map(h => {
    const len = String(h).length;
    return { wch: Math.min(Math.max(len + 4, 12), 60) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'المنشورات');
  XLSX.writeFile(wb, filename);
}

function _triggerExportDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCSV_OLD_DEPRECATED_DO_NOT_USE() {
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
  const sourcesStatus = STATE.sourcesStatus || [];
  const enabledSources = sourcesStatus.filter(s => s.enabled);
  const totalPages = STATE.pagesConfig.length;

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

      <!-- Pages: all OR specific multi-select -->
      <div class="form-row">
        <label class="filter-label">الصفحات</label>
        <div class="trigger-pages-mode">
          <label class="radio-chip">
            <input type="radio" name="pagesMode" value="all" checked>
            <span>📚 كل الصفحات (${totalPages})</span>
          </label>
          <label class="radio-chip">
            <input type="radio" name="pagesMode" value="some">
            <span>✓ صفحات محددة</span>
          </label>
        </div>
        <div id="trigPagesPicker" class="trigger-pages-picker" hidden>
          <div class="trigger-pages-toolbar">
            <input type="text" id="trigPagesSearch" class="input" placeholder="🔍 ابحث في الصفحات…">
            <button class="btn-refresh btn-sm" id="trigSelectAllPages" type="button">تحديد الكل المرئي</button>
            <button class="btn-refresh btn-sm" id="trigClearAllPages" type="button">مسح</button>
          </div>
          <div class="trigger-pages-list" id="trigPagesList">
            ${STATE.pagesConfig.map(p => `
              <label class="trig-page-item" data-search="${escapeHtml(((p.name || '') + ' ' + (p.url || '') + ' ' + (p.city || '')).toLowerCase())}">
                <input type="checkbox" class="trig-page-cb" value="${escapeHtml(p.slug)}">
                <span class="trig-page-name">${escapeHtml(p.name || p.slug)}</span>
                ${p.city ? `<span class="trig-page-city">📍 ${escapeHtml(p.city)}</span>` : ''}
              </label>
            `).join('')}
          </div>
          <div class="trigger-pages-count" id="trigPagesCount">0 صفحة محددة</div>
        </div>
      </div>

      <!-- Quick time presets -->
      <div class="form-row">
        <label class="filter-label">الفترة الزمنية</label>
        <div class="time-presets">
          <button class="preset-btn" data-preset="1h" type="button">⚡ آخر ساعة</button>
          <button class="preset-btn" data-preset="24h" type="button">📅 آخر 24 ساعة</button>
          <button class="preset-btn" data-preset="7d" type="button">📆 آخر أسبوع</button>
          <button class="preset-btn" data-preset="30d" type="button">🗓️ آخر شهر</button>
          <button class="preset-btn active" data-preset="custom" type="button">✏️ مخصص</button>
        </div>
      </div>

      <div class="form-inline" id="trigCustomDates">
        <div class="form-row">
          <label class="filter-label">من تاريخ (اختياري)</label>
          <input type="date" id="runDateFrom" class="input">
        </div>
        <div class="form-row">
          <label class="filter-label">إلى تاريخ (اختياري)</label>
          <input type="date" id="runDateTo" class="input">
        </div>
      </div>

      <div class="form-row">
        <label class="filter-label">المصدر</label>
        <select id="runSourceSelect" class="select">
          <option value="">تلقائي (حسب رابط كل صفحة)</option>
          ${enabledSources.map(s =>
            `<option value="${s.source_name || s.name}">${s.icon || '🔌'} ${s.label || s.source_name || s.name}</option>`
          ).join('')}
        </select>
      </div>

      <button class="btn-trigger btn-full btn-lg" id="startScrapeBtn" ${enabledSources.length === 0 ? 'disabled' : ''}>
        ▶️ ابدأ السحب
      </button>

      <p class="note">
        ⏱️ السحب يستغرق 1-5 دقائق. التقدم سيظهر مباشرة بدون تحديث الصفحة.
        <br>💡 لو الصفحة عندها <strong>عدد منشورات</strong> محدد سيُستخدم. لو فارغ سيعتمد على التاريخ.
      </p>
    </div>
  `);

  bindTriggerModalEvents();

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

    // الصفحات: all أو محددة
    const mode = document.querySelector('input[name="pagesMode"]:checked')?.value || 'all';
    if (mode === 'some') {
      const checked = Array.from(document.querySelectorAll('.trig-page-cb:checked')).map(cb => cb.value);
      if (checked.length === 0) {
        showToast('اختر صفحة واحدة على الأقل أو اختر "كل الصفحات"', 'error');
        btn.disabled = false;
        btn.textContent = '▶️ ابدأ السحب';
        return;
      }
      body.slugs = checked;
    }

    const source = document.getElementById('runSourceSelect').value;
    if (source) body.source = source;

    const dateFrom = document.getElementById('runDateFrom').value;
    const dateTo = document.getElementById('runDateTo').value;
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

// ========= Trigger modal: pages multi-select + quick presets =========

function bindTriggerModalEvents() {
  const srcLink = document.getElementById('openSrcSettings');
  if (srcLink) {
    srcLink.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal();
      setTimeout(() => openSettingsModal(), 250);
    });
  }

  // Toggle pages picker visibility
  document.querySelectorAll('input[name="pagesMode"]').forEach(r => {
    r.addEventListener('change', () => {
      const picker = document.getElementById('trigPagesPicker');
      if (picker) picker.hidden = r.value !== 'some' || !r.checked;
    });
  });

  // Search inside picker
  const searchEl = document.getElementById('trigPagesSearch');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      const q = searchEl.value.trim().toLowerCase();
      document.querySelectorAll('.trig-page-item').forEach(item => {
        const blob = item.dataset.search || '';
        item.hidden = q && !blob.includes(q);
      });
    });
  }

  // Update count + manage select-all behavior
  const countEl = document.getElementById('trigPagesCount');
  function updateTrigCount() {
    const n = document.querySelectorAll('.trig-page-cb:checked').length;
    if (countEl) countEl.textContent = `${n} صفحة محددة`;
  }
  document.querySelectorAll('.trig-page-cb').forEach(cb => cb.addEventListener('change', updateTrigCount));

  document.getElementById('trigSelectAllPages')?.addEventListener('click', () => {
    document.querySelectorAll('.trig-page-item:not([hidden]) .trig-page-cb').forEach(cb => cb.checked = true);
    updateTrigCount();
  });
  document.getElementById('trigClearAllPages')?.addEventListener('click', () => {
    document.querySelectorAll('.trig-page-cb').forEach(cb => cb.checked = false);
    updateTrigCount();
  });

  // Quick time presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const dfEl = document.getElementById('runDateFrom');
      const dtEl = document.getElementById('runDateTo');
      const customWrap = document.getElementById('trigCustomDates');
      const preset = btn.dataset.preset;
      const now = new Date();
      const fmt = (d) => d.toISOString().slice(0, 10);

      if (preset === 'custom') {
        customWrap.hidden = false;
        return;
      }
      customWrap.hidden = true;

      let from = new Date(now);
      if (preset === '1h')  from.setHours(now.getHours() - 1);
      if (preset === '24h') from.setDate(now.getDate() - 1);
      if (preset === '7d')  from.setDate(now.getDate() - 7);
      if (preset === '30d') from.setDate(now.getDate() - 30);
      // الـ inputs نوع date فبتقبل yyyy-mm-dd فقط (الساعة تنحسب server-side
      // لأن السحب فيه dedup-by-id أي ما رح يحضر مرتين)
      dfEl.value = fmt(from);
      dtEl.value = '';   // إلى الآن
    });
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
      <div class="progress-log-wrap">
        <div class="progress-log" id="progLog"></div>
        <button class="progress-jump-btn" id="progJumpBtn" type="button" hidden>↓ النزول للأسفل</button>
      </div>
      <div class="progress-footer" id="progFooter" hidden>
        <button class="btn-trigger btn-full" id="progDoneBtn">✓ تم · عرض النتائج</button>
      </div>
    </div>
  `, 'lg');

  const evtSource = new EventSource(`/api/scrape/${jobId}/stream`);
  const log = document.getElementById('progLog');
  const jumpBtn = document.getElementById('progJumpBtn');

  // ----- Smart auto-scroll -----
  // الفكرة: ما نُجبر التمرير لأسفل لو المستخدم scrolled لأعلى ليقرأ.
  // نعتبر "في الأسفل" لو المسافة من الأسفل أقل من 50px.
  // لو المستخدم scrolled لأعلى، نُظهر زر "النزول للأسفل".
  let userScrolledUp = false;
  const isAtBottom = () => {
    if (!log) return true;
    return log.scrollHeight - log.scrollTop - log.clientHeight < 50;
  };
  const scrollToBottom = () => {
    if (log) log.scrollTop = log.scrollHeight;
  };
  if (log) {
    log.addEventListener('scroll', () => {
      const atBottom = isAtBottom();
      userScrolledUp = !atBottom;
      if (jumpBtn) jumpBtn.hidden = atBottom;
    });
  }
  if (jumpBtn) {
    jumpBtn.addEventListener('click', () => {
      userScrolledUp = false;
      scrollToBottom();
      jumpBtn.hidden = true;
    });
  }

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

      // فحص الموضع قبل ما نضيف الرسائل (عشان نعرف هل auto-scroll مناسب)
      const wasAtBottom = isAtBottom();

      (data.new_messages || []).forEach(m => {
        if (!log) return;
        const line = document.createElement('div');
        line.className = `log-line log-${m.level}`;
        line.textContent = m.text;
        log.appendChild(line);
      });

      // auto-scroll فقط لو المستخدم في الأسفل أصلاً (يعني يتابع آخر السطور)
      // لو scrolled لأعلى ليقرأ، نُبقي مكانه ونُظهر زر النزول
      if (log && wasAtBottom && !userScrolledUp) {
        scrollToBottom();
      } else if (jumpBtn && !wasAtBottom) {
        jumpBtn.hidden = false;
      }

      if (data.status === 'success' || data.status === 'error') {
        evtSource.close();
        const footer = document.getElementById('progFooter');
        if (footer) footer.hidden = false;

        // refresh data in background so when user closes the modal the
        // new posts are already there
        (async () => {
          try {
            await loadIndex();
            await loadAllPages();
            await loadHistory();
            applyFilters();
            // تحديث فوري للكلمات المفتاحية لو المستخدم في تبويب keywords
            if (STATE.currentView === 'keywords' && typeof refreshKeywordsCounts === 'function') {
              refreshKeywordsCounts();
            }
          } catch {}
        })();

        const doneBtn = document.getElementById('progDoneBtn');
        if (doneBtn) {
          doneBtn.addEventListener('click', () => {
            closeModal();
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
          <div class="history-section-head">
            <h3>🔴 قيد التنفيذ (${active.length})</h3>
          </div>
          ${active.map(r => renderBackendRunRow(r, true)).join('')}
        </div>
      ` : ''}

      ${history.length ? `
        <div class="history-section">
          <div class="history-section-head">
            <h3>📜 آخر التشغيلات (${history.length})</h3>
            <button class="btn-refresh btn-sm btn-danger" id="clearHistoryBtn" type="button" title="حذف كل سجل العمليات">🗑 مسح السجل</button>
          </div>
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

  // زر "📋 التفاصيل" — يفتح modal بسجل الرسائل التفصيلي
  document.querySelectorAll('.run-detail-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const uid = btn.dataset.jobUid;
      if (uid) showJobDetailModal(uid);
    });
  });

  // Per-row delete in history
  document.querySelectorAll('.run-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const uid = btn.dataset.jobUid;
      if (!uid) return;
      if (!confirm('حذف هذا السطر من السجل؟')) return;
      btn.disabled = true;
      try {
        const r = await fetch(`/api/history/${encodeURIComponent(uid)}`, {
          method: 'DELETE', credentials: 'include',
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          // أزل السطر بدون reload كامل
          btn.closest('.run-row').style.opacity = '0';
          setTimeout(() => {
            btn.closest('.run-row').remove();
            showToast('تم حذف السطر', 'success');
          }, 200);
        } else {
          showToast(d.error || 'فشل الحذف', 'error');
          btn.disabled = false;
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  // Clear history button
  const clearBtn = document.getElementById('clearHistoryBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!confirm('هل أنت متأكد من مسح كل سجل العمليات؟ لا يمكن التراجع.')) return;
      clearBtn.disabled = true;
      clearBtn.textContent = '⏳ جاري المسح…';
      try {
        const res = await fetch('/api/history', { method: 'DELETE', credentials: 'include' });
        const d = await res.json().catch(() => ({}));
        if (res.ok) {
          showToast(`✅ تم حذف ${d.deleted || 0} سجل`, 'success');
          openHistoryModal();   // إعادة تحميل
        } else {
          showToast(d.error || 'فشل المسح', 'error');
          clearBtn.disabled = false;
          clearBtn.textContent = '🗑 مسح السجل';
        }
      } catch (e) {
        showToast('خطأ: ' + e.message, 'error');
        clearBtn.disabled = false;
        clearBtn.textContent = '🗑 مسح السجل';
      }
    });
  }
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

  const jobUid = r.id || r.job_uid;
  return `
    <div class="run-row ${isActive ? 'clickable' : ''}" data-job-uid="${escapeHtml(jobUid || '')}" ${isActive ? `data-job-id="${r.id}"` : ''}>
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
      <div class="run-row-actions">
        ${isActive
          ? '<span class="run-link">عرض التقدم ↑</span>'
          : (jobUid ? `<button class="btn-refresh btn-sm run-detail-btn" data-job-uid="${escapeHtml(jobUid)}" type="button" title="عرض السجل التفصيلي" onclick="event.stopPropagation()">📋 التفاصيل</button>` : '')
        }
        ${!isActive && jobUid ? `<button class="btn-icon-sm btn-danger run-delete-btn" data-job-uid="${escapeHtml(jobUid)}" type="button" title="حذف هذا السجل" onclick="event.stopPropagation()">×</button>` : ''}
      </div>
    </div>
  `;
}

// ====================================================================
// Job Detail Modal — يعرض الرسائل التفصيلية لعملية سحب منتهية
// ====================================================================

async function showJobDetailModal(jobUid) {
  if (!jobUid) return;
  // فتح modal بحالة loading
  openModal('📋 تفاصيل العملية', `
    <div class="job-detail-loading">
      <div class="spinner"></div>
      <p>جاري تحميل السجل…</p>
    </div>
  `, 'lg');

  let job = null;
  try {
    const res = await fetch(`/api/history/${encodeURIComponent(jobUid)}/detail`,
                            { credentials: 'include' });
    if (!res.ok) {
      els.modalBody.innerHTML = `<p class="note">فشل التحميل: HTTP ${res.status}</p>`;
      return;
    }
    const data = await res.json();
    job = data.run;
  } catch (e) {
    els.modalBody.innerHTML = `<p class="note">فشل: ${escapeHtml(e.message)}</p>`;
    return;
  }
  if (!job) {
    els.modalBody.innerHTML = '<p class="note">لم يتم العثور على هذه العملية.</p>';
    return;
  }

  const messages = Array.isArray(job.messages) ? job.messages : [];
  const statusMap = {
    queued: { label: '⏳ في الطابور', color: 'warn' },
    running: { label: '🔄 قيد التشغيل', color: 'warn' },
    success: { label: '✅ نجح', color: 'success' },
    error: { label: '❌ فشل', color: 'error' },
  };
  const s = statusMap[job.status] || { label: job.status, color: 'muted' };
  const params = job.params || {};
  const sources = job.sources_used || [];

  // تحضير سطور الـ log
  const logLines = messages.map(m => {
    const lvl = m.level || 'info';
    const txt = (m.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ts = m.time || m.t;  // tolerate both field names
    const tStr = ts ? formatTimeShort(ts) : '';
    return `<div class="log-line log-${lvl}"><span class="log-time">${tStr}</span>${txt}</div>`;
  }).join('');

  els.modalBody.innerHTML = `
    <div class="job-detail">
      <div class="job-detail-meta">
        <div class="meta-row">
          <span class="run-status ${s.color}">${s.label}</span>
          <span class="run-trigger">${job.trigger_source === 'schedule' ? '⏰ مجدول' : '👤 يدوي'}</span>
          <span class="run-time">${formatRelTime(job.started_at)}</span>
        </div>
        <div class="meta-row">
          <span><strong>${formatNum(job.new_posts || 0)}</strong> منشور جديد</span>
          <span>·</span>
          <span>${job.pages_success || 0}/${job.pages_total || 0} صفحة</span>
          <span>·</span>
          <span>⏱️ ${formatDuration(job.duration_seconds || 0)}</span>
          ${sources.length ? `<span>·</span><span>المصادر: ${sources.join(', ')}</span>` : ''}
        </div>
        ${params && Object.keys(params).length ? `
          <div class="meta-row meta-params">
            ${params.date_from ? `<span>📅 من: <code>${escapeHtml(params.date_from)}</code></span>` : ''}
            ${params.date_to ? `<span>إلى: <code>${escapeHtml(params.date_to)}</code></span>` : ''}
            ${params.slug ? `<span>صفحة: <code>${escapeHtml(params.slug)}</code></span>` : ''}
            ${Array.isArray(params.slugs) && params.slugs.length ? `<span>${params.slugs.length} صفحة محددة</span>` : ''}
          </div>
        ` : ''}
      </div>

      <div class="job-detail-toolbar">
        <strong>📜 سجل الرسائل (${messages.length})</strong>
        <div class="job-detail-tools">
          <button class="btn-refresh btn-sm" id="copyLogBtn" type="button">📋 نسخ السجل</button>
          <button class="btn-refresh btn-sm" id="downloadLogBtn" type="button">⬇️ تحميل</button>
        </div>
      </div>

      <div class="job-detail-log" id="jobDetailLog">
        ${messages.length ? logLines : '<p class="note">لا توجد رسائل محفوظة لهذه العملية.</p>'}
      </div>
    </div>
  `;

  // زر النسخ
  document.getElementById('copyLogBtn')?.addEventListener('click', async () => {
    const text = messages.map(m => `[${m.level || 'info'}] ${m.text || ''}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast('✅ تم نسخ السجل', 'success');
    } catch {
      showToast('فشل النسخ', 'error');
    }
  });
  // زر التحميل
  document.getElementById('downloadLogBtn')?.addEventListener('click', () => {
    const text = messages.map(m => {
      const ts = m.time || m.t;
      const tStr = ts ? new Date(ts).toLocaleString() : '';
      return `${tStr} [${m.level || 'info'}] ${m.text || ''}`;
    }).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marsad-log-${jobUid}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// helper: time HH:MM:SS من ISO أو ms timestamp
function formatTimeShort(t) {
  try {
    const d = (typeof t === 'number') ? new Date(t)
            : (typeof t === 'string') ? new Date(t)
            : null;
    if (!d || isNaN(d)) return '';
    return d.toTimeString().slice(0, 8);  // HH:MM:SS
  } catch { return ''; }
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
        <button class="btn-refresh btn-sm" id="importPagesJson" type="button" title="استيراد من Excel (.xlsx) أو CSV أو JSON">📥 استيراد</button>
        <button class="btn-refresh btn-sm" id="exportPagesXlsx" type="button" title="تصدير إلى Excel (.xlsx)">📊 تصدير Excel</button>
        <button class="btn-refresh btn-sm" id="exportPagesJson" type="button" title="تصدير إلى CSV">📤 تصدير CSV</button>
        <button class="btn-refresh btn-sm" id="downloadPagesTemplate" type="button" title="تحميل قالب فاضي (Excel)">📋 قالب</button>
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
        <button class="btn-trigger btn-full" id="savePagesLocal" type="button">💾 حفظ كل التغييرات</button>
      </div>

      <p class="note">
        <strong>💡 الاستيراد من Excel:</strong> صدّر القالب، افتحه في Excel، عبّي الأعمدة
        (عدد المتابعين، اسم الصفحة، City، NumberOfPost، Page Link) بأي ترتيب،
        احفظه (.xlsx أو CSV)، ثم استورده هنا. كل الصفحات تُحفظ في قاعدة بيانات السيرفر مباشرة.
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
            <span class="page-meta-max" title="عدد المنشورات (0 = بالتاريخ)">🎯 ${page.max_posts ? page.max_posts : 'بالتاريخ'}</span>
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
            <label class="filter-label">عدد المنشورات (اتركه فارغاً للسحب بالتاريخ)</label>
            <input type="number" class="input page-max-posts" min="0" max="1000" placeholder="مثلاً 30 — أو فارغ"
                   value="${page.max_posts ? page.max_posts : ''}">
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
    const toggle = () => {
      const row = head.closest('.page-row');
      row.classList.toggle('expanded');
      const body = row.querySelector('.page-row-body');
      if (body) body.hidden = !row.classList.contains('expanded');
      const chev = row.querySelector('.chev');
      if (chev) chev.style.transform = row.classList.contains('expanded') ? 'rotate(180deg)' : '';
    };
    const clickHandler = (e) => {
      // ignore clicks on action buttons (test/delete) + checkbox/switch
      if (e.target.closest('.btn-test, .page-delete, .switch, input')) return;
      toggle();
    };
    head.addEventListener('click', clickHandler);
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
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
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const row = e.target.closest('.page-row');
      const index = parseInt(row.dataset.index);
      const page = STATE.pagesConfig[index];
      if (!page) return;
      const slug = page.slug || '';
      const name = page.name || slug || 'الصفحة';

      // dialog مخصّص: حذف الصفحة فقط، أو حذف الصفحة + المنشورات
      const choice = await _showDeletePageChoice(name);
      if (!choice) return;     // cancel

      // لو الصفحة موجودة في الـ DB (لها slug)، احذفها بـ API call مباشر
      // عشان نحذف منشوراتها لو طلب المستخدم. إذا الصفحة مجرد draft
      // محلية (ما لها slug)، فقط احذفها من الـ STATE.
      if (slug && STATE.hasBackend) {
        try {
          const url = `/api/pages/${encodeURIComponent(slug)}` +
                      (choice === 'with-posts' ? '?with_posts=1' : '');
          const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            showToast(data.error || 'فشل الحذف', 'error');
            return;
          }
          const msg = choice === 'with-posts'
            ? `تم حذف "${name}" + ${data.deleted_posts || 0} منشور`
            : `تم حذف "${name}"`;
          showToast(msg, 'success');
        } catch (err) {
          showToast('خطأ: ' + err.message, 'error');
          return;
        }
      }

      // أزلها من الـ state أيضاً
      syncPagesFromUI();
      STATE.pagesConfig.splice(index, 1);
      openPagesModal();
    });
  });

  // ===== CSV export =====
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

  // ===== XLSX export (real Excel binary) =====
  document.getElementById('exportPagesXlsx')?.addEventListener('click', async () => {
    syncPagesFromUI();
    if (STATE.pagesConfig.length === 0) {
      showToast('لا توجد صفحات للتصدير', 'error');
      return;
    }
    try {
      showToast('⏳ جاري تحميل مكتبة Excel…', 'info');
      await loadXLSXLib();
      pagesToXlsx(STATE.pagesConfig, `pages_${new Date().toISOString().slice(0, 10)}.xlsx`);
      showToast(`تم تصدير ${STATE.pagesConfig.length} صفحة كـ Excel (.xlsx)`, 'success');
    } catch (err) {
      showToast('فشل التصدير: ' + err.message, 'error');
    }
  });

  // ===== Import from XLSX / CSV / JSON =====
  document.getElementById('importPagesJson').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv,.tsv,.txt,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const fname = file.name.toLowerCase();
        let pages = [];

        if (fname.endsWith('.xlsx') || fname.endsWith('.xls')) {
          showToast('⏳ جاري تحميل مكتبة Excel…', 'info');
          await loadXLSXLib();
          const buffer = await file.arrayBuffer();
          pages = xlsxToPages(buffer);
        } else if (fname.endsWith('.json')) {
          const text = await file.text();
          const data = JSON.parse(text);
          pages = Array.isArray(data) ? data : (data.pages || []);
        } else {
          // CSV / TSV / TXT
          const text = await file.text();
          if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
            const data = JSON.parse(text);
            pages = Array.isArray(data) ? data : (data.pages || []);
          } else {
            pages = csvToPages(text);
          }
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

  document.getElementById('savePagesLocal').addEventListener('click', async (e) => {
    syncPagesFromUI();
    const btn = e.currentTarget;
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '⏳ جاري الحفظ…';
    try {
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pages: STATE.pagesConfig }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(`✅ تم حفظ ${data.count || STATE.pagesConfig.length} صفحة في قاعدة البيانات`, 'success');
        // مزامنة الـ STATE من السيرفر للحصول على slugs النهائية + ids
        await loadPagesConfig();
      } else if (res.status === 401) {
        showToast('انتهت الجلسة - أعد تسجيل الدخول', 'error');
      } else {
        showToast(data.error || 'فشل الحفظ', 'error');
      }
    } catch (err) {
      showToast('خطأ في الاتصال: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  // (GitHub save removed — pages now persist directly to MySQL via /api/pages)

  // === Download empty Excel template ===
  const tplBtn = document.getElementById('downloadPagesTemplate');
  if (tplBtn) {
    tplBtn.addEventListener('click', async () => {
      const sample = [
        { name: 'تلفزيون فلسطين', city: 'عام', followers: 6218372, max_posts: 45,
          url: 'https://www.facebook.com/PalestineTV', slug: '', source: 'auto', enabled: true },
        { name: 'وكالة وفا', city: 'عام', followers: 795113, max_posts: 40,
          url: 'https://www.facebook.com/wafagency', slug: '', source: 'auto', enabled: true },
      ];
      try {
        showToast('⏳ جاري تحميل مكتبة Excel…', 'info');
        await loadXLSXLib();
        pagesToXlsx(sample, 'pages_template.xlsx');
        showToast('تم تنزيل القالب — افتحه في Excel، املأ البيانات، ثم استورده', 'success');
      } catch (err) {
        // Fallback: CSV
        const csv = pagesToCsv(sample);
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pages_template.csv';
        a.click();
        URL.revokeObjectURL(url);
        showToast('تم تنزيل قالب CSV (تعذّر تحميل مكتبة Excel)', 'warn');
      }
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
    // 0 / فارغ = اعتمد على التاريخ. غير ذلك → عدد المنشورات.
    const maxRaw = row.querySelector('.page-max-posts').value.trim();
    page.max_posts = maxRaw === '' ? 0 : (parseInt(maxRaw) || 0);
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

// Aliases عشان نتعرف على الأعمدة حتى لو الـ Excel غيّر التسمية.
// نستخدم exact-match على header مُطبَّع (lowercase + trimmed + بدون whitespace زائد).
const HEADER_ALIASES = {
  followers: [
    'عدد المتابعين', 'followers', 'follower', 'fans', 'متابعين',
    'followerscount', 'followers_count', 'follower count', 'follower_count',
    'subscribers', 'مشتركين',
  ],
  name: [
    'اسم الصفحة', 'name', 'page name', 'page_name', 'pagename', 'الاسم',
    'page title', 'title',
  ],
  city: [
    'city', 'المدينة', 'مدينة', 'المنطقة', 'منطقة', 'الموقع', 'location',
  ],
  max_posts: [
    'numberofpost', 'number of post', 'numberofposts', 'number of posts',
    'max_posts', 'maxposts', 'max posts', 'عدد المنشورات', 'حد المنشورات',
    'post count', 'posts',
  ],
  url: [
    'page link', 'pagelink', 'page_link', 'page url', 'page_url',
    'url', 'link', 'الرابط', 'رابط الصفحة', 'رابط', 'fb link', 'rss',
    'feed url', 'feed', 'rss url',
  ],
  slug: [
    'slug', 'id', 'كود', 'كود الصفحة',
  ],
  source: [
    'source', 'المصدر', 'مصدر', 'المصدر/source',
  ],
  enabled: [
    'enabled', 'مفعل', 'مفعّل', 'active', 'الحالة', 'حالة',
  ],
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
  const aliases = (HEADER_ALIASES[fieldKey] || []).map(a => _norm(a));
  // 1) exact match أولاً (الأكثر دقة)
  for (let i = 0; i < headers.length; i++) {
    if (aliases.includes(_norm(headers[i]))) return i;
  }
  // 2) substring match (لكن نقيد بـ aliases طولها 4+ chars عشان نتجنب false positives
  //    مثل alias='page' يطابق header='Page Link' وهو URL مش name)
  for (let i = 0; i < headers.length; i++) {
    const h = _norm(headers[i]);
    if (aliases.some(a => a.length >= 4 && h.includes(a))) return i;
  }
  return -1;
}

function _norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// ==================== XLSX export ====================
/**
 * يكتب workbook بنفس ترتيب الأعمدة في صورة الإكسل الأصلية
 * ويفعّل الـ RTL على الورقة عشان Excel يفتحها يميناً.
 */
function pagesToXlsx(pages, filename) {
  if (!window.XLSX) throw new Error('XLSX library not loaded');
  const aoa = [
    CSV_HEADERS_AR,
    ...pages.map(p => [
      p.followers || 0,
      p.name || '',
      p.city || '',
      p.max_posts || 30,
      p.url || '',
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // RTL view
  if (!ws['!views']) ws['!views'] = [{}];
  ws['!views'][0].RTL = true;
  // Column widths
  ws['!cols'] = [
    { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 50 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'الصفحات');
  XLSX.writeFile(wb, filename);
}

// ==================== XLSX import (lazy-load SheetJS) ====================
let _xlsxLoadPromise = null;

function loadXLSXLib() {
  if (window.XLSX) return Promise.resolve();
  if (_xlsxLoadPromise) return _xlsxLoadPromise;
  _xlsxLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // مكتبة SheetJS - نسخة community مجانية
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      _xlsxLoadPromise = null;
      reject(new Error('فشل تحميل مكتبة Excel - تحقق من الاتصال بالإنترنت'));
    };
    document.head.appendChild(s);
  });
  return _xlsxLoadPromise;
}

/**
 * يحوّل buffer لـ xlsx إلى array of {col_header: value} ثم يطبّق
 * نفس HEADER_ALIASES الموجود لـ CSV. هذا يعني أن الـ xlsx يقبل
 * نفس الأسماء بأي ترتيب (بالعربي أو الإنجليزي).
 */
function xlsxToPages(buffer) {
  if (!window.XLSX) throw new Error('XLSX library not loaded');
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('الملف لا يحوي أي ورقة (sheet)');
  const sheet = wb.Sheets[sheetName];

  // sheet_to_json with header:1 returns array of arrays — أسهل للتعامل معه
  // مع تنوّع الأعمدة بدون افتراض أن الـ header في الصف الأول دائماً
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
  if (!aoa.length) return [];

  // خذ أول صف فيه أكثر من خلية فيها نص → headers
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(aoa.length, 5); i++) {
    const nonEmpty = aoa[i].filter(c => String(c).trim()).length;
    if (nonEmpty >= 2) { headerRowIdx = i; break; }
  }

  const headers = (aoa[headerRowIdx] || []).map(h => String(h).trim());
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

  if (idx.name === -1 && idx.url === -1) {
    throw new Error('لم نجد عمود "اسم الصفحة" أو "Page Link" في الإكسل. تأكد من أن أسماء الأعمدة موجودة في أول صف.');
  }

  const pages = [];
  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || !row.some(c => String(c).trim())) continue;   // skip فاضي
    const get = (k) => idx[k] !== -1 ? String(row[idx[k]] ?? '').trim() : '';

    const name = get('name');
    const url = get('url');
    if (!url && !name) continue;

    const followersRaw = get('followers').replace(/[,\s]/g, '');
    const enabledRaw = get('enabled').toLowerCase();

    pages.push({
      name: name || '(بدون اسم)',
      url,
      slug: get('slug') || slugify(name, url),
      city: get('city'),
      followers: parseInt(followersRaw) || 0,
      max_posts: parseInt(get('max_posts')) || 30,
      source: get('source') || 'auto',
      enabled: idx.enabled === -1 ? true
                                  : !['0','no','false','لا','معطل','disabled'].includes(enabledRaw),
    });
  }
  return pages;
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

  // عرض كل الميديا - الفيديو يشتغل داخل المنصة لو رابط mp4،
  // والصور تفتح في lightbox داخلي.
  const renderMediaItem = (m, idx) => {
    const url = m.url || '';
    const proxied = proxyMediaUrl(url);
    if (m.type === 'video') {
      if (isPlayableVideoUrl(url)) {
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
      // FB reel/watch URL - ما نقدر نشغّله inline. نعرض thumbnail (إن وُجد)
      // مع زر فيسبوك
      const poster = m.thumbnail ? proxyMediaUrl(m.thumbnail) : '';
      return `
        <a href="${escapeHtml(ensureFullFbUrl(url))}" target="_blank" rel="noopener noreferrer"
           class="media-item video-external" title="مشاهدة على فيسبوك">
          ${poster
            ? `<img src="${escapeHtml(poster)}" alt="" loading="lazy">`
            : '<div class="video-ext-bg"></div>'
          }
          <span class="play-overlay"></span>
          <span class="video-ext-label">▶ شاهد على فيسبوك</span>
        </a>
      `;
    }
    // Image — فتح في lightbox داخلي
    return `
      <button type="button" class="media-item media-image" data-lightbox-idx="${idx}">
        <img src="${escapeHtml(proxied)}" alt="" loading="lazy"
             onerror="this.parentElement.classList.add('broken')">
      </button>
    `;
  };

  const mediaHtml = media.length
    ? `<div class="detail-section">
         <h3>📎 الميديا (${media.length})</h3>
         <div class="detail-media-grid">
           ${media.map((m, i) => renderMediaItem(m, i)).join('')}
         </div>
       </div>`
    : (post.image_url
      ? `<div class="detail-section">
           <h3>📎 الميديا</h3>
           <div class="detail-media-grid">
             <button type="button" class="media-item media-image" data-lightbox-idx="0">
               <img src="${escapeHtml(proxyMediaUrl(post.image_url))}" alt="" loading="lazy">
             </button>
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

  // Image lightbox: clicking any media-image opens internal viewer
  const galleryImages = (media.length ? media : (post.image_url ? [{url: post.image_url, type: 'image'}] : []))
    .filter(m => m.type === 'image' || (m.type !== 'video' && m.url))
    .map(m => m.url);
  document.querySelectorAll('.media-image[data-lightbox-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const allImgs = (media.length ? media : (post.image_url ? [{url: post.image_url, type: 'image'}] : []))
        .map(m => m.url);
      const idx = parseInt(btn.dataset.lightboxIdx) || 0;
      // فلترة فقط على الصور (نخلي ترتيب lightbox مطابق لـ media list)
      openLightbox(allImgs, idx, post.text);
    });
  });

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
    <div class="analytics-wrapper" id="analyticsWrapper">
      <div class="analytics-header">
        <div class="analytics-header-text">
          <h2>📊 الإحصاءات والتحليلات${isFiltered ? ' <span class="filter-chip">🔍 نتائج الفلتر</span>' : ''}</h2>
          <p class="analytics-sub">${isFiltered ? 'الأرقام تعكس الفلاتر النشطة في الأعلى. عدّل الفلاتر وسيتم تحديث الإحصائيات.' : 'الأرقام لكل المنشورات. استخدم الفلاتر في الأعلى لتضييق النطاق.'}</p>
        </div>
        <div class="analytics-header-actions" data-no-print>
          <button class="btn-trigger btn-sm" id="exportAnalyticsPdfBtn" type="button" title="تصدير الإحصائيات كـ PDF">📄 PDF</button>
          <button class="btn-refresh btn-sm" id="printAnalyticsBtn" type="button" title="طباعة">🖨 طباعة</button>
        </div>
      </div>
      <div class="analytics-stamp" data-print-only>
        تم التوليد: ${new Date().toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'long', timeStyle: 'short' })} · مَرصَد
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

  // Print
  document.getElementById('printAnalyticsBtn')?.addEventListener('click', () => {
    document.body.classList.add('printing-analytics');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-analytics'), 500);
  });

  // PDF export (lazy-load html2pdf)
  document.getElementById('exportAnalyticsPdfBtn')?.addEventListener('click', exportAnalyticsAsPdf);
}

// ==================== Analytics PDF export ====================
let _html2pdfLoadPromise = null;
function loadHtml2PdfLib() {
  if (window.html2pdf) return Promise.resolve();
  if (_html2pdfLoadPromise) return _html2pdfLoadPromise;
  _html2pdfLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      _html2pdfLoadPromise = null;
      reject(new Error('فشل تحميل مكتبة PDF — تحقق من الاتصال بالإنترنت'));
    };
    document.head.appendChild(s);
  });
  return _html2pdfLoadPromise;
}

async function exportAnalyticsAsPdf() {
  const btn = document.getElementById('exportAnalyticsPdfBtn');
  if (!btn) return;
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ جاري التحميل…';

  try {
    showToast('⏳ جاري تحميل مكتبة PDF…', 'info');
    await loadHtml2PdfLib();

    const wrapper = document.getElementById('analyticsWrapper');
    if (!wrapper) throw new Error('Analytics view not rendered');

    btn.textContent = '⏳ جاري إنشاء الـ PDF…';

    // hide print-hidden elements during capture
    document.body.classList.add('exporting-pdf');

    const filename = `marsad_analytics_${new Date().toISOString().slice(0, 10)}.pdf`;
    const opts = {
      margin: [10, 10, 10, 10],
      filename,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait',
      },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    };

    await html2pdf().set(opts).from(wrapper).save();
    showToast('✅ تم تصدير PDF', 'success');
  } catch (e) {
    showToast('فشل التصدير: ' + e.message, 'error');
  } finally {
    document.body.classList.remove('exporting-pdf');
    btn.disabled = false;
    btn.textContent = orig;
  }
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
  // pagination تظهر فقط في view المنشورات
  const pgBar = document.getElementById('postsPagination');
  if (pgBar) pgBar.hidden = view !== 'posts';
  // results-meta أيضاً مخصص للمنشورات فقط
  const resultsMeta = document.querySelector('.results-meta');
  if (resultsMeta) resultsMeta.hidden = view !== 'posts';
  if (view === 'analytics') {
    renderAnalyticsView();
  }
  if (view === 'keywords') {
    renderKeywordsView();
    startKeywordsPolling();
  } else {
    stopKeywordsPolling();
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
        <button class="settings-tab" data-tab="account">👤 الحساب</button>
        ${AUTH && AUTH.user && AUTH.user.role === 'admin' ? `
          <button class="settings-tab" data-tab="users">👥 المستخدمون</button>
        ` : ''}
      </div>

      <div id="settings-sources" class="settings-pane">
        ${renderSourcesSettings(sources)}
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
    });
  });

  bindSourceCards();
  bindAccountSettings();
}

// ========= Schedules — own dedicated modal (not inside Settings) =========
async function openSchedulesModal() {
  openModal('🕐 المجدول · جدولة تلقائية', `
    <div id="schedulesModalBody">
      <div class="loading"><div class="spinner"></div></div>
    </div>
  `, 'lg');
  await loadSchedulesIntoModal();
}

async function loadSchedulesIntoModal() {
  const pane = document.getElementById('schedulesModalBody');
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

// ========= Schedules =========

async function loadSchedulesTab() {
  // Backward-compat: now uses the dedicated schedulesModalBody.
  // Routes any old caller (after add/edit refresh) through the modal loader.
  await loadSchedulesIntoModal();
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
          <option value="1440" ${s.interval_minutes === 1440 ? 'selected' : ''}>كل يوم (يجب تحديد الساعة)</option>
          <option value="10080" ${s.interval_minutes === 10080 ? 'selected' : ''}>كل أسبوع (يجب تحديد اليوم والساعة)</option>
          <option value="custom" ${(s.interval_minutes && ![60,180,360,720,1440,10080].includes(s.interval_minutes)) ? 'selected' : ''}>مخصّص (عدد ساعات)</option>
        </select>

        <!-- Custom: hours -->
        <div id="schedIntervalCustomWrap" class="schedule-interval-detail" hidden>
          <label class="filter-label">عدد الساعات بين كل تشغيل</label>
          <input type="number" id="schedIntervalCustomHours" class="input"
                 placeholder="مثلاً: 4"
                 min="1" max="720"
                 value="${s.interval_minutes && ![60,180,360,720,1440,10080].includes(s.interval_minutes)
                          ? Math.round(s.interval_minutes / 60) : ''}">
        </div>

        <!-- Daily: time of day -->
        <div id="schedDailyWrap" class="schedule-interval-detail" hidden>
          <label class="filter-label">الساعة (24 ساعة)</label>
          <input type="time" id="schedDailyTime" class="input" value="${s.run_at_time || '08:00'}">
        </div>

        <!-- Weekly: day + time -->
        <div id="schedWeeklyWrap" class="schedule-interval-detail" hidden>
          <div class="form-inline" style="gap:8px">
            <div style="flex:1">
              <label class="filter-label">اليوم</label>
              <select id="schedWeeklyDay" class="select">
                <option value="0" ${s.run_at_dow === 0 ? 'selected' : ''}>الأحد</option>
                <option value="1" ${s.run_at_dow === 1 ? 'selected' : ''}>الإثنين</option>
                <option value="2" ${s.run_at_dow === 2 ? 'selected' : ''}>الثلاثاء</option>
                <option value="3" ${s.run_at_dow === 3 ? 'selected' : ''}>الأربعاء</option>
                <option value="4" ${s.run_at_dow === 4 ? 'selected' : ''}>الخميس</option>
                <option value="5" ${s.run_at_dow === 5 ? 'selected' : ''}>الجمعة</option>
                <option value="6" ${s.run_at_dow === 6 ? 'selected' : ''}>السبت</option>
              </select>
            </div>
            <div style="flex:1">
              <label class="filter-label">الساعة</label>
              <input type="time" id="schedWeeklyTime" class="input" value="${s.run_at_time || '08:00'}">
            </div>
          </div>
        </div>
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

  // Interval-specific detail panels: custom (hours), daily (time), weekly (day + time)
  const intervalSel = document.getElementById('schedInterval');
  const customWrap  = document.getElementById('schedIntervalCustomWrap');
  const dailyWrap   = document.getElementById('schedDailyWrap');
  const weeklyWrap  = document.getElementById('schedWeeklyWrap');

  function refreshIntervalUI() {
    const v = intervalSel.value;
    customWrap.hidden = v !== 'custom';
    dailyWrap.hidden  = v !== '1440';
    weeklyWrap.hidden = v !== '10080';
  }
  intervalSel.addEventListener('change', refreshIntervalUI);
  refreshIntervalUI();   // initial

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
    let runAtTime = null;       // "HH:MM" — لـ daily و weekly
    let runAtDow = null;        // 0-6 — لـ weekly فقط

    const v = intervalSel.value;
    if (v === 'custom') {
      const customHoursVal = parseInt(document.getElementById('schedIntervalCustomHours').value);
      if (!customHoursVal || customHoursVal < 1) {
        errEl.textContent = 'أدخل عدد الساعات (رقم > 0)';
        errEl.hidden = false;
        return;
      }
      intervalMinutes = customHoursVal * 60;
    } else if (v === '1440') {
      // daily — يحتاج وقت
      const t = document.getElementById('schedDailyTime').value;
      if (!t) { errEl.textContent = 'حدد الساعة'; errEl.hidden = false; return; }
      runAtTime = t;
      intervalMinutes = 1440;
    } else if (v === '10080') {
      // weekly — يحتاج يوم + ساعة
      const t = document.getElementById('schedWeeklyTime').value;
      const d = document.getElementById('schedWeeklyDay').value;
      if (!t) { errEl.textContent = 'حدد الساعة'; errEl.hidden = false; return; }
      if (d === '' || d === null) { errEl.textContent = 'حدد اليوم'; errEl.hidden = false; return; }
      runAtTime = t;
      runAtDow = parseInt(d);
      intervalMinutes = 10080;
    } else {
      intervalMinutes = parseInt(v);
    }
    if (intervalMinutes < 15) intervalMinutes = 15;

    const allSelected = allCheck.checked;
    const selectedPages = allSelected ? [] :
      Array.from(document.querySelectorAll('.schedule-page-check:checked')).map(c => c.value);

    const body = {
      name,
      enabled: sched ? sched.enabled : true,
      interval_minutes: intervalMinutes,
      run_at_time: runAtTime,        // null لو مش daily/weekly
      run_at_dow:  runAtDow,         // null لو مش weekly
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
        <button class="btn-trigger btn-sm" data-action="impersonate" title="ادخل كهذا المستخدم لمتابعة بياناته" ${isSelf ? 'disabled' : ''}>👁 دخول كهذا</button>
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
    else if (action === 'impersonate') {
      if (!confirm(`الدخول كحساب "${uname}"؟ ستشاهد بياناته وصفحاته كأنك هو. تقدر ترجع لحسابك في أي وقت من الـ banner.`)) return;
      try {
        const r = await fetch(`/api/admin/users/${uid}/impersonate`, {
          method: 'POST', credentials: 'include',
        });
        const d = await r.json();
        if (!r.ok) {
          showToast(d.error || 'فشل الدخول', 'error');
          return;
        }
        showToast(`تم الدخول كحساب "${uname}" — جاري إعادة التحميل…`, 'success');
        setTimeout(() => location.reload(), 600);
      } catch (e) {
        showToast('خطأ: ' + e.message, 'error');
      }
    }
  });
}

// ==================== Impersonation banner ====================

async function checkImpersonationBanner() {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    if (!r.ok) return;
    const d = await r.json();
    if (d && d.impersonating && d.impersonator) {
      _showImpersonationBanner(d.user, d.impersonator);
    } else {
      _hideImpersonationBanner();
    }
  } catch {}
}

function _showImpersonationBanner(asUser, byAdmin) {
  let banner = document.getElementById('impersonationBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'impersonationBanner';
    banner.className = 'impersonation-banner';
    document.body.insertBefore(banner, document.body.firstChild);
  }
  banner.innerHTML = `
    <div class="imp-content">
      <span class="imp-icon" aria-hidden="true">👁</span>
      <span class="imp-text">
        أنت داخل كحساب <strong>@${escapeHtml(asUser.username)}</strong>
        (المُشرف الأصلي: <strong>@${escapeHtml(byAdmin.username)}</strong>)
      </span>
      <button class="imp-stop-btn" type="button" id="impStopBtn">
        ↩ العودة لحسابي
      </button>
    </div>
  `;
  document.body.classList.add('is-impersonating');

  document.getElementById('impStopBtn').addEventListener('click', async () => {
    try {
      const r = await fetch('/api/admin/stop-impersonating', {
        method: 'POST', credentials: 'include',
      });
      const d = await r.json();
      if (r.ok) {
        showToast('عُدت إلى حسابك — جاري إعادة التحميل…', 'success');
        setTimeout(() => location.reload(), 600);
      } else {
        showToast(d.error || 'فشل', 'error');
      }
    } catch (e) {
      showToast('خطأ: ' + e.message, 'error');
    }
  });
}

function _hideImpersonationBanner() {
  const banner = document.getElementById('impersonationBanner');
  if (banner) banner.remove();
  document.body.classList.remove('is-impersonating');
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
  // (page/source/postType + quick filters: handled inside multiselects)
  setupMultiselects();
  // populate page list from STATE.pagesConfig (already loaded by init)
  populatePageFilterMultiselect();
  // restore selection after multiselects are set up
  syncMultiselectCheckboxesFromState();

  els.sortFilter.addEventListener('change', applyFilters);
  els.searchInput.addEventListener('input', debounce(applyFilters, 300));
  els.dateFrom.addEventListener('change', applyFilters);
  els.dateTo.addEventListener('change', applyFilters);
  els.minReactions.addEventListener('input', debounce(applyFilters, 300));
  els.maxReactions?.addEventListener('input', debounce(applyFilters, 300));
  els.minComments.addEventListener('input', debounce(applyFilters, 300));
  // quick filter checkboxes are inside the multiselect — listeners attached there
  els.resetFilters.addEventListener('click', resetAllFilters);

  // Quick range buttons
  document.querySelectorAll('.btn-quick-range').forEach(btn => {
    btn.addEventListener('click', () => applyQuickRange(btn.dataset.range));
  });

  // View layout toggle (cards / list)
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const layout = btn.dataset.layout;
      STATE.postsLayout = layout;
      try { localStorage.setItem('marsad_layout', layout); } catch {}
      document.querySelectorAll('.layout-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderPosts();
    });
  });
  // Restore last layout
  try {
    const saved = localStorage.getItem('marsad_layout');
    if (saved === 'list') {
      STATE.postsLayout = 'list';
      document.querySelectorAll('.layout-btn').forEach(b => b.classList.toggle('active', b.dataset.layout === 'list'));
    }
  } catch {}

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
  // History/Settings/Pages/Media now live in the user dropdown — bound below.

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

  const menuManagePages = document.getElementById('menuManagePages');
  if (menuManagePages) {
    menuManagePages.addEventListener('click', () => openPagesModal());
  }

  const menuMediaLibrary = document.getElementById('menuMediaLibrary');
  if (menuMediaLibrary) {
    menuMediaLibrary.addEventListener('click', () => openMediaLibrary());
  }

  // History + Settings + Schedules in user menu
  const menuHistory = document.getElementById('menuHistory');
  if (menuHistory) {
    menuHistory.addEventListener('click', () => openHistoryModal());
  }

  const menuSettings = document.getElementById('menuSettings');
  if (menuSettings) {
    menuSettings.addEventListener('click', () => openSettingsModal());
  }

  const menuSchedules = document.getElementById('menuSchedules');
  if (menuSchedules) {
    menuSchedules.addEventListener('click', () => openSchedulesModal());
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

// ====================================================================
// Keywords (الكلمات المفتاحية) — view & detail
// ====================================================================

let _keywordsCache = null;
let _activeKeywordId = null;
let _keywordsPollTimer = null;
const KEYWORDS_POLL_INTERVAL_MS = 15000;  // 15 ثانية

async function renderKeywordsView() {
  const pane = document.getElementById('keywordsView');
  if (!pane) return;

  pane.innerHTML = '<div class="loading"><div class="spinner"></div><p>جاري التحميل…</p></div>';

  try {
    const res = await fetch('/api/keywords', { credentials: 'include' });
    const data = await res.json();
    _keywordsCache = data.keywords || [];
  } catch (e) {
    pane.innerHTML = `<p class="note">فشل التحميل: ${escapeHtml(e.message)}</p>`;
    return;
  }

  if (_activeKeywordId) {
    const kw = _keywordsCache.find(k => k.id === _activeKeywordId);
    if (kw) {
      await _renderKeywordDetail(pane, kw);
      return;
    }
    _activeKeywordId = null;
  }

  _renderKeywordsList(pane);
}

// ----- Polling: تحديث match_count تلقائياً كل 15 ثانية ------------------
// يحدّث القيم على الـ cards الموجودة بدون re-render كامل عشان ما يقطع تفاعل
// المستخدم (مثل إذا كان يكتب في input). يتوقف عند مغادرة التبويب.

function startKeywordsPolling() {
  stopKeywordsPolling();  // safety
  _keywordsPollTimer = setInterval(refreshKeywordsCounts, KEYWORDS_POLL_INTERVAL_MS);
}

function stopKeywordsPolling() {
  if (_keywordsPollTimer) {
    clearInterval(_keywordsPollTimer);
    _keywordsPollTimer = null;
  }
}

async function refreshKeywordsCounts() {
  // لو المستخدم انتقل لـ view آخر، نوقف
  if (STATE.currentView !== 'keywords') {
    stopKeywordsPolling();
    return;
  }
  // لو في detail view مفتوح، نسكب
  if (_activeKeywordId) return;

  try {
    const res = await fetch('/api/keywords', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    const newKws = data.keywords || [];
    _keywordsCache = newKws;

    // تحديث match_count على cards الموجودة بدون re-render
    let listChanged = false;
    newKws.forEach(kw => {
      const card = document.querySelector(`.kw-card[data-id="${kw.id}"]`);
      if (!card) {
        listChanged = true;  // كلمة جديدة أُضيفت من جلسة أخرى
        return;
      }
      const numEl = card.querySelector('.kw-stat-num');
      if (numEl) {
        const oldVal = parseInt(numEl.dataset.value || '0');
        const newVal = kw.match_count || 0;
        if (oldVal !== newVal) {
          numEl.textContent = formatNum(newVal);
          numEl.dataset.value = String(newVal);
          // فلاش بصري عند التغيير (يومض بريقة برتقالية)
          numEl.classList.remove('kw-num-flash');
          void numEl.offsetWidth;  // reflow عشان animation تشتغل من جديد
          numEl.classList.add('kw-num-flash');
        }
      }
    });

    // عدد الكلمات في DOM vs server — لو تغير، reload كامل
    const cardsInDom = document.querySelectorAll('.kw-card').length;
    if (listChanged || cardsInDom !== newKws.length) {
      const pane = document.getElementById('keywordsView');
      if (pane && !_activeKeywordId) {
        _renderKeywordsList(pane);
      }
      return;
    }

    // تحديث الإجمالي
    const totalEl = document.querySelector('.kw-summary-item[data-total-matches] strong');
    if (totalEl) {
      const total = newKws.reduce((s, k) => s + (k.match_count || 0), 0);
      totalEl.textContent = formatNum(total);
    }
  } catch (e) {
    // silent fail — polling يكمل لاحقاً
  }
}

function _renderKeywordsList(pane) {
  const kws = _keywordsCache || [];
  const totalMatches = kws.reduce((s, k) => s + (k.match_count || 0), 0);

  pane.innerHTML = `
    <div class="kw-wrapper">
      <div class="kw-header">
        <div class="kw-header-text">
          <h2>🔑 الكلمات المفتاحية</h2>
          <p class="analytics-sub">احفظ كلمات أو هاشتاقات تهمك. النظام يحسب تلقائياً عدد المنشورات اللي تطابقها وإحصائيات تفصيلية.</p>
        </div>
        <div class="kw-summary">
          <span class="kw-summary-item"><strong>${formatNum(kws.length)}</strong> كلمة</span>
          <span class="kw-summary-item" data-total-matches><strong>${formatNum(totalMatches)}</strong> مطابقة إجمالية</span>
          <span class="kw-live-indicator" title="تحديث تلقائي كل 15 ثانية">● مباشر</span>
        </div>
      </div>

      <form class="kw-add-form" id="kwAddForm">
        <input type="text" id="kwAddText" class="input" placeholder="أضف كلمة أو هاشتاق (مثلاً: غزة، فلسطين، الأقصى)" maxlength="200" required>
        <select id="kwAddMode" class="select">
          <option value="contains">يحتوي</option>
          <option value="hashtag">هاشتاق</option>
          <option value="exact">مطابق تماماً</option>
        </select>
        <button class="btn-trigger" type="submit">+ إضافة</button>
      </form>

      ${kws.length === 0 ? `
        <div class="empty-state" style="margin-top:2rem">
          <span class="empty-icon">🔑</span>
          <h4>لا توجد كلمات مفتاحية بعد</h4>
          <p>أضف أول كلمة في النموذج أعلاه لتبدأ الرصد التلقائي.</p>
        </div>
      ` : `
        <div class="kw-grid">
          ${kws.map(k => _renderKeywordCard(k)).join('')}
        </div>
      `}
    </div>
  `;

  document.getElementById('kwAddForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = document.getElementById('kwAddText').value.trim();
    const mode = document.getElementById('kwAddMode').value;
    if (!text) return;
    try {
      const res = await fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text, match_mode: mode }),
      });
      const d = await res.json();
      if (!res.ok) {
        showToast(d.error || 'فشل الإضافة', 'error');
        return;
      }
      showToast(`✅ تمت إضافة "${text}"`, 'success');
      renderKeywordsView();
    } catch (err) {
      showToast('خطأ: ' + err.message, 'error');
    }
  });

  pane.querySelectorAll('.kw-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.kw-card-actions')) return;
      const id = parseInt(card.dataset.id);
      if (id) {
        _activeKeywordId = id;
        renderKeywordsView();
      }
    });
  });

  pane.querySelectorAll('.kw-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const kw = _keywordsCache.find(k => k.id === id);
      if (!confirm(`حذف الكلمة "${kw ? kw.text : ''}"؟`)) return;
      try {
        const res = await fetch(`/api/keywords/${id}`, { method: 'DELETE', credentials: 'include' });
        if (res.ok) {
          showToast('تم الحذف', 'success');
          renderKeywordsView();
        } else {
          showToast('فشل الحذف', 'error');
        }
      } catch (err) {
        showToast('خطأ: ' + err.message, 'error');
      }
    });
  });
}

function _renderKeywordCard(k) {
  const modeLabel = { contains: 'يحتوي', exact: 'مطابق', hashtag: 'هاشتاق' }[k.match_mode] || 'يحتوي';
  const count = k.match_count || 0;
  return `
    <div class="kw-card" data-id="${k.id}">
      <div class="kw-card-head">
        <div class="kw-card-text">
          <strong>${escapeHtml(k.text)}</strong>
          <span class="kw-mode">${modeLabel}</span>
        </div>
        <div class="kw-card-actions">
          <button class="btn-icon-sm btn-danger kw-delete" data-id="${k.id}" type="button" title="حذف">×</button>
        </div>
      </div>
      <div class="kw-card-stats">
        <div class="kw-stat-num" data-value="${count}">${formatNum(count)}</div>
        <div class="kw-stat-lbl">مطابقة</div>
      </div>
      <div class="kw-card-footer">
        <span>اضغط للتفاصيل والإحصائيات →</span>
      </div>
    </div>
  `;
}

async function _renderKeywordDetail(pane, kw) {
  pane.innerHTML = '<div class="loading"><div class="spinner"></div><p>جاري التحميل…</p></div>';

  let stats, posts;
  try {
    const [statsRes, postsRes] = await Promise.all([
      fetch(`/api/keywords/${kw.id}/stats`, { credentials: 'include' }),
      fetch(`/api/keywords/${kw.id}/posts`, { credentials: 'include' }),
    ]);
    stats = await statsRes.json();
    posts = (await postsRes.json()).posts || [];
  } catch (e) {
    pane.innerHTML = `<p class="note">فشل التحميل: ${escapeHtml(e.message)}</p>`;
    return;
  }

  const modeLabel = { contains: 'يحتوي على', exact: 'مطابق تماماً لـ', hashtag: 'هاشتاق' }[kw.match_mode] || 'يحتوي على';

  pane.innerHTML = `
    <div class="kw-wrapper">
      <div class="kw-detail-header">
        <button class="btn-refresh btn-sm" id="kwBackBtn" type="button">← العودة لكل الكلمات</button>
        <h2>🔑 ${escapeHtml(kw.text)} <span class="kw-mode">${modeLabel}</span></h2>
      </div>

      <div class="analytics-grid">
        <div class="analytics-card">
          <div class="analytics-num">${formatNum(stats.total)}</div>
          <div class="analytics-label">إجمالي المنشورات</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-num">${formatNum(stats.total_reactions)}</div>
          <div class="analytics-label">إجمالي التفاعلات</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-num">${formatNum(stats.avg_reactions)}</div>
          <div class="analytics-label">متوسط التفاعل/منشور</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-num">${formatNum(stats.total_comments)}</div>
          <div class="analytics-label">إجمالي التعليقات</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-num">${formatNum(stats.total_shares)}</div>
          <div class="analytics-label">إجمالي المشاركات</div>
        </div>
      </div>

      ${stats.by_day && stats.by_day.length ? `
        <div class="analytics-section">
          <h3>📈 المنشورات حسب اليوم (آخر ${Math.min(stats.by_day.length, 30)} يوم)</h3>
          <div class="bar-chart">
            ${(() => {
              const last = stats.by_day.slice(-30);
              const max = Math.max(...last.map(([_, v]) => v), 1);
              return last.map(([day, count]) => {
                const pct = (count / max) * 100;
                return `
                  <div class="bar-item" title="${day}: ${count}">
                    <div class="bar-fill" style="height: ${pct}%"></div>
                    <div class="bar-num">${count}</div>
                    <div class="bar-day">${day.slice(5)}</div>
                  </div>
                `;
              }).join('');
            })()}
          </div>
        </div>
      ` : ''}

      ${stats.by_page && stats.by_page.length ? `
        <div class="analytics-section">
          <h3>📌 توزيع حسب الصفحة</h3>
          <table class="analytics-table">
            <thead><tr><th>الصفحة</th><th>منشورات</th></tr></thead>
            <tbody>
              ${stats.by_page.map(([name, c]) => `
                <tr><td>${escapeHtml(name)}</td><td>${formatNum(c)}</td></tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}

      ${stats.top_posts && stats.top_posts.length ? `
        <div class="analytics-section">
          <h3>🔥 أعلى منشورات تفاعلاً</h3>
          <div class="top-posts-list">
            ${stats.top_posts.map((p, i) => `
              <div class="top-post-row" data-post-id="${escapeHtml(p.post_id)}" data-post-slug="${escapeHtml(p.page_slug)}">
                <div class="top-rank">#${i + 1}</div>
                <div class="top-content">
                  <div class="top-page">${escapeHtml(p.page_name || '')}</div>
                  <div class="top-text">${escapeHtml(p.text)}</div>
                </div>
                <div class="top-reactions">${formatNum(p.reactions || 0)} ❤</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${posts.length === 0 ? `
        <div class="empty-state">
          <span class="empty-icon">🔍</span>
          <h4>لا توجد منشورات تطابق هذه الكلمة</h4>
          <p>سيتم تحديث المطابقات تلقائياً مع كل عملية سحب جديدة.</p>
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('kwBackBtn')?.addEventListener('click', () => {
    _activeKeywordId = null;
    renderKeywordsView();
  });

  pane.querySelectorAll('.top-post-row').forEach(row => {
    row.addEventListener('click', () => {
      const post = (posts || []).find(p => p.post_id === row.dataset.postId && p.page_slug === row.dataset.postSlug);
      if (post) openPostDetailModal(post);
    });
  });
}

// ========= NOTE: init() now called from auth.js after successful auth =========
// init() auto-runs when auth.js finishes bootstrap.
