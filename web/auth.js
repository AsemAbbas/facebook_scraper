// =====================================================================
// مَرصَد · Auth Module v4.2
// =====================================================================

window.AUTH = window.AUTH || {
  user: null,
  hasUsers: false,
  dbOk: false,
};
const AUTH = window.AUTH;

async function checkAuth() {
  try {
    const res = await fetch('/api/status', { credentials: 'include' });
    if (!res.ok) return false;
    const data = await res.json();
    AUTH.dbOk = data.database?.connected || false;
    AUTH.hasUsers = data.has_users || false;
    if (data.authenticated) {
      AUTH.user = data.user;
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

function renderAuthScreen() {
  const isFirstUser = !AUTH.hasUsers;
  const dbOk = AUTH.dbOk;

  document.getElementById('authScreen').hidden = false;
  document.getElementById('appRoot').hidden = true;

  document.getElementById('authScreen').innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <div class="auth-header">
          <div class="auth-logo-mark">
            <span></span><span></span><span></span>
          </div>
          <h1 class="auth-title">مَرصَد</h1>
          <p class="auth-subtitle">
            ${isFirstUser
              ? 'أهلاً بك · أنشئ حساب المشرف الرئيسي للبدء'
              : 'سجّل دخول للوصول إلى لوحة التحكم'}
          </p>
        </div>

        ${!dbOk ? `
          <div class="auth-alert error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div>قاعدة البيانات غير متصلة. تأكد من إعدادات <code>.env</code>.</div>
          </div>
        ` : isFirstUser ? `
          <div class="auth-alert info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <div>أول مستخدم يُنشَأ تلقائياً كـ <strong>مشرف</strong> بصلاحيات كاملة.</div>
          </div>
        ` : ''}

        ${!isFirstUser ? `
          <div class="auth-switcher">
            <button class="auth-switch-btn active" data-mode="login">تسجيل الدخول</button>
            <button class="auth-switch-btn" data-mode="register">حساب جديد</button>
          </div>
        ` : ''}

        <!-- LOGIN FORM -->
        <form class="auth-form" id="loginForm" ${isFirstUser ? 'hidden' : ''}>
          <div class="auth-field">
            <label for="logUsername">اسم المستخدم</label>
            <div class="auth-input-wrap">
              <svg class="auth-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              <input type="text" id="logUsername" autocomplete="username" required autofocus>
            </div>
          </div>

          <div class="auth-field">
            <label for="logPassword">كلمة السر</label>
            <div class="auth-input-wrap">
              <svg class="auth-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input type="password" id="logPassword" autocomplete="current-password" required>
              <button type="button" class="pw-toggle" data-target="logPassword">👁</button>
            </div>
          </div>

          <label class="auth-checkbox">
            <input type="checkbox" id="logRemember" checked>
            <span>تذكرني لمدة 30 يوم</span>
          </label>

          <button type="submit" class="auth-submit" ${!dbOk ? 'disabled' : ''}>
            <span class="btn-text">تسجيل الدخول</span>
            <svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>

          <p class="auth-msg error" id="logError" hidden></p>
        </form>

        <!-- REGISTER FORM -->
        <form class="auth-form" id="registerForm" ${isFirstUser ? '' : 'hidden'}>
          <div class="auth-field">
            <label for="regUsername">اسم المستخدم <span class="req">*</span></label>
            <div class="auth-input-wrap">
              <svg class="auth-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              <input type="text" id="regUsername" placeholder="admin" autocomplete="username" required minlength="3" dir="ltr">
            </div>
            <span class="auth-hint">أحرف/أرقام فقط · 3+ أحرف</span>
          </div>

          <div class="auth-field">
            <label for="regDisplayName">الاسم المعروض</label>
            <div class="auth-input-wrap">
              <svg class="auth-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              </svg>
              <input type="text" id="regDisplayName" placeholder="اسمك الكامل (اختياري)">
            </div>
          </div>

          <div class="auth-field">
            <label for="regEmail">البريد الإلكتروني</label>
            <div class="auth-input-wrap">
              <svg class="auth-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
              </svg>
              <input type="email" id="regEmail" placeholder="you@example.com (اختياري)" autocomplete="email" dir="ltr">
            </div>
          </div>

          <div class="auth-field">
            <label for="regPassword">كلمة السر <span class="req">*</span></label>
            <div class="auth-input-wrap">
              <svg class="auth-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input type="password" id="regPassword" autocomplete="new-password" required minlength="6">
              <button type="button" class="pw-toggle" data-target="regPassword">👁</button>
            </div>
            <span class="auth-hint">6 أحرف على الأقل</span>
          </div>

          <button type="submit" class="auth-submit" ${!dbOk ? 'disabled' : ''}>
            <span class="btn-text">${isFirstUser ? '🚀 إنشاء حساب المشرف' : 'إنشاء الحساب'}</span>
          </button>

          <p class="auth-msg error" id="regError" hidden></p>
        </form>
      </div>

      <p class="auth-footnote">
        © ${new Date().getFullYear()} مَرصَد · جميع الحقوق محفوظة
      </p>
    </div>
  `;

  bindAuthEvents();
}

function bindAuthEvents() {
  // Tab switching
  document.querySelectorAll('.auth-switch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.auth-switch-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      document.getElementById('loginForm').hidden = mode !== 'login';
      document.getElementById('registerForm').hidden = mode !== 'register';
      // focus first input
      const form = mode === 'login' ? 'loginForm' : 'registerForm';
      const firstInput = document.querySelector(`#${form} input`);
      if (firstInput) setTimeout(() => firstInput.focus(), 50);
    });
  });

  // Password toggle
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.classList.toggle('visible', input.type === 'text');
    });
  });

  // Register
  const regForm = document.getElementById('registerForm');
  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = regForm.querySelector('button[type="submit"]');
      const errEl = document.getElementById('regError');
      errEl.hidden = true;
      btn.disabled = true;
      btn.classList.add('loading');
      const originalText = btn.querySelector('.btn-text').textContent;
      btn.querySelector('.btn-text').textContent = 'جاري الإنشاء...';

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            username: document.getElementById('regUsername').value.trim(),
            display_name: document.getElementById('regDisplayName').value.trim(),
            email: document.getElementById('regEmail').value.trim(),
            password: document.getElementById('regPassword').value,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          errEl.textContent = data.error || 'فشل التسجيل';
          errEl.hidden = false;
          btn.disabled = false;
          btn.classList.remove('loading');
          btn.querySelector('.btn-text').textContent = originalText;
          return;
        }
        location.reload();
      } catch (e) {
        errEl.textContent = 'خطأ في الاتصال: ' + e.message;
        errEl.hidden = false;
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.querySelector('.btn-text').textContent = originalText;
      }
    });
  }

  // Login
  const logForm = document.getElementById('loginForm');
  if (logForm) {
    logForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = logForm.querySelector('button[type="submit"]');
      const errEl = document.getElementById('logError');
      errEl.hidden = true;
      btn.disabled = true;
      btn.classList.add('loading');
      const textEl = btn.querySelector('.btn-text');
      const originalText = textEl.textContent;
      textEl.textContent = 'جاري الدخول...';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            username: document.getElementById('logUsername').value.trim(),
            password: document.getElementById('logPassword').value,
            remember: document.getElementById('logRemember').checked,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          errEl.textContent = data.error || 'فشل تسجيل الدخول';
          errEl.hidden = false;
          btn.disabled = false;
          btn.classList.remove('loading');
          textEl.textContent = originalText;
          return;
        }
        location.reload();
      } catch (e) {
        errEl.textContent = 'خطأ في الاتصال: ' + e.message;
        errEl.hidden = false;
        btn.disabled = false;
        btn.classList.remove('loading');
        textEl.textContent = originalText;
      }
    });
  }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {}
  AUTH.user = null;
  location.reload();
}

// Entry
(async function bootstrap() {
  const authed = await checkAuth();
  if (!authed) {
    renderAuthScreen();
  } else {
    document.getElementById('authScreen').hidden = true;
    document.getElementById('appRoot').hidden = false;
    if (typeof init === 'function') init();
  }
})();
