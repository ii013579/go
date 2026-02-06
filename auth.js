// auth.js
(function () {
  'use strict';

  window.AUTH = {
    user: null,
    role: null
  };
  
  const loginBtn = $('googleSignInBtn');
  const logoutBtn = $('logoutBtn');
  const loginForm = $('loginForm');
  const dashboard = $('loggedInDashboard');
  const emailDisplay = $('userEmailDisplay');

  /* ========= Google 登入 ========= */

  loginBtn?.addEventListener('click', async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await auth.signInWithPopup(provider);
    } catch (e) {
      alert(e.message);
    }
  });

  logoutBtn?.addEventListener('click', () => auth.signOut());

 /* ========= Auth 狀態 ========= */

  auth.onAuthStateChanged(user => {
    AUTH.user = user;

    if (!user) {
      loginForm.style.display = '';
      dashboard.style.display = 'none';
      AUTH.role = null;
      return;
    }

    loginForm.style.display = 'none';
    dashboard.style.display = '';
    emailDisplay.textContent = user.email;

    db.collection('users').doc(user.uid).onSnapshot(doc => {
      const role = doc.data()?.role || 'unapproved';
      if (AUTH.role === role) return;

      AUTH.role = role;
      document.dispatchEvent(new CustomEvent('auth:role', { detail: role }));
    });

    document.dispatchEvent(new CustomEvent('auth:changed', { detail: user }));
  });
 
  /* ========= 產生註冊碼 ========= */

  async function generateRegistrationCode() {
    if (AUTH.role !== 'owner') {
      alert('只有管理員可以產生註冊碼');
      return;
    }

    const code =
      Math.random().toString(36).substring(2, 5).toUpperCase() +
      Math.random().toString(36).substring(2, 7).toUpperCase();

    const expireAt = new Date(Date.now() + 60 * 1000);

    await db.collection('settings').doc('registration').set({
      oneTimeCode: code,
      oneTimeCodeExpiry: firebase.firestore.Timestamp.fromDate(expireAt)
    }, { merge: true });

    document.dispatchEvent(new CustomEvent('auth:codeGenerated', {
      detail: { code, expireAt }
    }));
  }

  /* ========================
     使用者：驗證註冊碼（核心）
  ======================== */

  async function verifyRegistrationCode(inputCode) {
    if (!AUTH.user) {
      alert('請先登入');
      return;
    }

    const regRef = db.collection('settings').doc('registration');
    const userRef = db.collection('users').doc(AUTH.user.uid);

    try {
      await db.runTransaction(async tx => {
        const regSnap = await tx.get(regRef);
        if (!regSnap.exists) throw new Error('註冊碼不存在');

        const data = regSnap.data();
        const now = new Date();

        if (!data.oneTimeCode || data.oneTimeCode !== inputCode) {
          throw new Error('註冊碼錯誤');
        }

        if (!data.oneTimeCodeExpiry ||
            data.oneTimeCodeExpiry.toDate() < now) {
          throw new Error('註冊碼已過期');
        }

        // consume：立即失效
        tx.update(regRef, {
          oneTimeCode: firebase.firestore.FieldValue.delete(),
          oneTimeCodeExpiry: firebase.firestore.FieldValue.delete()
        });

        // 升權（依你系統：editor）
        tx.set(userRef, {
          role: 'editor',
          approvedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });

      document.dispatchEvent(new Event('auth:verifySuccess'));
    } catch (err) {
      document.dispatchEvent(new CustomEvent('auth:verifyFail', {
        detail: err.message || '驗證失敗'
      }));
    }
  }

  /* ========================
     事件對外綁定
  ======================== */

  document.addEventListener('auth:generateCode', generateRegistrationCode);
  document.addEventListener('auth:verifyCode', e => {
    verifyRegistrationCode(e.detail);
  });

})();
