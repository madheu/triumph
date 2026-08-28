/* Learndiag auth.js — 账户 API 封装 + 云端同步层
 * 依赖: 无。所有页面 <script src="js/auth.js"></script> 后可用 window.TriumphAuth
 * 后端: 同域 Pages Functions（/api/*），不再依赖 workers.dev 域名
 * 可用 window.TRIUMPH_API 覆盖（本地联调时指向其他地址）
 */
(function () {
  const API = window.TRIUMPH_API || ''; // 空 = 同域相对路径 /api/*
  const TOKEN_KEY = 'triumph_token';
  const USER_KEY = 'triumph_user';
  const VERIFY_KEY = 'triumph_pending_verify'; // 待验证邮箱（注册后未激活时暂存）

  const T = {
    apiBase: API,
    token: null,
    user: null,

    init() {
      try {
        this.token = localStorage.getItem(TOKEN_KEY) || null;
        this.user = localStorage.getItem(USER_KEY) || null;
      } catch (e) {}
    },

    // ---------- HTTP ----------
    async _req(path, method, body) {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
      const res = await fetch(this.apiBase + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Structured error envelope: { error: { code, message, hint, details? }, status }
        // Backward compatible with the legacy flat shape { error: "code" }.
        const raw = data && data.error;
        const code = typeof raw === 'string' ? raw : (raw && raw.code) || 'request failed';
        const message = (raw && typeof raw === 'object' && raw.message) || code;
        const err = new Error(message);
        err.code = code;
        err.status = res.status;
        if (raw && typeof raw === 'object') {
          err.hint = raw.hint || '';
          if (raw.details) err.details = raw.details;
          // not_verified carries { email } so the UI can prefill the verify step
          if (code === 'not_verified' && raw.details && raw.details.email) err.email = raw.details.email;
        }
        throw err;
      }
      return data;
    },

    // ---------- Auth ----------
    // 注册：后端返回 need_verify 时抛 verification_required；邮件失败抛 mail_failed
    async register(email, password) {
      let d;
      try {
        d = await this._req('/api/register', 'POST', { email, password });
      } catch (e) {
        if (e.code === 'mail_failed') {
          try { localStorage.setItem(VERIFY_KEY, email.toLowerCase()); } catch (e2) {}
          const err = new Error('mail_failed');
          err.code = 'mail_failed';
          err.email = email;
          throw err;
        }
        throw e;
      }
      if (d.need_verify) {
        try { localStorage.setItem(VERIFY_KEY, email.toLowerCase()); } catch (e) {}
        const err = new Error('verification_required');
        err.code = 'verification_required';
        err.email = email;
        throw err;
      }
      this._setSession(d.token, d.user.email);
      return d.user;
    },
    // 提交验证码激活账号
    async verify(email, code) {
      const d = await this._req('/api/verify', 'POST', { email, code });
      try { localStorage.removeItem(VERIFY_KEY); } catch (e) {}
      this._setSession(d.token, d.user.email);
      return d.user;
    },
    // 重发验证码
    async resendCode(email) {
      return this._req('/api/resend', 'POST', { email });
    },
    getPendingVerify() {
      try { return localStorage.getItem(VERIFY_KEY) || ''; } catch (e) { return ''; }
    },
    async login(email, password) {
      const d = await this._req('/api/login', 'POST', { email, password });
      try { localStorage.removeItem(VERIFY_KEY); } catch (e) {}
      this._setSession(d.token, d.user.email);
      return d.user;
    },
    // 跳转到 Google OAuth 授权页（后端 /api/auth/google 处理 PKCE + 302）。
    // 回调成功后 token 经 fragment 回到 /login.html，由 handleGoogleCallback 接管。
    googleLogin(next) {
      const base = this.apiBase || '';
      const params = new URLSearchParams();
      const target = (next && typeof next === 'string') ? next : 'dashboard';
      params.set('next', target);
      window.location.href = base + '/api/auth/google?' + params.toString();
    },
    async me() {
      if (!this.token) return null;
      try { const d = await this._req('/api/me', 'GET'); return d.user; }
      catch (e) { if (e.status === 401) this.logout(); return null; }
    },
    logout() {
      try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch (e) {}
      this.token = null; this.user = null;
    },
    _setSession(token, email) {
      this.token = token;
      this.user = email;
      try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, email); } catch (e) {}
    },

    isLoggedIn() { return !!this.token; },

    // ---------- 云端状态同步 ----------
    // state = { answers[], mastery{}, plan, srs{}, tasks{}, examDate, unlockedAt, lastPass, lastScore }
    async saveState(state) {
      if (!this.token) return false;
      await this._req('/api/state', 'PUT', { state });
      return true;
    },
    async loadState() {
      if (!this.token) return null;
      const d = await this._req('/api/state', 'GET');
      return d.state || null;
    },

    // ---------- 本地状态读写（兼容现有 localStorage 结构） ----------
    // 云端优先：拉取成功则写回本地缓存；失败退回本地
    localGet(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    localSet(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    },

    // 一键拉取云端 → 合并本地 → 返回完整状态对象
    async syncPull() {
      const cloud = await this.loadState();
      if (cloud) {
        // 把云端各字段写回本地（保留本地未上云的额外字段）
        ['answers', 'mastery', 'plan', 'srs', 'tasks', 'examDate', 'unlockedAt', 'lastPass', 'lastScore', 'today'].forEach(k => {
          if (cloud[k] !== undefined) this.localSet(k, cloud[k]);
        });
      }
      return this.buildLocalState();
    },

    // 汇总本地状态（用于 push）
    buildLocalState() {
      return {
        answers: this.localGet('triumph_answers', []),
        mastery: this.localGet('triumph_mastery', {}),
        plan: this.localGet('triumph_plan', null),
        srs: this.localGet('triumph_srs', {}),
        tasks: this.localGet('triumph_tasks', {}),
        examDate: this.localGet('triumph_exam_date', ''),
        unlockedAt: this.localGet('triumph_unlocked_at', 0),
        lastPass: this.localGet('triumph_last_pass', 0),
        lastScore: this.localGet('triumph_last_score', ''),
        today: this.localGet('triumph_today', null),
      };
    },

    // 一键推送：本地 → 云端（登录时调用）
    async syncPush() {
      if (!this.token) return false;
      return this.saveState(this.buildLocalState());
    },

    // 登录后合并：先推本地(可能更新云端) → 再拉云端合并（应对 KV 最终一致性）
    async syncAll() {
      if (!this.token) return false;
      const cloud = await this.loadState();
      if (cloud) {
        // 云端有数据：推送本地（把刚产生的数据也同步上去），再拉取合并
        await this.syncPush();
        await this.syncPull();
      } else {
        // 首次登录：本地数据上云
        await this.syncPush();
      }
      return true;
    },
  };

  T.init();
  window.TriumphAuth = T;
})();
