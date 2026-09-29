// auth-kml-management.js v3.02

(function () {
  'use strict';

  // 簡易 DOM 取得 helper（若找不到回傳 null）
  const $ = id => document.getElementById(id);

  // 快取常用 DOM 元素（部分可能為 null，使用時要加以檢查）
  const els = {
    loginForm: $('loginForm'),
    loggedInDashboard: $('loggedInDashboard'),
    googleSignInBtn: $('googleSignInBtn'),
    logoutBtn: $('logoutBtn'),
    loginMessage: $('loginMessage'),
    userEmailDisplay: $('userEmailDisplay'),
    pinButton: $('pinButton'),
    kmlLayerSelect: $('kmlLayerSelect'),

    // KML 管理介面整體與細項區塊
    kmlManagementSection: $('kmlManagementSection') \vert{}\vert{}$('kmlManagementSectionDashboard'),
    uploadKmlSectionDashboard: $('uploadKmlSectionDashboard'),
    selectedKmlFileNameDashboard: $('selectedKmlFileNameDashboard'),
    uploadKmlSubmitBtnDashboard: $('uploadKmlSubmitBtnDashboard'),
    hiddenKmlFileInput: $('hiddenKmlFileInput'),
    deleteKmlSectionDashboard: $('deleteKmlSectionDashboard'),
    kmlLayerSelectDashboard: $('kmlLayerSelectDashboard'),
    deleteSelectedKmlBtn: $('deleteSelectedKmlBtn'),
    triggerUploadBtn: $('triggerUploadBtn'),
    triggerDeleteBtn: $('triggerDeleteBtn'),
    auditKmlBtn: document.getElementById('auditKmlBtn'),

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

  // 全域狀態
  window.currentUserRole = null;     // 當前使用者角色
  let currentKmlLayers = [];        // 目前查到的 KML 圖層清單
  let registrationCodeTimer = null; // 註冊碼倒數計時器
  let currentPinnedKmlId = null;    // 當前釘選的 KML ID
  let isUpdatingList = false;       // 防止清單重複更新的鎖
  let hasAutoLoaded = false;        // 確保釘選自動載入只執行一次
  let hasInitialAutoLoaded = false; // 防止重整時多次觸發自動載入
  let hasInitialMenuLoaded = false;
  let authSnapshotBound = false;    // 防止重複綁定監聽器
  let unsubUserRole = null;         // 存放取消監聽函式，防止重複掛載

  // 角色顯示名稱（中文）
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
  console.log("[系統] 目前使用的 App ID 路徑:", currentAppId);

  // 取得 KML collection 的 Firestore 參照
  const getKmlCollectionRef = () =>
    db.collection('artifacts').doc(currentAppId).collection('public').doc('data').collection('kmlLayers');

  // 取得同步文件的參照
  const getSyncDocRef = () =>
    db.collection('artifacts').doc(currentAppId).collection('public').doc('data').collection('metadata').doc('sync');

  // 取得使用者文件的參照 (用於監聽角色)
  const getUserDocRef = (uid) =>
    db.collection('artifacts').doc(currentAppId).collection('public').doc('data').collection('users').doc(uid);
        
  // 建立 <option> 元素的小 helper
  const createOption = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  };

  // 更新釘選按鈕狀態
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

  // 當 KML 下拉選單變更時處理
  const handleKmlLayerSelectChange = () => {
    const select = els.kmlLayerSelect;
    const kmlId = select?.value || '';

    updatePinButtonState();

    if (kmlId && typeof window.loadKmlLayerFromFirestore === 'function') {
      if (window.currentKmlLayerId === kmlId) {
        console.log(`⚠️ 已載入圖層 ${kmlId}，略過 change 觸發的重複讀取`);
        return;
      }
      window.loadKmlLayerFromFirestore(kmlId);
    } else if (!kmlId && typeof window.clearAllKmlLayers === 'function') {
      window.clearAllKmlLayers();
    }
  };

  // 釘選載入邏輯
  const tryLoadPinnedKmlLayerWhenReady = () => {
    if (hasInitialAutoLoaded) return; 

    const select = els.kmlLayerSelect;
    const pinnedId = localStorage.getItem('pinnedKmlId') || localStorage.getItem('pinnedKmlLayerId');

    if (!pinnedId || !select) return;

    if (select.options.length <= 1) {
      console.log("⏳ 選單清單尚未就緒，延後自動載入...");
      return; 
    }

    const option = Array.from(select.options).find(opt => opt.value === pinnedId);
    
    if (!option) {
      console.warn(`📌 釘選的 ID ${pinnedId} 已不存在於資料庫，清除狀態`);
      localStorage.removeItem('pinnedKmlId');
      localStorage.removeItem('pinnedKmlLayerId');
      return;
    }

    if (typeof window.loadKmlLayerFromFirestore === 'function') {
      if (window.mapNamespace?.isLoadingKml || window.mapNamespace?.currentKmlLayerId === pinnedId) {
        return;
      }

      console.log(`🚀 [初始載入] 執行釘選圖層: ${pinnedId}`);
      hasInitialAutoLoaded = true;
      
      select.value = pinnedId;
      updatePinButtonState();
      window.loadKmlLayerFromFirestore(pinnedId);
    }
  };

  /**
   * 更新 KML 下拉選單內容（整合權限控制與 Pinned KML 觸發）
   */
  const updateKmlLayerSelects = async (passedLayers = null) => {
      const select = els.kmlLayerSelect;
      const selectDashboard = els.kmlLayerSelectDashboard;
      const deleteBtn = els.deleteSelectedKmlBtn;
  
      if (!select) {
          console.error("找不到 KML 圖層下拉選單。");
          return;
      }
  
      // 初始化 UI 狀態
      if (deleteBtn) deleteBtn.disabled = true;
      select.disabled = false;
  
      // 【權限調整】僅 owner 與 editor 顯示 KML 管理介面，user 與 unapproved 隱藏
      const canEdit = (window.currentUserRole === 'owner' || window.currentUserRole === 'editor');
      if (els.kmlManagementSection) els.kmlManagementSection.style.display = canEdit ? 'block' : 'none';
      if (els.uploadKmlSectionDashboard) els.uploadKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
      if (els.deleteKmlSectionDashboard) els.deleteKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
      if (selectDashboard) selectDashboard.disabled = !canEdit;
      if (els.uploadKmlSubmitBtnDashboard) els.uploadKmlSubmitBtnDashboard.disabled = !canEdit;
  
      try {
          let layersToRender = [];
  
          if (Array.isArray(passedLayers)) {
              layersToRender = passedLayers;
              console.log("%c♻️ [Cache] 使用快取清單渲染選單", "color: #4CAF50;");
          } else {
              console.log("%c🌐 [Network] 快取失效，從網路抓取 KML 清單", "color: #FF9800;");
              const kmlRef = getKmlCollectionRef();
              let snapshot;
              
              if (window.currentUserRole === 'editor' && auth.currentUser?.email) {
                  snapshot = await kmlRef.where('uploadedBy', '==', auth.currentUser.email).get();
              } else {
                  snapshot = await kmlRef.get();
              }
  
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
          
          layersToRender.forEach(layer => {
              const kmlId = layer.id;
              const kmlName = layer.name || `KML_${kmlId.substring(0, 8)}`;
              
              const opt1 = createOption(kmlId, kmlName);
              const opt2 = createOption(kmlId, kmlName);
              
              select.appendChild(opt1);
              if (selectDashboard) selectDashboard.appendChild(opt2);
              
              currentKmlLayers.push({ id: kmlId, name: kmlName });
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

  // 預設的確認視窗函式
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

  // 重新整理使用者列表（管理員頁面）
  const refreshUserList = async () => {
    const container = els.userListDiv;
    if (!container) return;

    const USER_CACHE_KEY = 'owner_user_list_cache';

    try {
      const cachedData = sessionStorage.getItem(USER_CACHE_KEY);
      if (cachedData) {
        console.log("%c[Cache] 命中快取", "color: #9C27B0;");
        const usersData = JSON.parse(cachedData);
        renderUserCards(usersData);
        bindUserManagementEvents();
        return;
      }

      console.log("🔥 [Firestore] 抓取最新名單...");
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

  // 監聽 Auth 狀態變更以更新 UI
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

            // 【權限調整】僅 owner 與 editor 具備 KML 管理權限；user 及 unapproved 隱藏管理介面
            const canEdit = (newRole === 'owner' || newRole === 'editor');
            const isOwner = (newRole === 'owner');

            const toggleDisplay = (el, show) => { if (el) el.style.display = show ? 'flex' : 'none'; };
            const toggleBlock = (el, show) => { if (el) el.style.display = show ? 'block' : 'none'; };

            // 顯示/隱藏各項功能區塊
            toggleBlock(els.kmlManagementSection, canEdit);
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
      
      if (els.loginForm) els.loginForm.style.display = 'block';
      if (els.loggedInDashboard) els.loggedInDashboard.style.display = 'none';
      if (els.userEmailDisplay) els.userEmailDisplay.style.display = 'none';
    }

    if (!hasInitialMenuLoaded) {
      hasInitialMenuLoaded = true; 
      console.log("[Init] 啟動初始圖層載入程序 (公開瀏覽)");
      
      if (typeof optimizedUpdateKmlLayerSelects === 'function') {
        await optimizedUpdateKmlLayerSelects();
      } else if (typeof updateKmlLayerSelects === 'function') {
        await updateKmlLayerSelects();
      }
    }
  });

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
      console.log("%c🔥 [Firestore Read] 讀取 metadata/sync", "color: white; background: red; padding: 2px 5px;");
      const serverUpdate = syncSnap.exists ? (syncSnap.data().lastUpdate || 0) : 0;
      const localUpdate = parseInt(localStorage.getItem(SYNC_TIME_KEY) || "0");
      const cachedList = localStorage.getItem(LIST_CACHE_KEY);

      const isCacheValid = (cachedList && serverUpdate <= localUpdate && serverUpdate !== 0);

      if (isCacheValid) {
        console.log("%c[核心快取模式] 伺服器資料無變動，使用快取清單與圖層", "color: #4CAF50; font-weight: bold;");
        const layers = JSON.parse(cachedList);
        await updateKmlLayerSelects(layers);
        tryLoadPinnedKmlLayerWhenReady();
        return; 
      }

      console.log("%c[同步模式] 偵測到雲端更新，開始重新抓取資料", "color: #FF9800; font-weight: bold;");

      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('kml_data_')) {
          localStorage.removeItem(key);
        }
      });

      const snapshot = await getKmlCollectionRef().get();
      console.log("%c🔥 [Firestore Read] 讀取 kmlLayers 集合 (全量)", "color: white; background: red; padding: 2px 5px;");
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

  // Google 登入事件
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
            const code = result.code;
            const nickname = result.nickname;
            try {
              const regDoc = await db.collection('settings').doc('registration').get();
              if (!regDoc.exists) {
                window.showMessage?.('註冊失敗', '註冊系統未啟用或無效的註冊碼。請聯繫管理員。');
                return;
              }

              const storedCode = regDoc.data()?.oneTimeCode;
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
                role: 'unapproved',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                registeredWithCode: true,
                registrationCodeUsed: code
              });

              try {
                await db.collection('settings').doc('registration').set({
                  oneTimeCode: null,
                  oneTimeCodeExpiry: null
                }, { merge: true });
                window.showMessage?.('註冊成功', `歡迎 ${reAuthUser.email} (${nickname})！您的帳號已成功註冊，正在等待審核。`);
              } catch (codeInvalidationError) {
                window.showMessage?.('註冊待審核', `歡迎 ${reAuthUser.email} (${nickname})！您的帳號已成功註冊，正在等待審核。`);
              }
            } catch (error) {
              window.showMessage?.('註冊失敗', `使用註冊碼登入/註冊時發生錯誤: ${error.message}`);
            }
          });
        } else {
          window.showMessage?.('登入成功', `歡迎回來 ${user.email}！`);
        }
      } catch (error) {
        if (els.loginMessage) els.loginMessage.textContent = `登入失敗: ${error.message}`;
        window.showMessage?.('登入失敗', `Google 登入時發生錯誤: ${error.message}`);
      }
    });
  }

  // 登出按鈕
  if (els.logoutBtn) {
    els.logoutBtn.addEventListener('click', async () => {
      try {
        await auth.signOut();
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('kml_')) {
            localStorage.removeItem(key);
          }
        });
        window.showMessage?.('登出成功', '用戶已登出。');
        setTimeout(() => {
            location.reload();
        }, 1000);
      } catch (error) {
        window.showMessage?.('登出失敗', `登出時發生錯誤: ${error.message}`);
      }
    });
  }
  
  if (els.selectedKmlFileNameDashboard && els.hiddenKmlFileInput) {
    els.selectedKmlFileNameDashboard.addEventListener('click', () => els.hiddenKmlFileInput.click());

    els.hiddenKmlFileInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) {
        els.selectedKmlFileNameDashboard.textContent = file.name;
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
      const file = e.target.files[0];
      if (!file) return;

      const confirmUpload = await window.showConfirmationModal(
        '確認上傳',
        `您選擇了檔案：<br><strong style="color: red;">${file.name}</strong><br>確定要執行上傳嗎？`
      );

      if (confirmUpload) {
        els.uploadKmlSubmitBtnDashboard.click();
      } else {
        els.hiddenKmlFileInput.value = '';
      }
    });
  }

  if (els.triggerDeleteBtn) {
    els.triggerDeleteBtn.addEventListener('click', async () => {
      const options = Array.from(els.kmlLayerSelectDashboard.options)
        .filter(opt => opt.value !== "")
        .map(opt => `<option value="${opt.value}">${opt.textContent}</option>`)
        .join('');

      if (!options) {
        window.showMessage?.('提示', '目前沒有可刪除的 KML 圖層。');
        return;
      }

      const modalContent = `
        <div style="text-align: left; margin-top: 10px;">
          <p>請選擇要刪除的圖層：</p>
          <select id="modalKmlDeletePicker" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #ddd; margin-top: 5px;">
            ${options}
          </select>
          <p style="color: #d32f2f; font-size: 12px; margin-top: 10px; font-weight: bold;">⚠️ 警告：刪除後資料將無法復原。</p>
        </div>`;

      const confirmDelete = await window.showConfirmationModal('刪除圖層', modalContent);

      if (confirmDelete) {
        const selectedId = document.getElementById('modalKmlDeletePicker').value;
        if (selectedId) {
          els.kmlLayerSelectDashboard.value = selectedId;
          els.deleteSelectedKmlBtn.click();
        }
      }
    });
  }

  // 上傳 KML 處理
  if (els.uploadKmlSubmitBtnDashboard) {
    els.uploadKmlSubmitBtnDashboard.addEventListener('click', async () => {
      const file = els.hiddenKmlFileInput?.files?.[0];
      if (!file || !auth.currentUser) return;

      if (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor') {
        window.showMessage?.('錯誤', '您沒有權限上傳 KML。');
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const geojson = toGeoJSON.kml(new DOMParser().parseFromString(reader.result, 'text/xml'));
          const kmlLayersCollectionRef = getKmlCollectionRef();
          const existingKmlQuery = await kmlLayersCollectionRef.where('name', '==', file.name).get();
          let kmlLayerDocRef = existingKmlQuery.empty ? kmlLayersCollectionRef.doc() : existingKmlQuery.docs[0].ref;

          await kmlLayerDocRef.set({
            name: file.name,
            uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
            uploadedBy: auth.currentUser.email,
            uploadedByRole: window.currentUserRole,
            geojson: JSON.stringify(geojson)
          }, { merge: true });

          const now = Date.now();
          await db.collection('artifacts').doc(appId).collection('public').doc('data')
            .collection('metadata').doc('sync').set({ lastUpdate: now, lastUpdateTime: new Date(now).toLocaleString('zh-TW') }, { merge: true });

          localStorage.removeItem('kml_list_cache_data');
          localStorage.removeItem(`kml_data_${kmlLayerDocRef.id}`);

          window.showMessage?.('成功', `KML "${file.name}" 已處理成功。`);
          await optimizedUpdateKmlLayerSelects();
          updatePinButtonState();
          els.hiddenKmlFileInput.value = '';
        } catch (error) {
          window.showMessage?.('錯誤', error.message);
        }
      };
      reader.readAsText(file);
    });
  }

  // 刪除 KML 處理
  if (els.deleteSelectedKmlBtn) {
    els.deleteSelectedKmlBtn.addEventListener('click', async () => {
      // 權限再次檢查
      if (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor') {
        window.showMessage?.('錯誤', '您沒有權限刪除 KML。');
        return;
      }

      const kmlIdToDelete = els.kmlLayerSelectDashboard.value;
      const selectedOption = els.kmlLayerSelectDashboard.options[els.kmlLayerSelectDashboard.selectedIndex];
      const kmlName = selectedOption ? selectedOption.textContent : null;

      if (!kmlIdToDelete) return;

      try {
        await getKmlCollectionRef().doc(kmlIdToDelete).delete();
        
        if (typeof window.cleanupAuditData === 'function' && kmlName) {
          console.log(`[系統] 觸發清查資料清理: ${kmlName}`);
          await window.cleanupAuditData(kmlName);
        }

        const now = Date.now();
        await db.collection('artifacts').doc(currentAppId).collection('public').doc('data')
          .collection('metadata').doc('sync').set({ lastUpdate: now }, { merge: true });

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

  // 清查功能整合邏輯
  const auditBtn = document.getElementById('auditKmlBtn');
  if (auditBtn) {
      auditBtn.onclick = async () => {
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
    
  // 產生一次性註冊碼邏輯
  const generateRegistrationAlphanumericCode = () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '013456789';
    let res = '';
    for (let i = 0; i < 3; i++) res += letters.charAt(Math.floor(Math.random() * letters.length));
    for (let i = 0; i < 5; i++) res += digits.charAt(Math.floor(Math.random() * digits.length));
    return res;
  };

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

        window.showMessage?.('成功', `一次性註冊碼已生成並複製到剪貼簿，設定為 60 秒後過期！`);
      } catch (error) {
        window.showMessage?.('錯誤', `生成註冊碼失敗: ${error.message}`);
      }
    });
  }

  // 刷新使用者列表按鈕
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

  if (els.kmlLayerSelect) {
    els.kmlLayerSelect.addEventListener('change', handleKmlLayerSelectChange);
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
  }
})();