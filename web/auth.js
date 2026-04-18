// =====================================================================
// مَرصَد · Auth Module (v4.0)
// Login / Register / Session management
// =====================================================================

const AUTH = {
  user: null,
  hasUsers: false,
  dbOk: false,
};

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
    console.error('auth check failed', e);
    return false;
  }
}

function renderAuthScreen() {
  const isFirstUser = !AUTH.hasUsers;
  document.getElementById('authScreen').hidden = false;
  document.getElementById('appRoot').hidden = true;

  document.getElementById('authScreen').innerHTML = `
    <div class="auth-container">
      <div class="auth-brand">
        <div class="auth-logo">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>
        <h1>مَرصَد</h1>
        <p>رصد منشورات صفحات فيسبوك</p>
      </div>

      ${!AUTH.dbOk ? `
        <div class="auth-warning">
          ⚠️ قاعدة البيانات غير متصلة. تأكد من إعداد ملف .env ثم أعد التشغيل.
        </div>
      ` : ''}

      <div class="auth-tabs">
        <button class="auth-tab ${isFirstUser ? 'active' : ''}" data-form="register">
          ${isFirstUser ? 'إنشاء حساب admin' : 'إنشاء حساب'}
        </button>
        ${!isFirstUser ? `<button class="auth-tab active" data-form="login">تسجيل الدخول</button>` : ''}
      </div>

      ${isFirstUser ? `
        <div class="auth-info-box">
          👋 أهلاً بك! هذا أول تشغيل للنظام.
          الحساب اللي تنشئه الآن راح يكون <strong>admin</strong> بصلاحيات كاملة.
        </div>
      ` : ''}

      <!-- Register form -->
      <form class="auth-form" id="registerForm" ${isFirstUser ? '' : 'hidden'}>
        <div class="form-field">
          <label>اسم المستخدم <span class="req">*</span></label>
          <input type="text" id="regUsername" placeholder="user123" autocomplete="username" required minlength="3">
          <span class="field-help">أحرف وأرقام فقط، 3+ أحرف</span>
        </div>
        <div class="form-field">
          <label>الاسم المعروض</label>
          <input type="text" id="regDisplayName" placeholder="اسمك الكامل (اختياري)">
        </div>
        <div class="form-field">
          <label>البريد الإلكتروني</label>
          <input type="email" id="regEmail" placeholder="you@example.com (اختياري)" autocomplete="email">
        </div>
        <div class="form-field">
          <label>كلمة السر <span class="req">*</span></label>
          <input type="password" id="regPassword" placeholder="6+ أحرف" autocomplete="new-password" required minlength="6">
        </div>
        <button type="submit" class="btn-trigger btn-full btn-lg" ${!AUTH.dbOk ? 'disabled' : ''}>
          ${isFirstUser ? '🚀 إنشاء الحساب والبدء' : '+ إنشاء الحساب'}
        </button>
        <p class="auth-error" id="regError" hidden></p>
      </form>

      <!-- Login form -->
      <form class="auth-form" id="loginForm" ${isFirstUser ? 'hidden' : ''}>
        <div class="form-field">
          <label>اسم المستخدم</label>
          <input type="text" id="logUsername" autocomplete="username" required>
        </div>
        <div class="form-field">
          <label>كلمة السر</label>
          <input type="password" id="logPassword" autocomplete="current-password" required>
        </div>
        <label class="checkbox-inline">
          <input type="checkbox" id="logRemember" checked>
          <span>تذكرني</span>
        </label>
        <button type="submit" class="btn-trigger btn-full btn-lg" ${!AUTH.dbOk ? 'disabled' : ''}>
          تسجيل الدخول
        </button>
        <p class="auth-error" id="logError" hidden></p>
      </form>

      <div class="auth-footer">
        © ${new Date().getFullYear()} مَرصَد
      </div>
    </div>
  `;

  bindAuthEvents();
}

function bindAuthEvents() {
  // Tab switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.form;
      document.getElementById('registerForm').hidden = target !== 'register';
      document.getElementById('loginForm').hidden = target !== 'login';
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
      btn.textContent = '⏳ جاري الإنشاء…';

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
          btn.textContent = AUTH.hasUsers ? '+ إنشاء الحساب' : '🚀 إنشاء الحساب والبدء';
          return;
        }
        AUTH.user = data.user;
        AUTH.hasUsers = true;
        document.getElementById('authScreen').hidden = true;
        document.getElementById('appRoot').hidden = false;
        location.reload();
      } catch (e) {
        errEl.textContent = 'خطأ: ' + e.message;
        errEl.hidden = false;
        btn.disabled = false;
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
      btn.textContent = '⏳';

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
          btn.textContent = 'تسجيل الدخول';
          return;
        }
        AUTH.user = data.user;
        document.getElementById('authScreen').hidden = true;
        document.getElementById('appRoot').hidden = false;
        location.reload();
      } catch (e) {
        errEl.textContent = 'خطأ: ' + e.message;
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = 'تسجيل الدخول';
      }
    });
  }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {}
  AUTH.user = null;
  location.reload();
}

// Entry: check auth then init
(async function bootstrap() {
  const authed = await checkAuth();
  if (!authed) {
    renderAuthScreen();
  } else {
    document.getElementById('authScreen').hidden = true;
    document.getElementById('appRoot').hidden = false;
    // app.js will auto-init
    if (typeof init === 'function') {
      init();
    }
  }
})();
