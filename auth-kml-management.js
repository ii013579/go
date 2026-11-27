// auth-kml-management.js v3.04 (四大類結構整理 + metadata/sync 即時同步 + 兩階段刪除確認)

(function () {
  'use strict';

  // =====================================================================
  // 一、核心設定、狀態與共用工具
  // =====================================================================

  // --- 1.1 DOM 快取與全域狀態變數 ---
  const $ = id => document.getElementById(id);

  const els = {
    loginForm: $('loginForm'),
    loggedInDashboard: $('loggedInDashboard'),
    googleSignInBtn: $('googleSignInBtn'),
    logoutBtn: $('logoutBtn'),
    loginMessage: $('loginMessage'),
    userEmailDisplay: $('userEmailDisplay'),
    pinButton: $('pinButton'),
    kmlLayerSelect: $('kmlLayerSelect'),

    // 整體 KML 控制面板容器
    kmlControlsDashboard: $('kmlControlsDashboard'),

    uploadKmlSectionDashboard: $('uploadKmlSectionDashboard'),
    selectedKmlFileNameDashboard: $('selectedKmlFileNameDashboard'),
    uploadKmlSubmitBtnDashboard: $('uploadKmlSubmitBtnDashboard'),
    hiddenKmlFileInput: $('hiddenKmlFileInput'),
    deleteKmlSectionDashboard: $('deleteKmlSectionDashboard'),
    kmlLayerSelectDashboard: $('kmlLayerSelectDashboard'),
    deleteSelectedKmlBtn: $('deleteSelectedKmlBtn'),
    triggerUploadBtn: $('triggerUploadBtn'),
    triggerDeleteBtn: $('triggerDeleteBtn'),
    auditKmlBtn: $('auditKmlBtn'),

    registrationSettingsSection: $('registrationSettingsSection'),
    generateRegistrationCodeBtn: $('generateRegistrationCodeBtn'),
    registrationCodeDisplay: $('registrationCodeDisplay'),
    registrationCodeCountdown: $('registrationCodeCountdown'),
    registrationExpiryDisplay: $('registrationExpiryDisplay'),

    userManagementSection: $('userManagementSection'),
    refreshUsersBtn: $('refreshUsersBtn'),
    userListDiv: $('userList'),

    // 確認視窗相關元素
    confirmationModalOverlay: $('confirmationModalOverlay'),
    confirmationModalTitle: $('confirmationModalTitle'),
    confirmationModalMessage: $('confirmationModalMessage'),
    confirmYesBtn: $('confirmYesBtn'),
    confirmNoBtn: $('confirmNoBtn')
  };

  window.currentUserRole = null;
  window.__processedKmlTexts = new Map();

  let currentKmlLayers = [];
  let registrationCodeTimer = null;
  let isUpdatingList = false;
  let hasInitialAutoLoaded = false;
  let hasInitialMenuLoaded = false;
  let unsubUserRole = null;
  let unsubKmlSync = null;
  let lastSeenSyncTs = 0;

  // --- 1.2 路徑參照、角色對照與共用彈窗 ---
  const currentAppId = (typeof appId !== 'undefined') ? appId : 'kmldata-d22fb';
  console.log("[系統] 目前使用的 App ID 路徑:", currentAppId);

  const getKmlCollectionRef = () =>
    db.collection('artifacts').doc(currentAppId).collection('public').doc('data').collection('kmlLayers');

  const getSyncDocRef = () =>
    db.collection('artifacts').doc(currentAppId).collection('public').doc('data').collection('metadata').doc('sync');

  const getUserDocRef = (uid) =>
    db.collection('artifacts').doc(currentAppId).collection('public').doc('data').collection('users').doc(uid);

  const getRoleDisplayName = role => {
    switch (role) {
      case 'unapproved': return '未審核';
      case 'user': return '一般';
      case 'editor': return '編輯者';
      case 'owner': return '擁有者';
      default: return role || '';
    }
  };

  const createOption = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  };

  if (typeof window.showConfirmationModal === 'undefined') {
    window.showConfirmationModal = function (title, message) {
      return new Promise(resolve => {
        const overlay = els.confirmationModalOverlay;
        const titleEl = els.confirmationModalTitle;
        const msgEl = els.confirmationModalMessage;
        const yesBtn = els.confirmYesBtn;
        const noBtn = els.confirmNoBtn;

        if (!overlay || !titleEl || !msgEl || !yesBtn || !noBtn) {
          console.warn('確認視窗的 DOM 尚未就緒，直接回傳 true（預設）');
          resolve(true);
          return;
        }

        titleEl.textContent = title;
        msgEl.innerHTML = message;
        overlay.classList.add('visible');

        const cleanupAndResolve = (result) => {
          overlay.classList.remove('visible');
          yesBtn.removeEventListener('click', yesHandler);
          noBtn.removeEventListener('click', noHandler);
          resolve(result);
        };

        const yesHandler = () => cleanupAndResolve(true);
        const noHandler = () => cleanupAndResolve(false);

        yesBtn.addEventListener('click', yesHandler);
        noBtn.addEventListener('click', noHandler);
      });
    };
  }


  // =====================================================================
  // 二、身分驗證與帳號權限管理
  // =====================================================================

  // --- 2.1 登入狀態與角色即時監聽 ---
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
              console.warn("使用者文件不存在，執行登出");
              auth.signOut();
              return;
            }

            const userData = doc.data() || {};
            const newRole = userData.role || 'unapproved';
            const roleChanged = (window.currentUserRole !== newRole);

            window.currentUserRole = newRole;
            console.log(`[身份驗證] 目前角色: ${window.currentUserRole}`);

            if (els.userEmailDisplay) {
              els.userEmailDisplay.textContent = `${user.email} (${getRoleDisplayName(window.currentUserRole)})`;
            }

            const canEdit = (newRole === 'owner' || newRole === 'editor');
            const isOwner = (newRole === 'owner');

            const toggleDisplay = (el, show) => { if (el) el.style.display = show ? 'flex' : 'none'; };
            const toggleBlock = (el, show) => { if (el) el.style.display = show ? 'block' : 'none'; };

            toggleDisplay(els.kmlControlsDashboard, canEdit);
            toggleDisplay(els.uploadKmlSectionDashboard, canEdit);
            toggleDisplay(els.deleteKmlSectionDashboard, canEdit);
            toggleDisplay(els.registrationSettingsSection, isOwner);
            toggleBlock(els.userManagementSection, isOwner);

            if (els.userListDiv) {
              els.userListDiv.style.display = 'none';
            }

            if (roleChanged && typeof optimizedUpdateKmlLayerSelects === 'function') {
              await optimizedUpdateKmlLayerSelects();
            }
          } catch (err) {
            console.error("處理用戶快照時出錯:", err);
          }
        }, (error) => {
          console.error("監聽角色失敗:", error);
        });
      }
    } else {
      console.log("[Auth] 使用者未登入，開放圖層瀏覽權限");
      if (unsubUserRole) {
        unsubUserRole();
        unsubUserRole = null;
      }
      window.currentUserRole = null;
      sessionStorage.removeItem('owner_user_list_cache');

      if (els.kmlControlsDashboard) els.kmlControlsDashboard.style.display = 'none';
      if (els.loginForm) els.loginForm.style.display = 'block';
      if (els.loggedInDashboard) els.loggedInDashboard.style.display = 'none';
      if (els.userEmailDisplay) els.userEmailDisplay.style.display = 'none';
    }

    if (!hasInitialMenuLoaded) {
      hasInitialMenuLoaded = true;
      console.log("[系統初始化] 啟動初始圖層載入程序 (公開瀏覽)");

      if (typeof optimizedUpdateKmlLayerSelects === 'function') {
        await optimizedUpdateKmlLayerSelects();
      } else if (typeof updateKmlLayerSelects === 'function') {
        await updateKmlLayerSelects();
      }

      initKmlSyncListener();
    }
  });

// --- 2.2 Google 登入、註冊碼驗證與登出流程 ---
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
            if (!result) {
              window.showMessage?.('取消', '您已取消註冊。');
              return;
            }
            const code = result.code.trim().toUpperCase();
            const nickname = result.nickname.trim();
            try {
              const regDoc = await db.collection('settings').doc('registration').get();
              if (!regDoc.exists) {
                window.showMessage?.('註冊失敗', '註冊系統未啟用或無效的註冊碼。請聯繫管理員。');
                return;
              }

              const storedCode = (regDoc.data()?.oneTimeCode || '').trim().toUpperCase();
              const expiryTime = regDoc.data()?.oneTimeCodeExpiry ? regDoc.data().oneTimeCodeExpiry.toDate() : null;
              const currentTime = new Date();

              if (!storedCode || storedCode !== code || (expiryTime && currentTime > expiryTime)) {
                window.showMessage?.('註冊失敗', '無效或過期的註冊碼。');
                return;
              }

              const reAuth = await auth.signInWithPopup(provider);
              const reAuthUser = reAuth.user;

              await db.collection('users').doc(reAuthUser.uid).set({
                email: reAuthUser.email,
                name: nickname,
                role: 'user',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                registeredWithCode: true,
                registrationCodeUsed: code
              });

              window.showMessage?.('註冊成功', `歡迎 ${reAuthUser.email} (${nickname})！您的帳號已啟用。`);
            } catch (error) {
              window.showMessage?.('註冊失敗', `使用註冊碼登入/註冊時發生錯誤: ${error.message}`);
            }
          });
        } else {
          window.showMessage?.('登入成功', `歡迎回來 ${user.email}！`);
        }
      } catch (error) {
        console.error("Google 登入失敗:", error);
        if (els.loginMessage) els.loginMessage.textContent = `登入失敗: ${error.message}`;
        window.showMessage?.('登入失敗', `Google 登入時發生錯誤: ${error.message}`);
      }
    });
  }

  if (els.logoutBtn) {
    els.logoutBtn.addEventListener('click', async () => {
      try {
        await auth.signOut();

        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('kml_')) {
            localStorage.removeItem(key);
          }
        });
        console.log("[系統] 登出成功，已清理本地 KML 快取。");

        window.showMessage?.('登出成功', '用戶已登出。');

        setTimeout(() => {
          location.reload();
        }, 1000);
      } catch (error) {
        console.error("登出失敗:", error);
        window.showMessage?.('登出失敗', `登出時發生錯誤: ${error.message}`);
      }
    });
  }

  // --- 2.3 管理員工具（註冊碼生成與使用者列表管理） ---
  const generateRegistrationAlphanumericCode = () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '013456789';
    let res = '';
    for (let i = 0; i < 2; i++) res += letters.charAt(Math.floor(Math.random() * letters.length));
    for (let i = 0; i < 3; i++) res += digits.charAt(Math.floor(Math.random() * digits.length));
    return res;
  };

  if (els.generateRegistrationCodeBtn) {
    els.generateRegistrationCodeBtn.addEventListener('click', async () => {
      if (window.currentUserRole !== 'owner') {
        window.showMessage?.('權限不足', '只有管理員才能生成註冊碼。');
        return;
      }
      if (registrationCodeTimer) {
        clearInterval(registrationCodeTimer);
        registrationCodeTimer = null;
      }

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

        window.showMessage?.('成功', `一次性註冊碼已生成並複製到剪貼簿，設定為 ${60} 秒後過期！`);
      } catch (error) {
        console.error("生成註冊碼時出錯:", error);
        window.showMessage?.('錯誤', `生成註冊碼失敗: ${error.message}`);
      }
    });
  }

  const refreshUserList = async () => {
    const container = els.userListDiv;
    if (!container) return;

    const USER_CACHE_KEY = 'owner_user_list_cache';

    try {
      const cachedData = sessionStorage.getItem(USER_CACHE_KEY);
      if (cachedData) {
        console.log("[快取] 命中使用者列表快取");
        const usersData = JSON.parse(cachedData);
        renderUserCards(usersData);
        bindUserManagementEvents();
        return;
      }

      console.log("[Firestore] 抓取最新使用者名單...");
      const snapshot = await db.collection('users').get();
      const usersData = [];
      snapshot.forEach(doc => {
        if (auth.currentUser && doc.id === auth.currentUser.uid) return;
        usersData.push({ id: doc.id, ...doc.data() });
      });

      sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(usersData));
      renderUserCards(usersData);
      bindUserManagementEvents();
    } catch (error) {
      container.innerHTML = `<p style="color: red;">載入失敗: ${error.message}</p>`;
    }

    function renderUserCards(data) {
      container.innerHTML = '';
      const roleOrder = { 'unapproved': 1, 'user': 2, 'editor': 3, 'owner': 4 };
      data.sort((a, b) => (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99));

      data.forEach(user => {
        const card = document.createElement('div');
        card.className = 'user-card';
        card.dataset.uid = user.id;
        card.innerHTML = `
          <div class="user-email">${user.email?.split('@')[0] || 'N/A'}</div>
          <div class="user-nickname">${user.name || 'N/A'}</div>
          <div class="user-role-controls">
            <select class="user-role-select" data-original-value="${user.role || 'unapproved'}">
              <option value="unapproved" ${user.role === 'unapproved' ? 'selected' : ''}>未審核</option>
              <option value="user" ${user.role === 'user' ? 'selected' : ''}>一般</option>
              <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>編輯者</option>
              <option value="owner" ${user.role === 'owner' ? 'selected' : ''} ${window.currentUserRole !== 'owner' ? 'disabled' : ''}>擁有者</option>
            </select>
          </div>
          <div class="user-actions">
            <button class="change-role-btn" disabled>變</button>
            <button class="delete-user-btn action-buttons delete-btn">刪</button>
          </div>`;
        container.appendChild(card);
      });
    }

    function bindUserManagementEvents() {
      container.querySelectorAll('.user-card').forEach(card => {
        const select = card.querySelector('.user-role-select');
        const changeBtn = card.querySelector('.change-role-btn');
        const deleteBtn = card.querySelector('.delete-user-btn');
        const uid = card.dataset.uid;

        select.onchange = () => { changeBtn.disabled = (select.value === select.dataset.originalValue); };

        changeBtn.onclick = async () => {
          if (!await window.showConfirmationModal?.('確認', '確定變更角色？')) return;
          try {
            await db.collection('users').doc(uid).update({ role: select.value });
            select.dataset.originalValue = select.value;
            changeBtn.disabled = true;
            window.showMessage?.('成功', '角色已更新');
          } catch (e) { window.showMessage?.('錯誤', e.message); }
        };

        deleteBtn.onclick = async () => {
          if (!await window.showConfirmationModal?.('警告', '確定刪除用戶？')) return;
          try {
            await db.collection('users').doc(uid).delete();
            card.remove();
            const list = JSON.parse(sessionStorage.getItem(USER_CACHE_KEY) || '[]');
            sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(list.filter(u => u.id !== uid)));
          } catch (e) { window.showMessage?.('錯誤', e.message); }
        };
      });
    }
  };

  if (els.refreshUsersBtn) {
    els.refreshUsersBtn.addEventListener('click', async () => {
      if (window.currentUserRole !== 'owner') {
        window.showMessage?.('權限不足', '只有管理員才能查看或編輯使用者列表。');
        return;
      }

      if (!els.userListDiv) return;
      const isVisible = els.userListDiv.style.display !== 'none';

      if (isVisible) {
        els.userListDiv.style.display = 'none';
      } else {
        els.userListDiv.style.display = 'block';
        sessionStorage.removeItem('owner_user_list_cache');
        await refreshUserList();
      }
    });
  }


  // =====================================================================
  // 三、KML 圖層選單、快取與跨裝置即時同步
  // =====================================================================

  // --- 3.1 圖層下拉選單渲染與權限過濾 ---
  const updateKmlLayerSelects = async (passedLayers = null) => {
    const select = els.kmlLayerSelect;
    const selectDashboard = els.kmlLayerSelectDashboard;
    const deleteBtn = els.deleteSelectedKmlBtn;

    if (!select) {
      console.error("找不到 KML 圖層下拉選單。");
      return;
    }

    if (deleteBtn) deleteBtn.disabled = true;
    select.disabled = false;

    const canEdit = (window.currentUserRole === 'owner' || window.currentUserRole === 'editor');
    if (els.kmlControlsDashboard) els.kmlControlsDashboard.style.display = canEdit ? 'flex' : 'none';
    if (els.uploadKmlSectionDashboard) els.uploadKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
    if (els.deleteKmlSectionDashboard) els.deleteKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
    if (selectDashboard) selectDashboard.disabled = !canEdit;
    if (els.uploadKmlSubmitBtnDashboard) els.uploadKmlSubmitBtnDashboard.disabled = !canEdit;

    try {
      let layersToRender = [];

      if (Array.isArray(passedLayers)) {
        layersToRender = passedLayers;
        console.log("[快取模式] 使用快取清單渲染選單");
      } else {
        console.log("[網路模式] 快取失效，從網路抓取 KML 清單");
        const kmlRef = getKmlCollectionRef();
        const snapshot = await kmlRef.get();

        if (!snapshot.empty) {
          snapshot.forEach(doc => {
            layersToRender.push({ id: doc.id, ...doc.data() });
          });
        }
        localStorage.setItem('kml_list_cache_data', JSON.stringify(layersToRender));
      }

      select.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
      if (selectDashboard) selectDashboard.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';

      currentKmlLayers = [];

      const currentUserEmail = auth.currentUser?.email;
      const isOwner = (window.currentUserRole === 'owner');

      layersToRender.forEach(layer => {
        const kmlId = layer.id;
        const kmlName = layer.name || `KML_${kmlId.substring(0, 8)}`;
        const uploadedBy = layer.uploadedBy || '';

        const opt1 = createOption(kmlId, kmlName);
        const opt2 = createOption(kmlId, kmlName);

        const canDelete = isOwner || (window.currentUserRole === 'editor' && uploadedBy === currentUserEmail);

        if (!canDelete && selectDashboard) {
          opt2.disabled = true;
          opt2.style.color = '#999';
          opt2.textContent = `${kmlName} (無刪除權限)`;
        }

        select.appendChild(opt1);
        if (selectDashboard) selectDashboard.appendChild(opt2);

        currentKmlLayers.push({ id: kmlId, name: kmlName, uploadedBy: uploadedBy });
      });

      if (currentKmlLayers.length > 0 && canEdit && deleteBtn) {
        deleteBtn.disabled = false;
      }

      tryLoadPinnedKmlLayerWhenReady();
    } catch (error) {
      console.error("更新 KML 圖層列表時出錯:", error);
      window.showMessage?.('錯誤', '無法載入 KML 圖層列表。');
    }
  };

  // --- 3.2 快取比對與清單更新 ---
  async function optimizedUpdateKmlLayerSelects() {
    if (isUpdatingList) {
      console.log("清單更新進行中，略過本次呼叫");
      return;
    }
    isUpdatingList = true;

    const LIST_CACHE_KEY = 'kml_list_cache_data';
    const SYNC_TIME_KEY = 'kml_list_last_sync';

    try {
      const syncSnap = await getSyncDocRef().get();
      console.log("[Firestore 讀取] 讀取 metadata/sync");
      const serverUpdate = syncSnap.exists ? (syncSnap.data().lastUpdate || 0) : 0;
      const localUpdate = parseInt(localStorage.getItem(SYNC_TIME_KEY) || "0", 10);
      const cachedList = localStorage.getItem(LIST_CACHE_KEY);

      const isCacheValid = (cachedList && serverUpdate <= localUpdate && serverUpdate !== 0);

      if (isCacheValid) {
        console.log("[快取模式] 伺服器資料無變動，使用快取清單與圖層");
        const layers = JSON.parse(cachedList);
        await updateKmlLayerSelects(layers);
        tryLoadPinnedKmlLayerWhenReady();
        return;
      }

      console.log("[同步模式] 偵測到雲端更新，開始重新抓取資料");

      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('kml_data_')) {
          localStorage.removeItem(key);
        }
      });

      const snapshot = await getKmlCollectionRef().get();
      console.log("[Firestore 讀取] 讀取 kmlLayers 集合 (全量)");
      const layers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(layers));
      localStorage.setItem(SYNC_TIME_KEY, serverUpdate.toString());

      await updateKmlLayerSelects(layers);
      tryLoadPinnedKmlLayerWhenReady();
    } catch (err) {
      console.error("優化清單程序出錯:", err);
      const snapshot = await getKmlCollectionRef().get();
      const layers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      await updateKmlLayerSelects(layers);
      tryLoadPinnedKmlLayerWhenReady();
    } finally {
      isUpdatingList = false;
    }
  }

  // --- 3.3 metadata/sync 即時監聽與被刪圖層退回處理 ---
  function initKmlSyncListener() {
    if (unsubKmlSync) return;

    const localTs = parseInt(localStorage.getItem('kml_list_last_sync') || '0', 10);
    if (localTs > lastSeenSyncTs) lastSeenSyncTs = localTs;

    unsubKmlSync = getSyncDocRef().onSnapshot(async (docSnap) => {
      if (!docSnap.exists) return;

      const data = docSnap.data() || {};
      const remoteTs = Number(data.lastUpdate || 0);
      if (!remoteTs || remoteTs <= lastSeenSyncTs) return;

      lastSeenSyncTs = remoteTs;
      localStorage.setItem('kml_list_last_sync', String(remoteTs));
      localStorage.removeItem('kml_list_cache_data');

      if (data.deletedLayerId) {
        localStorage.removeItem(`kml_data_${data.deletedLayerId}`);
      }

      await optimizedUpdateKmlLayerSelects();

      if (data.lastAction === 'delete_kml_layer' && data.deletedLayerId) {
        const activeLayerId =
          window.currentKmlLayerId ||
          window.mapNamespace?.currentKmlLayerId ||
          els.kmlLayerSelect?.value ||
          '';

        if (activeLayerId === data.deletedLayerId) {
          if (els.kmlLayerSelect) els.kmlLayerSelect.value = '';
          if (els.kmlLayerSelectDashboard?.value === data.deletedLayerId) {
            els.kmlLayerSelectDashboard.value = '';
          }
          window.clearAllKmlLayers?.();
        }

        const pinnedId = localStorage.getItem('pinnedKmlId') || localStorage.getItem('pinnedKmlLayerId');
        if (pinnedId === data.deletedLayerId) {
          localStorage.removeItem('pinnedKmlId');
          localStorage.removeItem('pinnedKmlLayerId');
        }

        updatePinButtonState();
      }
    }, (err) => {
      console.warn('[KML 同步監聽] metadata/sync 監聽異常:', err);
    });
  }

  // --- 3.4 選單變更與預設圖層釘選 ---
  const updatePinButtonState = () => {
    const pinBtn = els.pinButton;
    const select = els.kmlLayerSelect;
    if (!pinBtn || !select) return;

    const kmlId = select.value || '';
    const pinnedId = localStorage.getItem('pinnedKmlId') || '';

    if (kmlId) pinBtn.removeAttribute('disabled');
    else pinBtn.setAttribute('disabled', 'true');

    if (kmlId && pinnedId === kmlId) pinBtn.classList.add('clicked');
    else pinBtn.classList.remove('clicked');
  };

  const handleKmlLayerSelectChange = () => {
    const select = els.kmlLayerSelect;
    const kmlId = select?.value || '';

    updatePinButtonState();

    if (kmlId && typeof window.loadKmlLayerFromFirestore === 'function') {
      if (window.currentKmlLayerId === kmlId) {
        console.log(`[系統提示] 已載入圖層 ${kmlId}，略過 change 觸發的重複讀取`);
        return;
      }
      window.loadKmlLayerFromFirestore(kmlId);
    } else if (!kmlId && typeof window.clearAllKmlLayers === 'function') {
      window.clearAllKmlLayers();
    }
  };

  const tryLoadPinnedKmlLayerWhenReady = () => {
    if (hasInitialAutoLoaded) return;

    const select = els.kmlLayerSelect;
    const pinnedId = localStorage.getItem('pinnedKmlId') || localStorage.getItem('pinnedKmlLayerId');

    if (!pinnedId || !select) return;

    if (select.options.length <= 1) {
      console.log("[系統提示] 選單清單尚未就緒，延後自動載入...");
      return;
    }

    const option = Array.from(select.options).find(opt => opt.value === pinnedId);

    if (!option) {
      console.warn(`[系統警告] 釘選的 ID ${pinnedId} 已不存在於資料庫，清除狀態`);
      localStorage.removeItem('pinnedKmlId');
      localStorage.removeItem('pinnedKmlLayerId');
      return;
    }

    if (typeof window.loadKmlLayerFromFirestore === 'function') {
      if (window.mapNamespace?.isLoadingKml || window.mapNamespace?.currentKmlLayerId === pinnedId) {
        return;
      }

      console.log(`[系統執行] 執行初始釘選圖層: ${pinnedId}`);
      hasInitialAutoLoaded = true;

      select.value = pinnedId;
      updatePinButtonState();
      window.loadKmlLayerFromFirestore(pinnedId);
    }
  };

  if (els.kmlLayerSelect) {
    els.kmlLayerSelect.addEventListener('change', handleKmlLayerSelectChange);
  } else {
    console.error('找不到 id 為 "kmlLayerSelect" 的下拉選單，KML 載入功能無法啟用。');
  }

  if (els.pinButton) {
    els.pinButton.addEventListener('click', () => {
      const select = els.kmlLayerSelect;
      if (!select) {
        window.showMessage?.('釘選失敗', '找不到 KML 下拉選單。');
        return;
      }
      const selectedKmlId = select.value;
      const currentPinnedId = localStorage.getItem('pinnedKmlId');

      if (!selectedKmlId) {
        window.showMessage?.('釘選失敗', '請先從下拉選單中選擇一個 KML 圖層才能釘選。');
        return;
      }

      if (currentPinnedId === selectedKmlId) {
        localStorage.removeItem('pinnedKmlId');
        window.showMessageCustom?.({
          title: '取消釘選',
          message: `「${select.options[select.selectedIndex]?.textContent || selectedKmlId}」已取消釘選，下次將不自動載入。`,
          buttonText: '確定',
          autoClose: true,
          autoCloseDelay: 3000
        });
      } else {
        localStorage.setItem('pinnedKmlId', selectedKmlId);
        const kmlLayerName = select.options[select.selectedIndex]?.textContent || selectedKmlId;
        window.showMessageCustom?.({
          title: '釘選成功',
          message: `「${kmlLayerName}」已釘選為預設圖層。`,
          buttonText: '確定',
          autoClose: true,
          autoCloseDelay: 3000
        });
      }
      updatePinButtonState();
    });
  } else {
    console.error('找不到 id 為 "pinButton" 的圖釘按鈕，釘選功能無法啟用。');
  }


  // =====================================================================
  // 四、KML 上傳合併、刪除確認與清查入口
  // =====================================================================

  // --- 4.1 檔案選取、自訂圖層名稱、覆蓋警告與跨檔重複點號後綴 ---
  window.getProcessedKmlText = (file, index = 0) => {
    if (!file || !(window.__processedKmlTexts instanceof Map)) return null;
    return window.__processedKmlTexts.get(`${index}_${file.name}`) || null;
  };

  const inspectAndSuffixKmlDuplicatesBatch = async (fileEntries) => {
    const parser = new DOMParser();
    const parsedEntries = [];
    const nameCountMap = new Map();
    const allExistingNames = new Set();

    for (let i = 0; i < fileEntries.length; i++) {
      const { file, rawText } = fileEntries[i];
      const xmlDoc = parser.parseFromString(rawText, 'application/xml');
      const isParseError = Boolean(xmlDoc.querySelector('parsererror'));
      const placemarks = isParseError ? [] : Array.from(xmlDoc.getElementsByTagName('Placemark'));

      if (!isParseError) {
        placemarks.forEach((pm) => {
          const nameEl = pm.getElementsByTagName('name')[0];
          if (!nameEl) return;
          const rawName = (nameEl.textContent || '').trim();
          if (!rawName) return;

          allExistingNames.add(rawName);
          nameCountMap.set(rawName, (nameCountMap.get(rawName) || 0) + 1);
        });
      }

      parsedEntries.push({
        index: i,
        file,
        rawText,
        xmlDoc,
        isParseError,
        placemarks
      });
    }

    const duplicateSummary = [];
    nameCountMap.forEach((count, name) => {
      if (count > 1) {
        duplicateSummary.push({ name, count });
      }
    });

    if (duplicateSummary.length === 0) {
      return {
        cancelled: false,
        processedByIndex: new Map(),
        duplicates: []
      };
    }

    const isMultiFile = fileEntries.length > 1;
    const scopeText = isMultiFile
      ? `已跨 ${fileEntries.length} 個合併檔案偵測到 <b>${duplicateSummary.length}</b> 組重複點號`
      : `檔案 <b>${fileEntries[0].file.name}</b> 偵測到 <b>${duplicateSummary.length}</b> 組重複點號`;

    const listHtml = duplicateSummary
      .map(
        (item) =>
          `<li style="margin: 4px 0;"><b>${item.name}</b>（共 ${item.count} 筆 → <code>${item.name}(1)</code> ~ <code>${item.name}(${item.count})</code>）</li>`
      )
      .join('');

    if (typeof Swal !== 'undefined') {
      const result = await Swal.fire({
        icon: 'warning',
        title: isMultiFile ? '多檔合併重複點號警告' : '重複點號警告',
        html: `
          <div style="text-align: left; font-size: 14px; line-height: 1.5;">
            <p style="margin-bottom: 8px;">${scopeText}，將自動加上 <b>(1)、(2)...</b> 後綴：</p>
            <ul style="max-height: 180px; overflow-y: auto; padding-left: 20px; margin: 0 0 10px 0; background: #fff8e6; border: 1px solid #ffe58f; border-radius: 6px; padding-top: 8px; padding-bottom: 8px;">
              ${listHtml}
            </ul>
            <p style="margin: 0; color: #666; font-size: 13px;">是否套用後綴並繼續上傳？</p>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: '套用後綴並上傳',
        cancelButtonText: '取消上傳',
        confirmButtonColor: '#007bff',
        cancelButtonColor: '#6c757d'
      });

      if (!result.isConfirmed) {
        return {
          cancelled: true,
          processedByIndex: new Map(),
          duplicates: duplicateSummary
        };
      }
    } else {
      const plainList = duplicateSummary.map((d) => `${d.name} (${d.count}筆)`).join('\n');
      const ok = window.confirm(
        `${isMultiFile ? '[多檔合併] ' : ''}偵測到重複點號，將自動加上 (1)、(2)... 後綴：\n\n${plainList}\n\n確定繼續上傳？`
      );
      if (!ok) {
        return {
          cancelled: true,
          processedByIndex: new Map(),
          duplicates: duplicateSummary
        };
      }
    }

    const seqMap = new Map();
    const serializer = new XMLSerializer();
    const processedByIndex = new Map();

    parsedEntries.forEach((entry) => {
      if (entry.isParseError) return;

      let modifiedInThisFile = false;
      entry.placemarks.forEach((pm) => {
        const nameEl = pm.getElementsByTagName('name')[0];
        if (!nameEl) return;
        const rawName = (nameEl.textContent || '').trim();
        if (!rawName || (nameCountMap.get(rawName) || 0) <= 1) return;

        let nextSeq = (seqMap.get(rawName) || 0) + 1;
        let candidate = `${rawName}(${nextSeq})`;
        while (allExistingNames.has(candidate)) {
          nextSeq += 1;
          candidate = `${rawName}(${nextSeq})`;
        }

        seqMap.set(rawName, nextSeq);
        allExistingNames.add(candidate);
        nameEl.textContent = candidate;
        modifiedInThisFile = true;
      });

      if (modifiedInThisFile) {
        processedByIndex.set(entry.index, serializer.serializeToString(entry.xmlDoc));
      }
    });

    return {
      cancelled: false,
      processedByIndex,
      duplicates: duplicateSummary
    };
  };

  const resetUploadSelection = () => {
    if (els.hiddenKmlFileInput) els.hiddenKmlFileInput.value = '';
    if (els.selectedKmlFileNameDashboard) {
      els.selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
    }
    if (window.__processedKmlTexts instanceof Map) {
      window.__processedKmlTexts.clear();
    }
  };

  if (els.selectedKmlFileNameDashboard && els.hiddenKmlFileInput) {
    els.selectedKmlFileNameDashboard.addEventListener('click', () => els.hiddenKmlFileInput.click());

    els.hiddenKmlFileInput.addEventListener('change', (event) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        els.selectedKmlFileNameDashboard.textContent = files.length === 1 ? files[0].name : `已選擇 ${files.length} 個檔案`;
        if (els.uploadKmlSubmitBtnDashboard) els.uploadKmlSubmitBtnDashboard.disabled = false;
      } else {
        els.selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
        if (els.uploadKmlSubmitBtnDashboard) els.uploadKmlSubmitBtnDashboard.disabled = true;
      }
    });
  }

  if (els.triggerUploadBtn) {
    els.triggerUploadBtn.addEventListener('click', () => els.hiddenKmlFileInput.click());
  }

  if (els.hiddenKmlFileInput) {
    els.hiddenKmlFileInput.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const defaultLayerName = files.length === 1
        ? files[0].name
        : `${files[0].name} 等 ${files.length} 個檔案合併`;

      const fileNamesHtml = Array.from(files)
        .map(file => `<strong style="color: red;">${file.name}</strong>`)
        .join('<br>');

      const modalContent = `
        <div style="text-align: left; margin-top: 10px;">
          <p>您選擇了以下 ${files.length} 個檔案：<br>${fileNamesHtml}</p>
          <div style="margin-top: 15px;">
            <label style="display: block; font-size: 13px; font-weight: bold; margin-bottom: 5px; color: #333;">自訂圖層名稱（留空則使用預設名稱）：</label>
            <input type="text" id="modalCustomLayerName" value="${defaultLayerName}" style="width: 100%; padding: 8px; box-sizing: border-box; border-radius: 4px; border: 1px solid #ccc; font-size: 14px;" />
          </div>
          <p style="margin-top: 10px; font-size: 13px;">確定要執行上傳嗎？</p>
        </div>`;

      const confirmUpload = await window.showConfirmationModal('確認上傳', modalContent);

      if (confirmUpload) {
        const customInput = document.getElementById('modalCustomLayerName');
        let finalLayerName = customInput && customInput.value.trim() !== ''
          ? customInput.value.trim()
          : defaultLayerName;

        finalLayerName = finalLayerName.replace(/\.kml$/i, '').trim();

        const selectEl = document.getElementById('kmlLayerSelect');
        if (selectEl) {
          const existingOption = Array.from(selectEl.options).find(opt => {
            const baseName = (opt.getAttribute('data-basename') || opt.textContent.split(' (')[0]).replace(/\.kml$/i, '').trim();
            return baseName.toLowerCase() === finalLayerName.toLowerCase();
          });

          if (existingOption) {
            const overwriteRes = await Swal.fire({
              title: '⚠️ 發現同名圖層',
              text: `圖層「${finalLayerName}」已經存在，請問是否要覆蓋現有圖層與資料？`,
              icon: 'warning',
              showCancelButton: true,
              confirmButtonColor: '#e74c3c',
              cancelButtonColor: '#34495e',
              confirmButtonText: '確定覆蓋',
              cancelButtonText: '取消'
            });

            if (!overwriteRes.isConfirmed) {
              resetUploadSelection();
              return;
            }
          }
        }

        window.__processedKmlTexts.clear();
        const fileArray = Array.from(files);
        const fileEntries = [];

        for (let i = 0; i < fileArray.length; i++) {
          const file = fileArray[i];
          const rawText = await file.text();
          fileEntries.push({ file, rawText });
        }

        const batchRes = await inspectAndSuffixKmlDuplicatesBatch(fileEntries);
        if (batchRes.cancelled) {
          resetUploadSelection();
          return;
        }

        batchRes.processedByIndex.forEach((updatedXml, idx) => {
          const targetFile = fileArray[idx];
          if (targetFile) {
            window.__processedKmlTexts.set(`${idx}_${targetFile.name}`, updatedXml);
          }
        });

        els.hiddenKmlFileInput.dataset.customLayerName = finalLayerName;
        els.uploadKmlSubmitBtnDashboard.click();
      } else {
        resetUploadSelection();
      }
    });
  }

  // --- 4.2 多檔合併上傳寫入與同步廣播 ---
  if (els.uploadKmlSubmitBtnDashboard) {
    els.uploadKmlSubmitBtnDashboard.addEventListener('click', async () => {
      const files = els.hiddenKmlFileInput?.files;
      if (!files || files.length === 0 || !auth.currentUser) return;

      if (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor') {
        window.showMessage?.('錯誤', '您沒有權限上傳 KML。');
        return;
      }

      const layerName = els.hiddenKmlFileInput.dataset.customLayerName || (
        files.length === 1 ? files[0].name : `${files[0].name} 等 ${files.length} 個檔案合併`
      );

      try {
        const mergedFeatures = [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];

          const processedText = typeof window.getProcessedKmlText === 'function'
            ? window.getProcessedKmlText(file, i)
            : null;

          const fileText = processedText ?? (await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (err) => reject(err);
            reader.readAsText(file);
          }));

          const dom = new DOMParser().parseFromString(fileText, 'text/xml');
          const geojson = toGeoJSON.kml(dom);

          if (geojson && Array.isArray(geojson.features)) {
            mergedFeatures.push(...geojson.features);
          }
        }

        const combinedGeoJson = {
          type: "FeatureCollection",
          features: mergedFeatures
        };

        const kmlLayersCollectionRef = getKmlCollectionRef();
        const existingKmlQuery = await kmlLayersCollectionRef.where('name', '==', layerName).get();
        const kmlLayerDocRef = existingKmlQuery.empty ? kmlLayersCollectionRef.doc() : existingKmlQuery.docs[0].ref;

        await kmlLayerDocRef.set({
          name: layerName,
          uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
          uploadedBy: auth.currentUser.email,
          uploadedByRole: window.currentUserRole,
          geojson: JSON.stringify(combinedGeoJson)
        }, { merge: true });

        const now = Date.now();
        lastSeenSyncTs = now;
        localStorage.setItem('kml_list_last_sync', String(now));
        await getSyncDocRef().set({
          lastUpdate: now,
          lastUpdateTime: new Date(now).toLocaleString('zh-TW'),
          lastAction: 'upload_kml_layer',
          updatedLayerId: kmlLayerDocRef.id
        }, { merge: true });

        localStorage.removeItem('kml_list_cache_data');
        localStorage.removeItem(`kml_data_${kmlLayerDocRef.id}`);
        if (window.__processedKmlTexts instanceof Map) {
          window.__processedKmlTexts.clear();
        }
        delete els.hiddenKmlFileInput.dataset.customLayerName;

        window.showMessage?.('成功', `已成功合併並上傳 ${files.length} 個檔案至圖層 "${layerName}"。`);
        await optimizedUpdateKmlLayerSelects();
        updatePinButtonState();
        els.hiddenKmlFileInput.value = '';
      } catch (error) {
        if (window.__processedKmlTexts instanceof Map) {
          window.__processedKmlTexts.clear();
        }
        window.showMessage?.('錯誤', error.message);
      }
    });
  }

  // --- 4.3 圖層刪除選單、兩階段確認與資料清理 ---
  if (els.triggerDeleteBtn) {
    els.triggerDeleteBtn.addEventListener('click', async () => {
      if (!Array.isArray(currentKmlLayers) || currentKmlLayers.length === 0) {
        window.showMessage?.('提示', '目前沒有可刪除的 KML 圖層。');
        return;
      }

      const currentUserEmail = auth.currentUser?.email;
      const isOwner = (window.currentUserRole === 'owner');
      let hasAnyDeletable = false;

      const options = currentKmlLayers
        .map(layer => {
          const canDelete = isOwner || (window.currentUserRole === 'editor' && layer.uploadedBy === currentUserEmail);
          if (canDelete) {
            hasAnyDeletable = true;
            return `<option value="${layer.id}">${layer.name}</option>`;
          }
          return `<option value="${layer.id}" disabled style="color: #999; background-color: #f2f2f2;">${layer.name} (無刪除權限)</option>`;
        })
        .join('');

      if (!hasAnyDeletable) {
        window.showMessage?.('權限不足', '目前沒有您可刪除的 KML 圖層。');
        return;
      }

      const modalContent = `
        <div style="text-align: left; margin-top: 10px;">
          <p>請選擇要刪除的圖層：</p>
          <select id="modalKmlDeletePicker" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #ddd; margin-top: 5px;">
            <option value="" disabled selected>-- 請選擇要刪除的圖層 --</option>
            ${options}
          </select>
          <p style="color: #d32f2f; font-size: 12px; margin-top: 10px; font-weight: bold;">警告：刪除後資料將無法復原（後續將進行兩階段確認）。</p>
        </div>`;

      const confirmDelete = await window.showConfirmationModal('刪除圖層', modalContent);

      if (confirmDelete) {
        const picker = document.getElementById('modalKmlDeletePicker');
        const selectedId = picker ? picker.value : null;
        const selectedOpt = picker ? picker.options[picker.selectedIndex] : null;

        if (selectedId && selectedOpt && !selectedOpt.disabled) {
          if (els.kmlLayerSelectDashboard) {
            els.kmlLayerSelectDashboard.value = selectedId;
          }
          els.deleteSelectedKmlBtn?.click();
        } else {
          window.showMessage?.('提示', '請先選擇有效的可刪除圖層。');
        }
      }
    });
  }

  if (els.deleteSelectedKmlBtn) {
    els.deleteSelectedKmlBtn.addEventListener('click', async () => {
      const kmlIdToDelete = els.kmlLayerSelectDashboard.value;
      const selectedOption = els.kmlLayerSelectDashboard.options[els.kmlLayerSelectDashboard.selectedIndex];
      const rawOptionText = selectedOption ? selectedOption.textContent : '';
      const kmlName = rawOptionText.replace(' (無刪除權限)', '').trim() || kmlIdToDelete;

      if (!kmlIdToDelete) return;

      const targetLayer = currentKmlLayers.find(l => l.id === kmlIdToDelete);
      const currentUserEmail = auth.currentUser?.email;
      const isOwner = (window.currentUserRole === 'owner');
      const canDelete = isOwner || (window.currentUserRole === 'editor' && targetLayer?.uploadedBy === currentUserEmail);

      if (!canDelete) {
        window.showMessage?.('權限不足', '您只能刪除自己上傳的 KML 圖層。');
        return;
      }

      // 第一重確認：提醒刪除圖層與相關清查資料
      let firstConfirmed = false;
      if (typeof Swal !== 'undefined') {
        const res1 = await Swal.fire({
          icon: 'warning',
          title: '確定要刪除圖層嗎？',
          html: `
            <div style="text-align: left; font-size: 14px; line-height: 1.6;">
              <p style="margin: 0 0 8px 0;">即將刪除圖層：<b>${kmlName}</b></p>
              <p style="margin: 0; color: #dc3545; font-weight: 600;">⚠️ 此操作將一併移除該圖層及相關清查資料，且無法復原。</p>
            </div>
          `,
          showCancelButton: true,
          confirmButtonText: '下一步，再次確認',
          cancelButtonText: '取消',
          confirmButtonColor: '#e67e22',
          cancelButtonColor: '#6c757d'
        });
        firstConfirmed = Boolean(res1.isConfirmed);
      } else if (typeof window.showConfirmationModal === 'function') {
        firstConfirmed = Boolean(
          await window.showConfirmationModal(
            '確認刪除圖層（1/2）',
            `即將刪除圖層「<b>${kmlName}</b>」及相關清查資料，是否繼續？`
          )
        );
      } else {
        firstConfirmed = window.confirm(`確定要刪除圖層「${kmlName}」及相關清查資料嗎？（第 1 次確認）`);
      }

      if (!firstConfirmed) return;

      // 第二重確認：最終確認執行刪除
      let secondConfirmed = false;
      if (typeof Swal !== 'undefined') {
        const res2 = await Swal.fire({
          icon: 'error',
          title: '最終確認：立即刪除？',
          html: `
            <div style="text-align: left; font-size: 14px; line-height: 1.6;">
              <p style="margin: 0 0 6px 0;">請再次確認要永久刪除：</p>
              <div style="padding: 8px 10px; background: #fff5f5; border: 1px solid #feb2b2; border-radius: 6px; font-weight: 700; color: #c53030;">
                ${kmlName}
              </div>
            </div>
          `,
          showCancelButton: true,
          confirmButtonText: '確定永久刪除',
          cancelButtonText: '放棄刪除',
          confirmButtonColor: '#dc3545',
          cancelButtonColor: '#6c757d'
        });
        secondConfirmed = Boolean(res2.isConfirmed);
      } else if (typeof window.showConfirmationModal === 'function') {
        secondConfirmed = Boolean(
          await window.showConfirmationModal(
            '最終確認刪除（2/2）',
            `請再次確認永久刪除圖層「<b>${kmlName}</b>」與其清查紀錄。`
          )
        );
      } else {
        secondConfirmed = window.confirm(`最終確認：真的要永久刪除圖層「${kmlName}」嗎？（第 2 次確認）`);
      }

      if (!secondConfirmed) return;

      try {
        await getKmlCollectionRef().doc(kmlIdToDelete).delete();

        if (typeof window.cleanupAuditData === 'function' && kmlName) {
          console.log(`[系統] 觸發清查資料清理: ${kmlName}`);
          await window.cleanupAuditData(kmlName);
        }

        const now = Date.now();
        lastSeenSyncTs = now;
        localStorage.setItem('kml_list_last_sync', String(now));
        await getSyncDocRef().set({
          lastUpdate: now,
          lastUpdateTime: new Date(now).toLocaleString('zh-TW'),
          lastAction: 'delete_kml_layer',
          deletedLayerId: kmlIdToDelete,
          deletedLayerName: kmlName
        }, { merge: true });

        localStorage.removeItem('kml_list_cache_data');
        localStorage.removeItem(`kml_data_${kmlIdToDelete}`);

        window.showMessage?.('成功', '圖層及相關清查資料已刪除。');
        await optimizedUpdateKmlLayerSelects();
        window.clearAllKmlLayers?.();
        updatePinButtonState();
      } catch (error) {
        console.error("刪除失敗:", error);
        window.showMessage?.('刪除失敗', error.message);
      }
    });
  }

  // --- 4.4 清查功能按鈕入口 ---
  if (els.auditKmlBtn) {
    els.auditKmlBtn.onclick = async () => {
      if (typeof window.updateKmlSelectUI === 'function') {
        window.updateKmlSelectUI();
      }

      if (typeof window.showAuditActionModal === 'function') {
        window.showAuditActionModal();
      } else {
        Swal.fire('錯誤', '清查模組尚未準備就緒', 'error');
      }
    };
  }
})();