// auth.js - 身分驗證與使用者權限管理模組
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const els = {
    loginForm: $('loginForm'),
    loggedInDashboard: $('loggedInDashboard'),
    googleSignInBtn: $('googleSignInBtn'),
    logoutBtn: $('logoutBtn'),
    loginMessage: $('loginMessage'),
    userEmailDisplay: $('userEmailDisplay'),
    registrationSettingsSection: $('registrationSettingsSection'),
    generateRegistrationCodeBtn: $('generateRegistrationCodeBtn'),
    registrationCodeDisplay: $('registrationCodeDisplay'),
    registrationCodeCountdown: $('registrationCodeCountdown'),
    registrationExpiryDisplay: $('registrationExpiryDisplay'),
    userManagementSection: $('userManagementSection'),
    refreshUsersBtn: $('refreshUsersBtn'),
    userListDiv: $('userList')
  };

  window.currentUserRole = null;
  let registrationCodeTimer = null;
  let unsubUserRole = null;

  const getRoleDisplayName = role => {
    switch (role) {
      case 'unapproved': return '未審核';
      case 'user': return '一般';
      case 'editor': return '編輯者';
      case 'owner': return '擁有者';
      default: return role || '';
    }
  };

  const currentAppId = (typeof appId !== 'undefined') ? appId : 'kmldata-d22fb';

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      if (els.loginForm) els.loginForm.style.display = 'none';
      if (els.loggedInDashboard) els.loggedInDashboard.style.display = 'block';
      if (els.userEmailDisplay) {
        els.userEmailDisplay.textContent = `${user.email} (權限檢查中...)`;
        els.userEmailDisplay.style.display = 'block';
      }

      if (!unsubUserRole) {
        const userDocRef = db.collection('users').doc(user.uid);
        unsubUserRole = userDocRef.onSnapshot(async (doc) => {
          try {
            if (!doc.exists) {
              auth.signOut();
              return;
            }

            const userData = doc.data() || {};
            const newRole = userData.role || 'unapproved';
            const roleChanged = (window.currentUserRole !== newRole);
            
            window.currentUserRole = newRole;
            
            if (els.userEmailDisplay) {
              els.userEmailDisplay.textContent = `${user.email} (${getRoleDisplayName(window.currentUserRole)})`;
            }

            const isOwner = (newRole === 'owner');
            const toggleDisplay = (el, show) => { if (el) el.style.display = show ? 'flex' : 'none'; };
            const toggleBlock = (el, show) => { if (el) el.style.display = show ? 'block' : 'none'; };

            toggleDisplay(els.registrationSettingsSection, isOwner);
            toggleBlock(els.userManagementSection, isOwner); 
            
            if (els.userListDiv) els.userListDiv.style.display = 'none';

            if (roleChanged && typeof window.optimizedUpdateKmlLayerSelects === 'function') {
              await window.optimizedUpdateKmlLayerSelects();
            }
          } catch (err) {
            console.error("處理用戶快照時出錯:", err);
          }
        });
      }
    } else {
      if (unsubUserRole) {
        unsubUserRole();
        unsubUserRole = null;
      }
      window.currentUserRole = null;
      sessionStorage.removeItem('owner_user_list_cache');
      
      if (els.loginForm) els.loginForm.style.display = 'block';
      if (els.loggedInDashboard) els.loggedInDashboard.style.display = 'none';
      if (els.userEmailDisplay) els.userEmailDisplay.style.display = 'none';
    }
  });

  if (els.googleSignInBtn) {
    els.googleSignInBtn.addEventListener('click', async () => {
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const userCredential = await auth.signInWithPopup(provider);
        const user = userCredential.user;

        const userDoc = await db.collection('users').doc(user.uid).get();
        if (!userDoc.exists) {
          auth.signOut();
          window.showRegistrationCodeModal?.(async (result) => {
            if (!result) return;
            const { code, nickname } = result;
            try {
              const regDoc = await db.collection('settings').doc('registration').get();
              if (!regDoc.exists) {
                window.showMessage?.('註冊失敗', '註冊系統未啟用或無效的註冊碼。');
                return;
              }

              const storedCode = regDoc.data()?.oneTimeCode;
              const expiryTime = regDoc.data()?.oneTimeCodeExpiry ? regDoc.data().oneTimeCodeExpiry.toDate() : null;
              if (!storedCode || storedCode !== code || (expiryTime && new Date() > expiryTime)) {
                window.showMessage?.('註冊失敗', '無效或過期的註冊碼。');
                return;
              }

              const reAuth = await auth.signInWithPopup(provider);
              await db.collection('users').doc(reAuth.user.uid).set({
                email: reAuth.user.email,
                name: nickname,
                role: 'unapproved',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
              });

              window.showMessage?.('註冊成功', `歡迎 ${reAuth.user.email}！帳號已送出審核。`);
            } catch (error) {
              window.showMessage?.('註冊失敗', error.message);
            }
          });
        }
      } catch (error) {
        if (els.loginMessage) els.loginMessage.textContent = `登入失敗: ${error.message}`;
      }
    });
  }

  // 產生一次性註冊碼函式 (2個英文字母 + 4個數字 = 共6碼)
  const generateRegistrationAlphanumericCode = () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '013456789';
    let res = '';
    for (let i = 0; i < 2; i++) res += letters.charAt(Math.floor(Math.random() * letters.length));
    for (let i = 0; i < 4; i++) res += digits.charAt(Math.floor(Math.random() * digits.length));
    return res;
  };

  // 生成註冊碼按鈕事件（僅 owner 可用）
  if (els.generateRegistrationCodeBtn) {
    els.generateRegistrationCodeBtn.addEventListener('click', async () => {
      if (window.currentUserRole !== 'owner') {
        window.showMessage?.('權限不足', '只有管理員才能生成註冊碼。');
        return;
      }
      if (registrationCodeTimer) { clearInterval(registrationCodeTimer); registrationCodeTimer = null; }

      try {
        const code = generateRegistrationAlphanumericCode();
        let countdownSeconds = 60;
        const expiryDate = new Date();
        expiryDate.setSeconds(expiryDate.getSeconds() + countdownSeconds);

        await db.collection('settings').doc('registration').set({
          oneTimeCode: code,
          oneTimeCodeExpiry: firebase.firestore.Timestamp.fromDate(expiryDate)
        }, { merge: true });

        if (els.registrationCodeDisplay) els.registrationCodeDisplay.textContent = code;
        if (els.registrationCodeCountdown) els.registrationCodeCountdown.textContent = ` (剩餘 ${countdownSeconds} 秒)`;
        if (els.registrationCodeDisplay) els.registrationCodeDisplay.style.display = 'inline-block';
        if (els.registrationCodeCountdown) els.registrationCodeCountdown.style.display = 'inline-block';
        if (els.registrationExpiryDisplay) els.registrationExpiryDisplay.style.display = 'none';

        registrationCodeTimer = setInterval(() => {
          countdownSeconds--;
          if (countdownSeconds >= 0) {
            if (els.registrationCodeCountdown) els.registrationCodeCountdown.textContent = ` (剩餘 ${countdownSeconds} 秒)`;
          } else {
            clearInterval(registrationCodeTimer);
            registrationCodeTimer = null;
            if (els.registrationCodeDisplay) els.registrationCodeDisplay.textContent = '註冊碼已過期';
            if (els.registrationCodeCountdown) els.registrationCodeCountdown.style.display = 'none';
          }
        }, 1000);

        try {
          await navigator.clipboard.writeText(code);
        } catch (e) {
          const tempInput = document.createElement('textarea');
          tempInput.value = code;
          document.body.appendChild(tempInput);
          tempInput.select();
          document.execCommand('copy');
          document.body.removeChild(tempInput);
        }

        window.showMessage?.('成功', `一次性註冊碼已生成並複製到剪貼簿（共6碼），設定為 60 秒後過期！`);
      } catch (error) {
        console.error("生成註冊碼時出錯:", error);
        window.showMessage?.('錯誤', `生成註冊碼失敗: ${error.message}`);
      }
    });
  }

  if (els.logoutBtn) {
    els.logoutBtn.addEventListener('click', async () => {
      try {
        await auth.signOut();
        Object.keys(localStorage).forEach(key => { if (key.startsWith('kml_')) localStorage.removeItem(key); });
        setTimeout(() => location.reload(), 1000);
      } catch (error) {
        window.showMessage?.('登出失敗', error.message);
      }
    });
  }
})();