// auth-kml-management.js v2.0

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
  let currentPinnedKmlId = null;    // 當前釘選的 KML ID（來自 localStorage）

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
  const getKmlCollectionRef = () =>
    db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers');

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

  // 啟動時嘗試載入釘選的 KML（含舊 key 的遷移）
  const tryLoadPinnedKmlLayerWhenReady = () => {
    const select = els.kmlLayerSelect;

    // 1) 舊 key 遷移：pinnedKmlLayerId -> pinnedKmlId
    const oldPinnedId = localStorage.getItem('pinnedKmlLayerId');
    if (oldPinnedId) {
      localStorage.setItem('pinnedKmlId', oldPinnedId);
      localStorage.removeItem('pinnedKmlLayerId');
      console.log('已將舊的釘選狀態轉換為新格式。');
    }

    const pinnedId = localStorage.getItem('pinnedKmlId');
    currentPinnedKmlId = pinnedId;

    // 若無釘選，清空選單並結束
    if (!pinnedId) {
      if (select) select.value = '';
      updatePinButtonState();
      if (typeof window.clearAllKmlLayers === 'function') window.clearAllKmlLayers();
      return;
    }

    // 若找不到 select，跳過（避免例外）
    if (!select) {
      console.warn('找不到 kmlLayerSelect，跳過載入釘選圖層');
      return;
    }

    // 檢查下拉選單中是否含有該釘選 ID
    const option = Array.from(select.options).find(opt => opt.value === pinnedId);
    if (!option) {
      // 若不存在，清除 localStorage 的釘選資料
      localStorage.removeItem('pinnedKmlId');
      currentPinnedKmlId = null;
      console.warn(`已釘選的 KML 圖層 ID ${pinnedId} 不存在，已清除釘選狀態。`);
      select.value = '';
      updatePinButtonState();
      if (typeof window.clearAllKmlLayers === 'function') window.clearAllKmlLayers();
      return;
    }

    // 設定選單值並載入（同樣避免在載入中或已載入相同 ID 時重複載入）
    select.value = pinnedId;
    updatePinButtonState();

    if (typeof window.loadKmlLayerFromFirestore === 'function') {
      if (window.isLoadingKml) {
        console.log("⏳ pinned 等待中：已有其他讀取進行，略過一次");
        return;
      }
      if (window.currentKmlLayerId === pinnedId) {
        console.log(`⚠️ pinned: 已載入 ${pinnedId}，略過重複讀取`);
        return;
      }
      console.log(`📌 pinned: 載入 ${pinnedId}`);
      window.loadKmlLayerFromFirestore(pinnedId);
    }
  };

  // 更新 KML 下拉選單內容，並處理權限相關 UI
  const updateKmlLayerSelects = async () => {
    const select = els.kmlLayerSelect;
    const selectDashboard = els.kmlLayerSelectDashboard;
    const deleteBtn = els.deleteSelectedKmlBtn;

    if (!select) {
      console.error("找不到 KML 圖層下拉選單。");
      return;
    }

    // 初始化下拉選單
    select.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
    if (selectDashboard) selectDashboard.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
    if (deleteBtn) deleteBtn.disabled = true;
    select.disabled = false;

    // 依角色顯示或隱藏上傳/刪除功能
    const canEdit = (window.currentUserRole === 'owner' || window.currentUserRole === 'editor');
    if (els.uploadKmlSectionDashboard) els.uploadKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
    if (els.deleteKmlSectionDashboard) els.deleteKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
    if (selectDashboard) selectDashboard.disabled = !canEdit;
    if (els.uploadKmlSubmitBtnDashboard) els.uploadKmlSubmitBtnDashboard.disabled = !canEdit;

    try {
      const kmlRef = getKmlCollectionRef();
      let snapshot;
      // editor 只能看到自己上傳的圖層（簡易權限分流）
      if (window.currentUserRole === 'editor' && auth.currentUser?.email) {
        snapshot = await kmlRef.where('uploadedBy', '==', auth.currentUser.email).get();
      } else {
        snapshot = await kmlRef.get();
      }

      currentKmlLayers = [];

      if (!snapshot.empty) {
        snapshot.forEach(doc => {
          const data = doc.data() || {};
          const kmlId = doc.id;
          const kmlName = data.name || `KML_${kmlId.substring(0, 8)}`;
          select.appendChild(createOption(kmlId, kmlName));
          if (selectDashboard) selectDashboard.appendChild(createOption(kmlId, kmlName));
          currentKmlLayers.push({ id: kmlId, name: kmlName });
        });
      }

      if (currentKmlLayers.length > 0 && canEdit && deleteBtn) deleteBtn.disabled = false;

      // 嘗試載入釘選的 KML（若有）
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

  // 監聽 Auth 狀態變更以更新 UI（登入 / 登出）
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      // 使用者登入：切換 UI、顯示 loading 狀態
      if (els.loginForm) els.loginForm.style.display = 'none';
      if (els.loggedInDashboard) els.loggedInDashboard.style.display = 'block';
      if (els.userEmailDisplay) {
        els.userEmailDisplay.textContent = `${user.email} (載入中...)`;
        els.userEmailDisplay.style.display = 'block';
      }

      // 監聽使用者文件以取得即時角色變更
      const userDocRef = db.collection('users').doc(user.uid);
      userDocRef.onSnapshot(async (doc) => {
        if (!doc.exists) {
          // 若使用者文件不存在，強制登出並提示
          console.log("用戶數據不存在，為新註冊用戶創建預設數據。");
          auth.signOut();
          window.showMessage?.('帳號資料異常', '您的帳號資料有誤或已被移除，請重新登入或聯繫管理員。');
          return;
        }

        const userData = doc.data() || {};
        window.currentUserRole = userData.role || 'unapproved';
        console.log("用戶角色:", window.currentUserRole);

        if (els.userEmailDisplay) els.userEmailDisplay.textContent = `${user.email} (${getRoleDisplayName(window.currentUserRole)})`;

        const canEdit = (window.currentUserRole === 'owner' || window.currentUserRole === 'editor');
        const isOwner = (window.currentUserRole === 'owner');

        // 根據角色調整 UI 權限
        if (els.uploadKmlSectionDashboard) els.uploadKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
        if (els.deleteKmlSectionDashboard) els.deleteKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
        if (els.uploadKmlSubmitBtnDashboard) els.uploadKmlSubmitBtnDashboard.disabled = !canEdit;
        if (els.deleteSelectedKmlBtn) els.deleteSelectedKmlBtn.disabled = !(canEdit && currentKmlLayers.length > 0);
        if (els.kmlLayerSelectDashboard) els.kmlLayerSelectDashboard.disabled = !canEdit;

        if (els.registrationSettingsSection) els.registrationSettingsSection.style.display = isOwner ? 'flex' : 'none';
        if (els.generateRegistrationCodeBtn) els.generateRegistrationCodeBtn.disabled = !isOwner;
        if (els.registrationCodeDisplay) els.registrationCodeDisplay.style.display = 'inline-block';
        if (els.registrationCodeCountdown) els.registrationCodeCountdown.style.display = 'inline-block';
        if (els.registrationExpiryDisplay) els.registrationExpiryDisplay.style.display = 'none';

        if (els.userManagementSection) els.userManagementSection.style.display = isOwner ? 'block' : 'none';
        if (els.refreshUsersBtn) els.refreshUsersBtn.disabled = !isOwner;

        if (isOwner) refreshUserList();

        // 若帳號為未審核狀態，提示使用者等待審核
        if (window.currentUserRole === 'unapproved') {
          window.showMessage?.('帳號審核中', '您的帳號正在等待管理員審核。在審核通過之前，您將無法上傳或刪除 KML。');
        }

        // 更新下拉選單與釘選按鈕狀態
        await updateKmlLayerSelects();
        updatePinButtonState();
      }, (error) => {
        // 錯誤處理：若是登出造成的 permission-denied，略過
        if (!auth.currentUser && error.code === 'permission-denied') {
          console.warn("因登出導致的權限錯誤，已忽略訊息。");
        } else {
          console.error("監聽用戶角色時出錯:", error);
          window.showMessage?.('錯誤', `獲取用戶角色失敗: ${error.message}`);
          auth.signOut();
        }
      });

    } else {
      // 使用者登出：恢復初始 UI
      if (els.loginForm) els.loginForm.style.display = 'block';
      if (els.loggedInDashboard) els.loggedInDashboard.style.display = 'none';
      if (els.userEmailDisplay) { els.userEmailDisplay.textContent = ''; els.userEmailDisplay.style.display = 'none'; }
      window.currentUserRole = null;
      await updateKmlLayerSelects();
      updatePinButtonState();
    }
  });

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
        window.showMessage?.('登出成功', '用戶已登出。');
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

  // 上傳 KML 處理（包含覆蓋、舊 features 子集合清理、寫入整包 geojson）
  if (els.uploadKmlSubmitBtnDashboard) {
    els.uploadKmlSubmitBtnDashboard.addEventListener('click', async () => {
      const file = els.hiddenKmlFileInput?.files?.[0];
      if (!file) {
        window.showMessage?.('提示', '請先選擇 KML 檔案。');
        return;
      }
      if (!auth.currentUser || (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor')) {
        window.showMessage?.('錯誤', '您沒有權限上傳 KML，請登入或等待管理員審核。');
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const kmlString = reader.result;
          const parser = new DOMParser();
          const kmlDoc = parser.parseFromString(kmlString, 'text/xml');

          // 驗證 XML 是否正確解析
          if (kmlDoc.getElementsByTagName('parsererror').length > 0) {
            const errorText = kmlDoc.getElementsByTagName('parsererror')[0].textContent;
            throw new Error(`KML XML 解析錯誤: ${errorText}。請確保您的 KML 檔案是有效的 XML。`);
          }

          // 轉換為 GeoJSON（依賴 toGeoJSON）
          const geojson = toGeoJSON.kml(kmlDoc);
          const parsedFeatures = geojson.features || [];

          if (parsedFeatures.length === 0) {
            window.showMessage?.('KML 載入', 'KML 檔案中沒有找到任何可顯示的地理要素 (點、線、多邊形)。請確認 KML 檔案內容包含 <Placemark> 及其有效的地理要素。');
            return;
          }

          const fileName = file.name;
          const kmlLayersCollectionRef = getKmlCollectionRef();

          // 檢查是否已存在相同名稱的 KML（決定覆蓋或新增）
          const existingKmlQuery = await kmlLayersCollectionRef.where('name', '==', fileName).get();
          let kmlLayerDocRef;
          let isOverwriting = false;

          if (!existingKmlQuery.empty) {
            // 若存在同名檔案，詢問是否覆蓋
            const confirmOverwrite = await window.showConfirmationModal(
              '覆蓋 KML 檔案',
              `資料庫中已存在名為 "${fileName}" 的 KML 圖層。您確定要覆蓋它嗎？`
            );
            if (!confirmOverwrite) {
              window.showMessage?.('已取消', 'KML 檔案上傳已取消。');
              if (els.hiddenKmlFileInput) els.hiddenKmlFileInput.value = '';
              if (els.selectedKmlFileNameDashboard) els.selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
              if (els.uploadKmlSubmitBtnDashboard) els.uploadKmlSubmitBtnDashboard.disabled = true;
              return;
            }

            kmlLayerDocRef = existingKmlQuery.docs[0].ref;
            isOverwriting = true;

            // 若舊版資料有 features 子集合，於此一併清理（避免殘留）
            const oldFeaturesSnapshot = await kmlLayerDocRef.collection('features').get();
            if (!oldFeaturesSnapshot.empty) {
              const deleteBatch = db.batch();
              oldFeaturesSnapshot.forEach(d => deleteBatch.delete(d.ref));
              await deleteBatch.commit();
              console.log(`已刪除 ${oldFeaturesSnapshot.size} 個舊 features。`);
            }
          } else {
            // 不存在同名則新增文件（先建立再寫入）
            kmlLayerDocRef = await kmlLayersCollectionRef.add({
              name: fileName,
              uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
              uploadedBy: auth.currentUser.email || auth.currentUser.uid,
              uploadedByRole: window.currentUserRole
            });
            console.log(`新增 KML：ID=${kmlLayerDocRef.id}`);
          }

          // 將整包 geojson 以字串儲存到文件中（新結構）
          await kmlLayerDocRef.set({
            name: fileName,
            uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
            uploadedBy: auth.currentUser.email || auth.currentUser.uid,
            uploadedByRole: window.currentUserRole,
            geojson: JSON.stringify(geojson)
          }, { merge: true });

          // 顯示成功訊息並重置 UI
          window.showMessage?.(
            '成功',
            isOverwriting
              ? `KML 檔案 "${fileName}" 已成功覆蓋並儲存 ${parsedFeatures.length} 個地理要素。`
              : `KML 檔案 "${fileName}" 已成功上傳並儲存 ${parsedFeatures.length} 個地理要素。`
          );

          if (els.hiddenKmlFileInput) els.hiddenKmlFileInput.value = '';
          if (els.selectedKmlFileNameDashboard) els.selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
          if (els.uploadKmlSubmitBtnDashboard) els.uploadKmlSubmitBtnDashboard.disabled = true;

          await updateKmlLayerSelects();
          updatePinButtonState();

        } catch (error) {
          console.error("處理 KML 檔案或上傳到 Firebase 時出錯:", error);
          window.showMessage?.('KML 處理錯誤', `處理 KML 檔案或上傳時發生錯誤：${error.message}`);
        }
      };

      // 讀取檔案內容並觸發 onload
      reader.readAsText(file);
    });
  }

  // ��除所選 KML（後台 dashboard）
  if (els.deleteSelectedKmlBtn) {
    els.deleteSelectedKmlBtn.addEventListener('click', async () => {
      const kmlIdToDelete = els.kmlLayerSelectDashboard?.value || '';
      if (!kmlIdToDelete) {
        window.showMessage?.('提示', '請先選擇要刪除的 KML 圖層。');
        return;
      }
      if (!auth.currentUser || (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor')) {
        window.showMessage?.('錯誤', '您沒有權限刪除 KML。');
        return;
      }

      const confirmDelete = await window.showConfirmationModal('確認刪除 KML', '確定要刪除此 KML 圖層嗎？此操作不可逆！');
      if (!confirmDelete) return;

      try {
        const kmlLayerDocRef = getKmlCollectionRef().doc(kmlIdToDelete);
        const kmlDoc = await kmlLayerDocRef.get();
        if (!kmlDoc.exists) {
          window.showMessage?.('錯誤', '找不到該 KML 圖層。');
          return;
        }
        const fileName = kmlDoc.data()?.name || '';

        // 新結構只需刪除主文件
        await kmlLayerDocRef.delete();
        console.log(`已刪除 KML 主文件: ${kmlIdToDelete}`);

        window.showMessage?.('成功', `KML 圖層 "${fileName}" 已成功刪除。`);
        await updateKmlLayerSelects();
        window.clearAllKmlLayers?.();
        updatePinButtonState();
      } catch (error) {
        console.error("刪除 KML 失敗:", error);
        window.showMessage?.('刪除失敗', `刪除 KML 圖層時發生錯誤: ${error.message}`);
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