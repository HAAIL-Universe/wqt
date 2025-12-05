// scripts/login.js
// Front-door login module for WQT.
// Assumes (optionally) that scripts/api.js defines resolveApiBase().
// Uses /auth/login_pin for login and /api/auth/register for user creation.

(function () {
  const CURRENT_USER_KEY = 'WQT_CURRENT_USER';
  const DEVICE_ID_KEY = 'WQT_DEVICE_ID';

  // --------------------------
  // Local storage helpers
  // --------------------------
  function readCurrentUser() {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveCurrentUser(user) {
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  }

  function clearCurrentUser() {
    localStorage.removeItem(CURRENT_USER_KEY);
  }

  function ensureDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      // Uses crypto.randomUUID if available; falls back to a simple string otherwise
      if (window.crypto && typeof crypto.randomUUID === 'function') {
        id = crypto.randomUUID();
      } else {
        id = 'dev-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      }
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }

  function getApiBase() {
    // Reuse resolveApiBase from scripts/api.js if present
    if (typeof window.resolveApiBase === 'function') {
      return window.resolveApiBase();
    }
    // Fallback – adjust if your backend base URL differs
    return 'https://wqt-backend.onrender.com';
  }

  // --------------------------
  // Backend login
  // --------------------------
  async function loginWithPin(pin) {
    const deviceId = ensureDeviceId();

    const body = {
      pin_code: pin,
      device_id: deviceId
    };

    const resp = await fetch(getApiBase() + '/auth/login_pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(text || 'Login failed (' + resp.status + ')');
    }

    const data = await resp.json();
    if (!data.success) {
      throw new Error(data.message || 'Invalid code');
    }

    // /auth/login_pin returns: { success, user_id, display_name, role, token }
    const userId = data.user_id || data.username || pin;

    const userPayload = {
      userId: userId,
      displayName: data.display_name || userId,
      role: data.role || 'picker',
      token: data.token || null,
      lastLoginAt: new Date().toISOString()
    };

    // Save unified identity
    saveCurrentUser(userPayload);

    // Mirror compatibility keys
    localStorage.setItem('wqt_operator_id', userId);
    localStorage.setItem('wqt_username', userId);

    return userPayload;
  }

  async function registerWithPin(pin, fullName, role) {
    const deviceId = ensureDeviceId();

    const body = {
      username: pin,
      pin: pin,
      device_id: deviceId,
      full_name: fullName,
      role: role
    };

    const resp = await fetch(getApiBase() + '/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(text || 'Registration failed (' + resp.status + ')');
    }

    const data = await resp.json();

    if (!data.success) {
      throw new Error(data.message || 'Could not create user');
    }

    // /api/auth/register returns: { success, username, display_name, role }
    const userId = data.username || pin;

    const userPayload = {
      userId: userId,
      displayName: data.display_name || userId,
      role: data.role || 'picker',
      token: data.token || null,
      lastLoginAt: new Date().toISOString()
    };

    saveCurrentUser(userPayload);
    // Also mirror legacy keys for consistency
    localStorage.setItem('wqt_operator_id', userId);
    localStorage.setItem('wqt_username', userId);

    return userPayload;
  }

  function gotoWqtApp() {
    // Change this if your main WQT entry file is named differently.
    window.location.href = 'index.html';
  }

  // --------------------------
  // DOM wiring
  // --------------------------
  document.addEventListener('DOMContentLoaded', () => {
    const currentUser = readCurrentUser();

    const resumeBlock = document.getElementById('resume-block');
    const resumeBtn = document.getElementById('resume-btn');
    const switchUserLink = document.getElementById('switch-user-link');

    const loginForm = document.getElementById('login-form');
    const pinInput = document.getElementById('pin-input');
    const loginBtn = document.getElementById('login-btn');
    const registerBtn = document.getElementById('register-btn');
    const statusEl = document.getElementById('status');
    const onlineBadge = document.getElementById('online-badge');
    const deviceHint = document.getElementById('device-hint');

    // Show device ID hint (mostly for you while testing)
    try {
      const deviceId = ensureDeviceId();
      if (deviceHint) {
        deviceHint.textContent = 'Device ' + deviceId.slice(0, 8);
      }
    } catch (err) {
      console.warn('Unable to generate device ID:', err);
    }

    function setStatus(message, isError = false) {
      if (!statusEl) return;
      statusEl.textContent = message || '';
      if (isError) {
        statusEl.classList.add('error');
      } else {
        statusEl.classList.remove('error');
      }
    }

    function updateOnlineBadge() {
      if (!onlineBadge) return;
      if (navigator.onLine) {
        onlineBadge.textContent = 'Online';
        onlineBadge.classList.add('online');
        onlineBadge.classList.remove('offline');
      } else {
        onlineBadge.textContent = 'Offline (cached users only)';
        onlineBadge.classList.add('offline');
        onlineBadge.classList.remove('online');
      }
    }

    window.addEventListener('online', updateOnlineBadge);
    window.addEventListener('offline', updateOnlineBadge);
    updateOnlineBadge();

    // If we already know a user on this device, allow quick resume
    if (currentUser && resumeBlock && resumeBtn) {
      resumeBlock.style.display = 'block';
      resumeBtn.textContent = 'Continue as ' + currentUser.displayName;
      resumeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        gotoWqtApp();
      });
    }

    if (switchUserLink) {
      switchUserLink.addEventListener('click', (e) => {
        e.preventDefault();
        clearCurrentUser();
        if (resumeBlock) resumeBlock.style.display = 'none';
        setStatus('Enter your code to log in.', false);
      });
    }

    if (loginForm && pinInput && loginBtn) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const pin = pinInput.value.trim();
        if (pin.length === 0) {
          setStatus('Enter your 5-digit code.', true);
          return;
        }

        // You can enforce length === 5 here if you want to be strict
        loginBtn.disabled = true;
        setStatus('Logging in…', false);

        try {
          await loginWithPin(pin);
          setStatus('Success. Loading WQT…', false);
          gotoWqtApp();
        } catch (err) {
          console.error(err);
          loginBtn.disabled = false;

          if (!navigator.onLine && readCurrentUser()) {
            // Offline and we have a cached user – guidance
            setStatus(
              'Offline. You can resume cached user above, or log in with signal.',
              true
            );
          } else {
            setStatus(err.message || 'Login failed. Check code or connection.', true);
          }
        }
      });
    }

    if (registerBtn && pinInput) {
      registerBtn.addEventListener('click', async (e) => {
        e.preventDefault();

        const pin = (pinInput.value || '').trim();
        if (!pin) {
          setStatus('Enter a 5-digit code to register.', true);
          pinInput.focus();
          return;
        }

        // Prompt for Name
        let fullName = window.prompt(
          'Enter your name (as you want it to appear in WQT):',
          ''
        );
        if (!fullName || !fullName.trim()) {
          setStatus('Name is required to create a user.', true);
          return;
        }
        fullName = fullName.trim();

        // Prompt for Job Role
        let role = window.prompt(
          'Enter your job role (e.g. picker, operative, supervisor):',
          'picker'
        );
        if (!role || !role.trim()) {
          role = 'picker';
        }
        role = role.trim().toLowerCase();

        registerBtn.disabled = true;
        setStatus('Creating user…', false);

        try {
          await registerWithPin(pin, fullName, role);
          setStatus('User created. Loading WQT…', false);
          gotoWqtApp();
        } catch (err) {
          console.error(err);
          registerBtn.disabled = false;
          setStatus(err.message || 'Registration failed.', true);
        }
      });
    }
  });

  // Expose a minimal API in case WQT needs it later
  window.WQTAuth = {
    readCurrentUser,
    clearCurrentUser,
    ensureDeviceId
  };
})();
