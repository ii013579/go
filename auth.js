// auth.js
// 管理登入/登出與取得 user role（users 只讀一次）
// 來源參考：auth-kml-management.js

(function () {
  'use strict';

  if (typeof auth === 'undefined' || typeof db === 'undefined') {
    console.error('auth.js 需要先載入 firebase.js（提供 auth, db）。');
    return;
  }

  // 全域 currentUserRole（維持原專案相容）
  window.currentUserRole = null;
  window.currentUser = null;

  // 供外部 UI 呼叫：以 Google 登入（可擴充）
  window.loginWithGoogle = async function () {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      const res = await auth.signInWithPopup(provider);
      console.info('登入成功：', res.user && res.user.email);
      return res.user;
    } catch (err) {
      console.error('Google 登入失敗：', err);
      throw err;
    }
  };

  window.logout = async function () {
    try {
      await auth.signOut();
      console.info('已登出');
    } catch (err) {
      console.error('登出失敗：', err);
      throw err;
    }
  };

  // 當 auth state 變化時，讀取 users 資料（只做一次 get()）
  auth.onAuthStateChanged(async (user) => {
    window.currentUser = user || null;

    if (!user) {
      window.currentUserRole = null;
      // 可在 UI 模組處理切換
      document.dispatchEvent(new CustomEvent('app:user-changed', { detail: null }));
      return;
    }

    try {
      // 只讀一次 users doc（符合你要求：users 只讀一次）
      const userDoc = await db.collection('users').doc(user.uid).get();
      if (!userDoc.exists) {
        console.warn('使用者文件不存在，使用預設角色。');
        window.currentUserRole = null;
      } else {
        const data = userDoc.data() || {};
        window.currentUserRole = data.role || null;
      }
      document.dispatchEvent(new CustomEvent('app:user-changed', { detail: { user, role: window.currentUserRole } }));
    } catch (err) {
      console.error('讀取使用者角色失敗：', err);
      window.currentUserRole = null;
      document.dispatchEvent(new CustomEvent('app:user-changed', { detail: { user, role: null, error: err } }));
    }
  });

  // 方便取得 role 的同步 helper
  window.getCurrentUserRole = function () {
    return window.currentUserRole;
  };
})();