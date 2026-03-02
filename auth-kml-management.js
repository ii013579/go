// auth-kml-management.js v2.01

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

    uploadKmlSectionDashboard: $('uploadKmlSectionDashboard'),
    selectedKmlFileNameDashboard: $('selectedKmlFileNameDashboard'),
    uploadKmlSubmitBtnDashboard: $('uploadKmlSubmitBtnDashboard'),
    hiddenKmlFileInput: $('hiddenKmlFileInput'),
    deleteKmlSectionDashboard: $('deleteKmlSectionDashboard'),
    kmlLayerSelectDashboard: $('kmlLayerSelectDashboard'),
    deleteSelectedKmlBtn: $('deleteSelectedKmlBtn'),

    registrationSettingsSection: $('registrationSettingsSection'),
    generateRegistrationCodeBtn: $('generateRegistrationCodeBtn'),
    registrationCodeDisplay: $('registrationCodeDisplay'),
    registrationCodeCountdown: $('registrationCodeCountdown'),
    registrationExpiryDisplay: $('registrationExpiryDisplay'),

    userManagementSection: $('userManagementSection'),
    refreshUsersBtn: $('refreshUsersBtn'),
    userListDiv: $('userList'),

    // 確認視窗相關元素（若不存在，showConfirmationModal 會 fallback）
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

  // 取得 KML collection 的 Firestore 參照（DRY）
// ======= 【新增：確認 appId 來源】 =======
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

  // 更新釘選按鈕狀態（是否 enable / 顯示為已釘選樣式）
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

  // 當 KML 下拉選單變更時處理（避免重複向 Firestore 請求）
  const handleKmlLayerSelectChange = () => {
    const select = els.kmlLayerSelect;
    const kmlId = select?.value || '';

    updatePinButtonState();

    if (kmlId && typeof window.loadKmlLayerFromFirestore === 'function') {
      // 若已載入相同圖層則跳過，避免重複讀取
      if (window.currentKmlLayerId === kmlId) {
        console.log(`⚠️ 已載入圖層 ${kmlId}，略過 change 觸發的重複讀取`);
        return;
      }
      window.loadKmlLayerFromFirestore(kmlId);
    } else if (!kmlId && typeof window.clearAllKmlLayers === 'function') {
      // 若沒有選擇任何圖層，清除地圖上的圖層
      window.clearAllKmlLayers();
    }
  };

  // 優化後的釘選載入邏輯
const tryLoadPinnedKmlLayerWhenReady = () => {
    // 【修改 1】執行鎖檢查
    if (hasInitialAutoLoaded) return; 

    const select = els.kmlLayerSelect;
    const pinnedId = localStorage.getItem('pinnedKmlId') || localStorage.getItem('pinnedKmlLayerId');

    // 若無釘選或下拉選單尚未生成，則不動作
    if (!pinnedId || !select) return;

    // 【修改 2】檢查清單是否已經渲染完成 (如果 options 只有 1 個通常是 "請選擇")
    if (select.options.length <= 1) {
      console.log("⏳ 選單清單尚未就緒，延後自動載入...");
      return; 
    }

    // 檢查釘選 ID 是否在目前的選項中
    const option = Array.from(select.options).find(opt => opt.value === pinnedId);
    
    if (!option) {
      // 只有在清單已從網路抓完(且長度>1)的情況下，找不到才刪除
      console.warn(`📌 釘選的 ID ${pinnedId} 已不存在於資料庫，清除狀態`);
      localStorage.removeItem('pinnedKmlId');
      localStorage.removeItem('pinnedKmlLayerId');
      return;
    }

    // 【修改 3】執行載入並鎖定
    if (typeof window.loadKmlLayerFromFirestore === 'function') {
      // 再次檢查地圖狀態，防止與其他手動操作競爭
      if (window.mapNamespace?.isLoadingKml || window.mapNamespace?.currentKmlLayerId === pinnedId) {
        return;
      }

      console.log(`🚀 [初始載入] 執行釘選圖層: ${pinnedId}`);
      hasInitialAutoLoaded = true; // 關鍵：上鎖，此後不再自動觸發
      
      select.value = pinnedId;
      updatePinButtonState();
      window.loadKmlLayerFromFirestore(pinnedId);
    }
  };

/**
   * 更新 KML 下拉選單內容，並處理權限相關 UI
   */
const updateKmlLayerSelects = async (passedLayers = null) => {
    const select = els.kmlLayerSelect;
    const selectDashboard = els.kmlLayerSelectDashboard;
    const deleteBtn = els.deleteSelectedKmlBtn;

    if (!select) {
      console.error("找不到 KML 圖層下拉選單。");
      return;
    }

    // --- 【修改 A-1】僅初始化按鈕狀態，暫不清空選單內容以防閃爍 ---
    if (deleteBtn) deleteBtn.disabled = true;
    select.disabled = false;

    // 2. 角色權限 UI 調整
    const canEdit = (window.currentUserRole === 'owner' || window.currentUserRole === 'editor');
    if (els.uploadKmlSectionDashboard) els.uploadKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
    if (els.deleteKmlSectionDashboard) els.deleteKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
    if (selectDashboard) selectDashboard.disabled = !canEdit;
    if (els.uploadKmlSubmitBtnDashboard) els.uploadKmlSubmitBtnDashboard.disabled = !canEdit;

    try {
      let layersToRender = [];

      if (Array.isArray(passedLayers)) {
        layersToRender = passedLayers;
        console.log("♻️ 使用傳入的資料渲染選單");
      } else {
        console.log("🌐 快取失效或未提供，從網路抓取清單");
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
      }

      // --- 【修改 A-2】資料準備就緒，此時才清空並重新填充 DOM ---
      select.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
      if (selectDashboard) selectDashboard.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
      
      currentKmlLayers = []; // 重置全域狀態清單
      
      layersToRender.forEach(layer => {
        const kmlId = layer.id;
        const kmlName = layer.name || `KML_${kmlId.substring(0, 8)}`;
        
        select.appendChild(createOption(kmlId, kmlName));
        if (selectDashboard) selectDashboard.appendChild(createOption(kmlId, kmlName));
        
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

  // 預設的確認視窗函式（若尚未定義則提供 fallback）
  if (typeof window.showConfirmationModal === 'undefined') {
    window.showConfirmationModal = function (title, message) {
      return new Promise(resolve => {
        const overlay = els.confirmationModalOverlay;
        const titleEl = els.confirmationModalTitle;
        const msgEl = els.confirmationModalMessage;
        const yesBtn = els.confirmYesBtn;
        const noBtn = els.confirmNoBtn;

        // 如果視窗 DOM 尚未就緒，為確保流程不中斷，回傳 true（或可改為 false）
        if (!overlay || !titleEl || !msgEl || !yesBtn || !noBtn) {
          console.warn('確認視窗的 DOM 尚未就緒，直接回傳 true（預設）');
          resolve(true);
          return;
        }

        // 顯示 modal
        titleEl.textContent = title;
        msgEl.textContent = message;
        overlay.classList.add('visible');

        // 清理與回傳
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
    if (!container) {
      console.error('找不到使用者列表容器 (#userList)');
      return;
    }
    // 移除現有卡片
    container.querySelectorAll('.user-card').forEach(c => c.remove());

    try {
      const usersRef = db.collection('users');
      const snapshot = await usersRef.get();

      if (snapshot.empty) {
        container.innerHTML = '<p>目前沒有註冊用戶。</p>';
        return;
      }

      const usersData = [];
      snapshot.forEach(doc => {
        const user = doc.data() || {};
        const uid = doc.id;
        // 排除目前登入的使用者（不允許自己變更角色或刪除）
        if (auth.currentUser && uid === auth.currentUser.uid) return;
        usersData.push({ id: uid, ...user });
      });

      // 按角色排序（unapproved, user, editor, owner）
      const roleOrder = { 'unapproved': 1, 'user': 2, 'editor': 3, 'owner': 4 };
      usersData.sort((a, b) => (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99));

      // 產生每一位使用者的卡片
      usersData.forEach(user => {
        const uid = user.id;
        const emailName = user.email ? user.email.split('@')[0] : 'N/A';
        const userCard = document.createElement('div');
        userCard.className = 'user-card';
        userCard.dataset.nickname = user.name || 'N/A';
        userCard.dataset.uid = uid;

        userCard.innerHTML = `
          <div class="user-email">${emailName}</div>
          <div class="user-nickname">${user.name || 'N/A'}</div>
          <div class="user-role-controls">
            <select id="role-select-${uid}" data-uid="${uid}" data-original-value="${user.role || 'unapproved'}" class="user-role-select">
              <option value="unapproved" ${user.role === 'unapproved' ? 'selected' : ''}>未審核</option>
              <option value="user" ${user.role === 'user' ? 'selected' : ''}>一般</option>
              <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>編輯者</option>
              <option value="owner" ${user.role === 'owner' ? 'selected' : ''} ${window.currentUserRole !== 'owner' ? 'disabled' : ''}>擁有者</option>
            </select>
          </div>
          <div class="user-actions">
            <button class="change-role-btn" data-uid="${uid}" disabled>變</button>
            <button class="delete-user-btn action-buttons delete-btn" data-uid="${uid}">刪</button>
          </div>
        `;

        container.appendChild(userCard);
      });

      // 為角色下拉與按鈕綁定事件
      container.querySelectorAll('.user-role-select').forEach(select => {
        const changeButton = select.closest('.user-card').querySelector('.change-role-btn');
        select.addEventListener('change', () => {
          changeButton.disabled = (select.value === select.dataset.originalValue);
        });

        changeButton.addEventListener('click', async () => {
          const userCard = changeButton.closest('.user-card');
          const uidToUpdate = userCard.dataset.uid;
          const nicknameToUpdate = userCard.dataset.nickname;
          const newRole = select.value;

          const confirmUpdate = await window.showConfirmationModal(
            '確認變更角色',
            `確定要將用戶 ${nicknameToUpdate} (${uidToUpdate.substring(0,6)}...) 的角色變更為 ${getRoleDisplayName(newRole)} 嗎？`
          );

          if (!confirmUpdate) {
            select.value = select.dataset.originalValue;
            changeButton.disabled = true;
            return;
          }

          try {
            await db.collection('users').doc(uidToUpdate).update({ role: newRole });
            window.showMessage?.('成功', `用戶 ${nicknameToUpdate} 的角色已更新為 ${getRoleDisplayName(newRole)}。`);
            select.dataset.originalValue = newRole;
            changeButton.disabled = true;
          } catch (error) {
            window.showMessage?.('錯誤', `更新角色失敗: ${error.message}`);
            select.value = select.dataset.originalValue;
            changeButton.disabled = true;
          }
        });
      });

      // 綁定刪除按鈕事件
      container.querySelectorAll('.delete-user-btn').forEach(button => {
        button.addEventListener('click', async () => {
          const userCard = button.closest('.user-card');
          const uidToDelete = userCard.dataset.uid;
          const nicknameToDelete = userCard.dataset.nickname;

          const confirmDelete = await window.showConfirmationModal(
            '確認刪除用戶',
            `確定要刪除用戶 ${nicknameToDelete} (${uidToDelete.substring(0,6)}...) 嗎？此操作不可逆！`
          );

          if (!confirmDelete) return;

          try {
            await db.collection('users').doc(uidToDelete).delete();
            window.showMessage?.('成功', `用戶 ${nicknameToDelete} 已刪除。`);
            userCard.remove();
          } catch (error) {
            window.showMessage?.('錯誤', `刪除失敗: ${error.message}`);
          }
        });
      });

      // 可點擊的表頭排序（如果有 .user-list-header）
      let currentSortKey = 'role';
      let sortAsc = true;

      document.querySelectorAll('.user-list-header .sortable').forEach(header => {
        header.addEventListener('click', () => {
          const key = header.dataset.key;
          if (currentSortKey === key) sortAsc = !sortAsc;
          else { currentSortKey = key; sortAsc = true; }
          sortUserList(currentSortKey, sortAsc);
          updateSortIndicators();
        });
      });

      // 排序函式
      function sortUserList(key, asc = true) {
        const cards = Array.from(document.querySelectorAll('#userList .user-card'));
        const containerEl = document.getElementById('userList');
        const sorted = cards.sort((a, b) => {
          const getValue = (el) => {
            if (key === 'email') return el.querySelector('.user-email')?.textContent?.toLowerCase() || '';
            if (key === 'nickname') return el.querySelector('.user-nickname')?.textContent?.toLowerCase() || '';
            if (key === 'role') return el.querySelector('.user-role-select')?.value || '';
            return '';
          };
          const aVal = getValue(a), bVal = getValue(b);
          return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        });
        sorted.forEach(card => containerEl.appendChild(card));
      }

      // 更新排序指示器
      function updateSortIndicators() {
        document.querySelectorAll('.user-list-header .sortable').forEach(header => {
          header.classList.remove('sort-asc', 'sort-desc');
          if (header.dataset.key === currentSortKey) header.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
        });
      }

    } catch (error) {
      els.userListDiv.innerHTML = `<p style="color: red;">載入用戶列表失敗: ${error.message}</p>`;
      console.error("載入用戶列表時出錯:", error);
    }
  };

// 監聽 Auth 狀態變更以更新 UI
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      // 1. 使用者登入：切換基礎 UI 顯示
      if (els.loginForm) els.loginForm.style.display = 'none';
      if (els.loggedInDashboard) els.loggedInDashboard.style.display = 'block';
      if (els.userEmailDisplay) {
        els.userEmailDisplay.textContent = `${user.email} (載入中...)`;
        els.userEmailDisplay.style.display = 'block';
      }
  
      // ✨ 關鍵優化：防止重複綁定監聽器
      if (unsubUserRole) return; 
  
      const userDocRef = db.collection('users').doc(user.uid);
      unsubUserRole = userDocRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
          auth.signOut();
          return;
        }
  
        const userData = doc.data() || {};
        const newRole = userData.role || 'unapproved';
        const roleChanged = (window.currentUserRole !== newRole);
        
        // 先更新角色狀態
        window.currentUserRole = newRole;
             console.log(`[身份驗證] 目前角色: ${window.currentUserRole} (變動: ${roleChanged})`);
        
        if (els.userEmailDisplay) {
          els.userEmailDisplay.textContent = `${user.email} (${getRoleDisplayName(window.currentUserRole)})`;
        }

        // 3. 根據角色調整 UI 權限與顯示狀態
        const canEdit = (window.currentUserRole === 'owner' || window.currentUserRole === 'editor');
        const isOwner = (window.currentUserRole === 'owner');

        const toggleDisplay = (el, show) => { if (el) el.style.display = show ? 'flex' : 'none'; };
        const toggleBlock = (el, show) => { if (el) el.style.display = show ? 'block' : 'none'; };

        toggleDisplay(els.uploadKmlSectionDashboard, canEdit);
        toggleDisplay(els.deleteKmlSectionDashboard, canEdit);
        toggleDisplay(els.registrationSettingsSection, isOwner);
        toggleBlock(els.userManagementSection, isOwner);

        if (els.uploadKmlSubmitBtnDashboard) els.uploadKmlSubmitBtnDashboard.disabled = !canEdit;
        if (els.deleteSelectedKmlBtn) els.deleteSelectedKmlBtn.disabled = !canEdit; 
        if (els.kmlLayerSelectDashboard) els.kmlLayerSelectDashboard.disabled = !canEdit;

        if (isOwner && typeof refreshUserList === 'function') refreshUserList();

        if (window.currentUserRole === 'unapproved') {
          window.showMessage?.('帳號審核中', '您的帳號正在等待管理員審核。');
        }

        // --- 【讀取次數優化攔截】 ---
        if (!hasInitialMenuLoaded || roleChanged) {
                // 在 await 之前就先鎖定，防止伺服器端與本地快取端同時衝進來
                hasInitialMenuLoaded = true; 
                console.log(`[Firebase] 觸發清單讀取 (原因: ${roleChanged ? '角色變動' : '初始載入'})`);
                await optimizedUpdateKmlLayerSelects();
              }
            }, (error) => {
              console.error("監聽角色失敗:", error);
            });
        
          } else {
            // 登出時：務必解除監聽並重設 flag
            if (unsubUserRole) {
              unsubUserRole();
              unsubUserRole = null;
            }
            hasInitialMenuLoaded = false;
            window.currentUserRole = null;
      
      if (typeof window.clearAllKmlLayers === 'function') window.clearAllKmlLayers();
      if (typeof updateKmlLayerSelects === 'function') updateKmlLayerSelects([]); 
    }
  });

/**
 * 整合：時間戳比對、清單快取、以及「單次觸發」的圖釘自動載入
 */
async function optimizedUpdateKmlLayerSelects() {
  // 【修改 B-1】檢查是否正在執行中
  if (isUpdatingList) {
    console.log("清單更新進行中，略過本次呼叫");
    return;
  }
  isUpdatingList = true; // 上鎖

  const LIST_CACHE_KEY = 'kml_list_cache_data';
  const SYNC_TIME_KEY = 'kml_list_last_sync';

  try {
    // 1. 抓取遠端「獨立時間戳記」
    const syncSnap = await getSyncDocRef().get();
    const serverUpdate = syncSnap.exists ? (syncSnap.data().lastUpdate || 0) : 0;
    const localUpdate = parseInt(localStorage.getItem(SYNC_TIME_KEY) || "0");
    const cachedData = localStorage.getItem(LIST_CACHE_KEY);

    // 2. 比對時間戳：若無變動則使用快取
    if (cachedData && serverUpdate <= localUpdate && serverUpdate !== 0) {
      console.log("%c[清單快取命中] 伺服器資料無變動", "color: #4CAF50; font-weight: bold;");
      await updateKmlLayerSelects(JSON.parse(cachedData));
      
      tryLoadPinnedKmlLayerWhenReady(); 
      return;
    }

    // 3. 若失效，執行全量讀取
    console.log("%c[清單更新] 偵測到新資料，從 Firebase 同步", "color: #FF9800; font-weight: bold;");
    const snapshot = await getKmlCollectionRef().get();
    const layers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 4. 更新本地快取
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

  // Google 登入按鈕事件（處理新帳號註冊流程：需註冊碼）
  if (els.googleSignInBtn) {
    els.googleSignInBtn.addEventListener('click', async () => {
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const userCredential = await auth.signInWithPopup(provider);
        const user = userCredential.user;

        const userDoc = await db.collection('users').doc(user.uid).get();
        if (!userDoc.exists) {
          // 若使用者文件不存在，先登出，顯示註冊碼 modal（由外部實作 showRegistrationCodeModal）
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
                console.error("settings/registration 文檔不存在。");
                return;
              }

              const storedCode = regDoc.data()?.oneTimeCode;
              const expiryTime = regDoc.data()?.oneTimeCodeExpiry ? regDoc.data().oneTimeCodeExpiry.toDate() : null;
              const currentTime = new Date();

              // 驗證註冊碼是否正確且未過期
              if (!storedCode || storedCode !== code || (expiryTime && currentTime > expiryTime)) {
                window.showMessage?.('註冊失敗', '無效或過期的註冊碼。');
                console.error(`註冊失敗: 註冊碼不匹配或已過期。`);
                return;
              }

              // 重新進行一次 popup 登入以確保 user id
              const reAuth = await auth.signInWithPopup(provider);
              const reAuthUser = reAuth.user;

              // 建立使用者文件（初始為 unapproved）
              await db.collection('users').doc(reAuthUser.uid).set({
                email: reAuthUser.email,
                name: nickname,
                role: 'unapproved',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                registeredWithCode: true,
                registrationCodeUsed: code
              });

              // 前端嘗試失效註冊碼（若無權限，僅記錄）
              try {
                await db.collection('settings').doc('registration').set({
                  oneTimeCode: null,
                  oneTimeCodeExpiry: null
                }, { merge: true });
                console.warn("一次性註冊碼已在 Firestore 中失效（前端嘗試操作）。");
                window.showMessage?.('註冊成功', `歡迎 ${reAuthUser.email} (${nickname})！您的帳號已成功註冊，正在等待審核。`);
              } catch (codeInvalidationError) {
                console.warn("前端嘗試使註冊碼失效時發生權限不足錯誤:", codeInvalidationError.message);
                window.showMessage?.('註冊待審核', `歡迎 ${reAuthUser.email} (${nickname})！您的帳號已成功註冊，正在等待審核。`);
              }
            } catch (error) {
              console.error("使用註冊碼登入/註冊失敗:", error);
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

// 登出按鈕
  if (els.logoutBtn) {
    els.logoutBtn.addEventListener('click', async () => {
      try {
        await auth.signOut();
        
        // ======= 【新增：登出時清理所有 KML 快取】 =======
        // 遍歷所有 localStorage，找出以 kml_ 開頭的 key 並刪除
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('kml_')) {
            localStorage.removeItem(key);
          }
        });
        console.log("[系統] 登出成功，已清理本地 KML 快取。");
        // ===============================================

        window.showMessage?.('登出成功', '用戶已登出。');
        
        // 通常建議登出後重新整理網頁，以重置所有全域變數狀態
        setTimeout(() => {
            location.reload();
        }, 1000);

      } catch (error) {
        console.error("登出失敗:", error);
        window.showMessage?.('登出失敗', `登出時發生錯誤: ${error.message}`);
      }
    });
  }
  
  // 檔案選擇器：點擊 filename 面板會觸發 hidden file input
  if (els.selectedKmlFileNameDashboard && els.hiddenKmlFileInput) {
    els.selectedKmlFileNameDashboard.addEventListener('click', () => els.hiddenKmlFileInput.click());

    // 當使用者選擇檔案時，更新顯示與按鈕狀態
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

// 上傳 KML 處理
  if (els.uploadKmlSubmitBtnDashboard) {
    els.uploadKmlSubmitBtnDashboard.addEventListener('click', async () => {
      const file = els.hiddenKmlFileInput?.files?.[0];
      if (!file) {
        window.showMessage?.('提示', '請先選擇 KML 檔案。');
        return;
      }
      if (!auth.currentUser || (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor')) {
        window.showMessage?.('錯誤', '您沒有權限上傳 KML。');
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const kmlString = reader.result;
          const parser = new DOMParser();
          const kmlDoc = parser.parseFromString(kmlString, 'text/xml');

          if (kmlDoc.getElementsByTagName('parsererror').length > 0) {
            throw new Error(`KML XML 解析錯誤。`);
          }

          const geojson = toGeoJSON.kml(kmlDoc);
          const parsedFeatures = geojson.features || [];

          if (parsedFeatures.length === 0) {
            window.showMessage?.('KML 載入', '檔案中沒有找到地理要素。');
            return;
          }

          const fileName = file.name;
          const kmlLayersCollectionRef = getKmlCollectionRef();

          // 檢查覆蓋邏輯
          const existingKmlQuery = await kmlLayersCollectionRef.where('name', '==', fileName).get();
          let kmlLayerDocRef;
          let isOverwriting = false;

          if (!existingKmlQuery.empty) {
            const confirmOverwrite = await window.showConfirmationModal(
              '覆蓋 KML 檔案',
              `確定要覆蓋 "${fileName}" 嗎？`
            );
            if (!confirmOverwrite) return;

            kmlLayerDocRef = existingKmlQuery.docs[0].ref;
            isOverwriting = true;

            // 清理舊子集合 (相容舊結構)
            const oldFeaturesSnapshot = await kmlLayerDocRef.collection('features').get();
            if (!oldFeaturesSnapshot.empty) {
              const deleteBatch = db.batch();
              oldFeaturesSnapshot.forEach(d => deleteBatch.delete(d.ref));
              await deleteBatch.commit();
            }
          } else {
            kmlLayerDocRef = kmlLayersCollectionRef.doc();
          }

          // 1. 寫入 KML 主資料 (大檔案)
          await kmlLayerDocRef.set({
            name: fileName,
            uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
            uploadedBy: auth.currentUser.email || auth.currentUser.uid,
            uploadedByRole: window.currentUserRole,
            geojson: JSON.stringify(geojson)
          }, { merge: true });

          // ======= 【核心優化：觸發全域同步與清理快取】 =======
          const targetKmlId = kmlLayerDocRef.id;
          const now = Date.now();

          // 2. 更新全域同步戳記 (讓其他使用者知道有更新)
          await db.collection('artifacts').doc(appId)
            .collection('public').doc('data')
            .collection('metadata').doc('sync')
            .set({ lastUpdate: now }, { merge: true });

          // 3. 清理自己的本地快取 (確保選單與內容立即更新)
          localStorage.removeItem('kml_list_cache_data'); // 清單快取
          localStorage.removeItem('kml_list_last_sync');  // 清單時間戳
          localStorage.removeItem(`kml_data_${targetKmlId}`); // 該圖層內容快取
          localStorage.removeItem(`kml_time_${targetKmlId}`); // 該圖層內容時間戳

          console.log(`%c[同步成功] 已更新全域時間戳並清理本地快取`, "color: #4CAF50; font-weight: bold;");
          // ===============================================

          window.showMessage?.('成功', `KML "${fileName}" 已上傳/覆蓋成功。`);

          if (els.hiddenKmlFileInput) els.hiddenKmlFileInput.value = '';
          if (els.selectedKmlFileNameDashboard) els.selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
          
          // 重新載入選單 (這會因為上面清除了快取而從 Firebase 抓取最新清單)
          await optimizedUpdateKmlLayerSelects(); 
          updatePinButtonState();

        } catch (error) {
          console.error("上傳出錯:", error);
          window.showMessage?.('錯誤', error.message);
        }
      };
      reader.readAsText(file);
    });
  }
  
  // 刪除所選 KML
  if (els.deleteSelectedKmlBtn) {
    els.deleteSelectedKmlBtn.addEventListener('click', async () => {
      const kmlIdToDelete = els.kmlLayerSelectDashboard?.value || '';
      if (!kmlIdToDelete) {
        window.showMessage?.('提示', '請先選擇要刪除的圖層。');
        return;
      }
      if (!auth.currentUser || (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor')) {
        window.showMessage?.('錯誤', '您沒有權限刪除。');
        return;
      }

      const confirmDelete = await window.showConfirmationModal('確認刪除', '確定要刪除此 KML 嗎？此操作不可逆！');
      if (!confirmDelete) return;

      try {
        const kmlLayerDocRef = getKmlCollectionRef().doc(kmlIdToDelete);
        
        // 1. 執行刪除 (消耗 1 次寫入)
        await kmlLayerDocRef.delete();

        // ======= 【核心優化：觸發全域同步】 =======
        const now = Date.now();

        // 2. 更新全域同步戳記 (通知所有使用者移除此選單項)
        await db.collection('artifacts').doc(appId)
          .collection('public').doc('data')
          .collection('metadata').doc('sync')
          .set({ lastUpdate: now }, { merge: true });

        // 3. 清理自己的本地快取
        localStorage.removeItem('kml_list_cache_data');
        localStorage.removeItem('kml_list_last_sync');
        localStorage.removeItem(`kml_data_${kmlIdToDelete}`);
        localStorage.removeItem(`kml_time_${kmlIdToDelete}`);
        
        console.log(`%c[同步成功] 已刪除圖層並更新全域同步戳記`, "color: #F44336; font-weight: bold;");
        // ===============================================

        window.showMessage?.('成功', `圖層已刪除。`);
        
        // 重新同步選單
        await optimizedUpdateKmlLayerSelects();
        window.clearAllKmlLayers?.();
        updatePinButtonState();
      } catch (error) {
        console.error("刪除失敗:", error);
        window.showMessage?.('刪除失敗', error.message);
      }
    });
  }
  
  // 產生一次性註冊碼（英文字母 + 數字）
  const generateRegistrationAlphanumericCode = () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '013456789';
    let res = '';
    for (let i = 0; i < 3; i++) res += letters.charAt(Math.floor(Math.random() * letters.length));
    for (let i = 0; i < 5; i++) res += digits.charAt(Math.floor(Math.random() * digits.length));
    return res;
  };

  // 生成註冊碼按鈕（僅 owner 可用）
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

        // 將註冊碼與過期時間寫入 Firestore（server-side 規則亦應強制驗證）
        await db.collection('settings').doc('registration').set({
          oneTimeCode: code,
          oneTimeCodeExpiry: firebase.firestore.Timestamp.fromDate(expiryDate)
        }, { merge: true });

        if (els.registrationCodeDisplay) els.registrationCodeDisplay.textContent = code;
        if (els.registrationCodeCountdown) els.registrationCodeCountdown.textContent = ` (剩餘 ${countdownSeconds} 秒)`;
        if (els.registrationCodeDisplay) els.registrationCodeDisplay.style.display = 'inline-block';
        if (els.registrationCodeCountdown) els.registrationCodeCountdown.style.display = 'inline-block';
        if (els.registrationExpiryDisplay) els.registrationExpiryDisplay.style.display = 'none';

        // 啟動倒數計時器（前端顯示用）
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

        // 嘗試複製到剪貼簿（優先使用 navigator.clipboard）
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

  // 刷新使用者列表按鈕（切換顯示、僅 owner 可用）
  if (els.refreshUsersBtn) {
    els.refreshUsersBtn.addEventListener('click', () => {
      if (window.currentUserRole !== 'owner') {
        window.showMessage?.('權限不足', '只有管理員才能查看或編輯使用者列表。');
        return;
      }
      const isVisible = els.userListDiv?.style.display !== 'none';
      if (!els.userListDiv) return;
      if (isVisible) els.userListDiv.style.display = 'none';
      else { els.userListDiv.style.display = 'block'; refreshUserList(); }
    });
  }

  // 綁定 kmlLayerSelect 的 change 事件
  if (els.kmlLayerSelect) {
    els.kmlLayerSelect.addEventListener('change', handleKmlLayerSelectChange);
  } else {
    console.error('找不到 id 為 "kmlLayerSelect" 的下拉選單，KML 載入功能無法啟用。');
  }

  // 釘選按鈕行為：切換 localStorage 的 pinnedKmlId
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
        // 取消釘選
        localStorage.removeItem('pinnedKmlId');
        window.showMessageCustom?.({
          title: '取消釘選',
          message: `「${select.options[select.selectedIndex]?.textContent || selectedKmlId}」已取消釘選，下次將不自動載入。`,
          buttonText: '確定',
          autoClose: true,
          autoCloseDelay: 3000
        });
      } else {
        // 設定新的釘選
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

  // IIFE 結束
})();