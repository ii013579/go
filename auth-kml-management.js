// auth-kml-management.js

document.addEventListener('DOMContentLoaded', () => {
	  tryLoadPinnedKmlLayerWhenReady();  //載入預設圖層與圖釘狀態
    // 獲取所有相關的 DOM 元素
    const loginForm = document.getElementById('loginForm');
    const loggedInDashboard = document.getElementById('loggedInDashboard');
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginMessage = document.getElementById('loginMessage');
    const userEmailDisplay = document.getElementById('userEmailDisplay');

    const uploadKmlSectionDashboard = document.getElementById('uploadKmlSectionDashboard');
    const selectedKmlFileNameDashboard = document.getElementById('selectedKmlFileNameDashboard');
    const uploadKmlSubmitBtnDashboard = document.getElementById('uploadKmlSubmitBtnDashboard');
    const hiddenKmlFileInput = document.getElementById('hiddenKmlFileInput'); // 新增這行
    const deleteKmlSectionDashboard = document.getElementById('deleteKmlSectionDashboard');
    const kmlLayerSelectDashboard = document.getElementById('kmlLayerSelectDashboard');
    const deleteSelectedKmlBtn = document.getElementById('deleteSelectedKmlBtn');

    const registrationSettingsSection = document.getElementById('registrationSettingsSection');
    const generateRegistrationCodeBtn = document.getElementById('generateRegistrationCodeBtn');
    const registrationCodeDisplay = document.getElementById('registrationCodeDisplay');
    const registrationCodeCountdown = document.getElementById('registrationCodeCountdown');
    const registrationExpiryDisplay = document.getElementById('registrationExpiryDisplay');

    const userManagementSection = document.getElementById('userManagementSection');
    const refreshUsersBtn = document.getElementById('refreshUsersBtn');
    const userListDiv = document.getElementById('userList');

    // 全局變數
    window.currentUserRole = null;
    let currentKmlLayers = [];
    let registrationCodeTimer = null;

    // 輔助函數：將角色英文轉換為中文
    const getRoleDisplayName = (role) => {
        switch (role) {
            case 'unapproved': return '未審核';
            case 'user': return '一般';
            case 'editor': return '編輯者';
            case 'owner': return '擁有者';
            default: return role;
        }
    };

    // 輔助函數：定義角色排序
    const roleOrder = {
        'unapproved': 1,
        'user': 2,
        'editor': 3,
        'owner': 4
    };

// --- KML 圖層選擇變更處理 ---
    function handleKmlLayerSelectChange() {
      const kmlSelect = document.getElementById('kmlLayerSelect');
      const selectedKmlId = kmlSelect?.value;
      const pinBtn = document.getElementById('pinButton');
    
      if (!selectedKmlId) {
        if (typeof window.clearAllKmlLayers === 'function') {
          window.clearAllKmlLayers();
        }
        if (pinBtn) {
          pinBtn.setAttribute('disabled', 'true');
          pinBtn.classList.remove('clicked');
        }
        return;
      }
    
      if (typeof window.loadKmlLayerFromFirestore === 'function') {
        window.loadKmlLayerFromFirestore(selectedKmlId);
      }
    
      if (pinBtn) {
        const pinnedId = localStorage.getItem('pinnedKmlLayerId');
        if (pinnedId === selectedKmlId) {
          pinBtn.classList.add('clicked'); // 紅圖釘
        } else {
          pinBtn.classList.remove('clicked'); // 白圖釘
        }
        pinBtn.removeAttribute('disabled');
      }
    }
    
    // 自動套用釘選圖層
    function tryLoadPinnedKmlLayerWhenReady() {
      const pinnedId = localStorage.getItem('pinnedKmlLayerId');
      const kmlSelect = document.getElementById('kmlLayerSelect');
      const pinBtn = document.getElementById('pinButton');
    
      if (!pinnedId || !kmlSelect) return;
    
      const option = Array.from(kmlSelect.options).find(opt => opt.value === pinnedId);
      if (option) {
        kmlSelect.value = pinnedId;
    
        if (typeof window.loadKmlLayerFromFirestore === 'function') {
          window.loadKmlLayerFromFirestore(pinnedId);
        }
    
        // ✅ 將圖釘變紅，啟用按鈕
        if (pinBtn) {
          pinBtn.classList.add('clicked');
          pinBtn.removeAttribute('disabled');
        }
      }
    };
  
    // --- 整合 updateKmlLayerSelects ---
    const updateKmlLayerSelects = async () => {
      const kmlLayerSelect = document.getElementById('kmlLayerSelect');
      const kmlLayerSelectDashboard = document.getElementById('kmlLayerSelectDashboard');
      const deleteSelectedKmlBtn = document.getElementById('deleteSelectedKmlBtn');
    
      kmlLayerSelect.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
      if (kmlLayerSelectDashboard) {
        kmlLayerSelectDashboard.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
      }
      if (deleteSelectedKmlBtn) deleteSelectedKmlBtn.disabled = true;
    
      kmlLayerSelect.disabled = false;
    
      const canEdit = (window.currentUserRole === 'owner' || window.currentUserRole === 'editor');
    
      if (uploadKmlSectionDashboard) {
        uploadKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
      }
      if (deleteKmlSectionDashboard) {
        deleteKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
      }
    
      if (kmlLayerSelectDashboard) kmlLayerSelectDashboard.disabled = !canEdit;
      if (uploadKmlSubmitBtnDashboard) uploadKmlSubmitBtnDashboard.disabled = !canEdit;
    
      try {
        const kmlRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers');
        let snapshot;
    
        if (window.currentUserRole === 'editor' && auth.currentUser && auth.currentUser.email) {
          snapshot = await kmlRef.where('uploadedBy', '==', auth.currentUser.email).get();
        } else {
          snapshot = await kmlRef.get();
        }
    
        currentKmlLayers = [];
    
        if (snapshot.empty) {
          console.log("沒有 KML 圖層資料。");
          return;
        }
    
        snapshot.forEach(doc => {
          const data = doc.data();
          const kmlId = doc.id;
          const kmlName = data.name || `KML_${kmlId.substring(0, 8)}`;
    
          const option = document.createElement('option');
          option.value = kmlId;
          option.textContent = kmlName;
          kmlLayerSelect.appendChild(option);
    
          if (kmlLayerSelectDashboard) {
            const optionDashboard = document.createElement('option');
            optionDashboard.value = kmlId;
            optionDashboard.textContent = kmlName;
            kmlLayerSelectDashboard.appendChild(optionDashboard);
          }
    
          currentKmlLayers.push({ id: kmlId, name: kmlName });
        });
    
        if (currentKmlLayers.length > 0 && canEdit && deleteSelectedKmlBtn) {
          deleteSelectedKmlBtn.disabled = false;
        }
    
        // ✅ 安全重新綁定 change 事件（不重複綁定）
        kmlLayerSelect.removeEventListener('change', handleKmlLayerSelectChange);
        kmlLayerSelect.addEventListener('change', handleKmlLayerSelectChange);
    
      } catch (error) {
        console.error("更新 KML 圖層列表時出錯:", error);
        showMessage('錯誤', '無法載入 KML 圖層列表。');
      }
    
      // ✅ 自動載入 pinned 圖層（但不會影響釘選狀態）
      if (typeof window.tryLoadPinnedKmlLayerWhenReady === 'function') {
        window.tryLoadPinnedKmlLayerWhenReady();
      }
    };

    // 輔助函數：顯示自訂確認模態框
    window.showConfirmationModal = function(title, message) {
        return new Promise(resolve => {
            const modalOverlay = document.getElementById('confirmationModalOverlay');
            const modalTitle = document.getElementById('confirmationModalTitle');
            const modalMessage = document.getElementById('confirmationModalMessage');
            const confirmYesBtn = document.getElementById('confirmYesBtn');
            const confirmNoBtn = document.getElementById('confirmNoBtn');

            modalTitle.textContent = title;
            modalMessage.textContent = message;
            modalOverlay.classList.add('visible');

            const cleanupAndResolve = (result) => {
                modalOverlay.classList.remove('visible');
                confirmYesBtn.removeEventListener('click', yesHandler);
                confirmNoBtn.removeEventListener('click', noHandler);
                resolve(result);
            };

            const yesHandler = () => cleanupAndResolve(true);
            const noHandler = () => cleanupAndResolve(false);

            confirmYesBtn.addEventListener('click', yesHandler);
            confirmNoBtn.addEventListener('click', noHandler);
        });
    };

    // 輔助函數：顯示用戶管理列表
    const refreshUserList = async () => {
    const cards = userListDiv.querySelectorAll('.user-card');
    cards.forEach(card => card.remove());    

        try {
            const usersRef = db.collection('users');
            const snapshot = await usersRef.get();
    
            if (snapshot.empty) {
                userListDiv.innerHTML = '<p>目前沒有註冊用戶。</p>';
                return;
            }
    
            let usersData = [];
            snapshot.forEach(doc => {
                const user = doc.data();
                const uid = doc.id;
                if (uid !== auth.currentUser.uid) {
                    usersData.push({ id: uid, ...user });
                }
            });
    
            // 預設先依角色排序
            const roleOrder = {
                'unapproved': 1,
                'user': 2,
                'editor': 3,
                'owner': 4
            };
            usersData.sort((a, b) => {
                const roleA = roleOrder[a.role] || 99;
                const roleB = roleOrder[b.role] || 99;
                return roleA - roleB;
            });
    
            // 建立 user-card 元素
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
                    <select id="role-select-${uid}" data-uid="${uid}" data-original-value="${user.role}" class="user-role-select">
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
                userListDiv.appendChild(userCard);
            });
    
            // 綁定角色下拉選單與變更按鈕事件
            userListDiv.querySelectorAll('.user-role-select').forEach(select => {
                const changeButton = select.closest('.user-card').querySelector('.change-role-btn');
                select.addEventListener('change', () => {
                    changeButton.disabled = (select.value === select.dataset.originalValue);
                });
    
                changeButton.addEventListener('click', async () => {
                    const userCard = changeButton.closest('.user-card');
                    const uidToUpdate = userCard.dataset.uid;
                    const nicknameToUpdate = userCard.dataset.nickname;
                    const newRole = select.value;
    
                    const confirmUpdate = await showConfirmationModal(
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
                        showMessage('成功', `用戶 ${nicknameToUpdate} 的角色已更新為 ${getRoleDisplayName(newRole)}。`);
                        select.dataset.originalValue = newRole;
                        changeButton.disabled = true;
                    } catch (error) {
                        showMessage('錯誤', `更新角色失敗: ${error.message}`);
                        select.value = select.dataset.originalValue;
                        changeButton.disabled = true;
                    }
                });
            });
    
            // 綁定刪除按鈕事件
            userListDiv.querySelectorAll('.delete-user-btn').forEach(button => {
                button.addEventListener('click', async () => {
                    const userCard = button.closest('.user-card');
                    const uidToDelete = userCard.dataset.uid;
                    const nicknameToDelete = userCard.dataset.nickname;
    
                    const confirmDelete = await showConfirmationModal(
                        '確認刪除用戶',
                        `確定要刪除用戶 ${nicknameToDelete} (${uidToDelete.substring(0,6)}...) 嗎？此操作不可逆！`
                    );
    
                    if (!confirmDelete) return;
    
                    try {
                        await db.collection('users').doc(uidToDelete).delete();
                        showMessage('成功', `用戶 ${nicknameToDelete} 已刪除。`);
                        userCard.remove(); // ✅ 不重整，直接從畫面移除
                    } catch (error) {
                        showMessage('錯誤', `刪除失敗: ${error.message}`);
                    }
                });
            });   
        } catch (error) {
            userListDiv.innerHTML = `<p style="color: red;">載入用戶列表失敗: ${error.message}</p>`;
            console.error("載入用戶列表時出錯:", error);
        }
        // ✅ 排序邏輯（加在 refreshUserList 最後）
        let currentSortKey = 'role';
        let sortAsc = true;
   
        document.querySelectorAll('.user-list-header .sortable').forEach(header => {
            header.addEventListener('click', () => {
                const key = header.dataset.key;
   
                if (currentSortKey === key) {
                    sortAsc = !sortAsc;
                } else {
                    currentSortKey = key;
                    sortAsc = true;
                }
   
                sortUserList(currentSortKey, sortAsc);
                updateSortIndicators();
            });
        });
   
        function sortUserList(key, asc = true) {
            const cards = Array.from(document.querySelectorAll('#userList .user-card'));
            const container = document.getElementById('userList');
   
            const sorted = cards.sort((a, b) => {
                const getValue = (el) => {
                    if (key === 'email') return el.querySelector('.user-email')?.textContent?.toLowerCase() || '';
                    if (key === 'nickname') return el.querySelector('.user-nickname')?.textContent?.toLowerCase() || '';
                    if (key === 'role') return el.querySelector('.user-role-select')?.value || '';
                    return '';
                };
                const aVal = getValue(a);
                const bVal = getValue(b);
                return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            });
   
            sorted.forEach(card => container.appendChild(card));
        }
   
        function updateSortIndicators() {
            document.querySelectorAll('.user-list-header .sortable').forEach(header => {
                header.classList.remove('sort-asc', 'sort-desc');
                if (header.dataset.key === currentSortKey) {
                    header.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
                }
            });
        }
     };

    // Firestore 實時監聽器
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            loginForm.style.display = 'none';
            loggedInDashboard.style.display = 'block';
            // 顯示用戶郵箱和角色
            userEmailDisplay.textContent = `${user.email} (${getRoleDisplayName(window.currentUserRole)})`;
            userEmailDisplay.style.display = 'block';

            db.collection('users').doc(user.uid).onSnapshot(async (doc) => {
                if (doc.exists) {
                    const userData = doc.data();
                    window.currentUserRole = userData.role || 'unapproved';

                    console.log("用戶角色:", window.currentUserRole);
                    // 更新用戶郵箱和角色顯示
                    userEmailDisplay.textContent = `${user.email} (${getRoleDisplayName(window.currentUserRole)})`;

                    const canEdit = (window.currentUserRole === 'owner' || window.currentUserRole === 'editor');
                    const isOwner = (window.currentUserRole === 'owner');

                    // 控制 KML 上傳和刪除區塊的顯示
                    if (uploadKmlSectionDashboard) {
                        uploadKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
                    }
                    if (deleteKmlSectionDashboard) {
                        deleteKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
                    }

                    uploadKmlSubmitBtnDashboard.disabled = !canEdit;
                    deleteSelectedKmlBtn.disabled = !(canEdit && currentKmlLayers.length > 0);
                    kmlLayerSelectDashboard.disabled = !canEdit;

                    registrationSettingsSection.style.display = isOwner ? 'flex' : 'none'; 
                    generateRegistrationCodeBtn.disabled = !isOwner;
                    registrationCodeDisplay.style.display = 'inline-block'; 
                    registrationCodeCountdown.style.display = 'inline-block'; 
                    registrationExpiryDisplay.style.display = 'none';

                    userManagementSection.style.display = isOwner ? 'block' : 'none';
                    refreshUsersBtn.disabled = !isOwner;


                    if (isOwner) {
                        refreshUserList();
                    }

                    if (window.currentUserRole === 'unapproved') {
                        showMessage('帳號審核中', '您的帳號正在等待管理員審核。在審核通過之前，您將無法上傳或刪除 KML。');
                    }

                    updateKmlLayerSelects();

                } else {
                    console.log("用戶數據不存在，為新註冊用戶創建預設數據。");
                    auth.signOut();
                    showMessage('帳號資料異常', '您的帳號資料有誤或已被移除，請重新登入或聯繫管理員。');
                }
            }, (error) => {
                // 檢查是否為登出導致的權限錯誤，如果是則不顯示訊息
                if (!auth.currentUser && error.code === 'permission-denied') {
                    console.warn("因登出導致的權限錯誤，已忽略訊息。");
                } else {
                    console.error("監聽用戶角色時出錯:", error);
                    showMessage('錯誤', `獲取用戶角色失敗: ${error.message}`);
                    auth.signOut();
                }
            });

        } else {
            loginForm.style.display = 'block';
            loggedInDashboard.style.display = 'none';
            userEmailDisplay.textContent = '';
            userEmailDisplay.style.display = 'none';
            window.currentUserRole = null;
            updateKmlLayerSelects();
        }
    });

    // 事件監聽器：Google 登入/註冊
    googleSignInBtn.addEventListener('click', async () => {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            const userCredential = await auth.signInWithPopup(provider);
            const user = userCredential.user;

            const userDoc = await db.collection('users').doc(user.uid).get();
            if (!userDoc.exists) {
                await auth.signOut(); // 登出新註冊但尚未驗證角色的用戶
                window.showRegistrationCodeModal(async (result) => {
                    if (result) {
                        const code = result.code;
                        const nickname = result.nickname;

                        try {
                            const regDoc = await db.collection('settings').doc('registration').get();
                            console.log("註冊嘗試: 用戶輸入的註冊碼:", code);
                            if (regDoc.exists) {
                                console.log("Firestore 註冊設定數據:", regDoc.data());
                                const storedCode = regDoc.data().oneTimeCode;
                                const expiryTime = regDoc.data().oneTimeCodeExpiry ? regDoc.data().oneTimeCodeExpiry.toDate() : null;
                                const currentTime = new Date();
                                console.log(`儲存的註冊碼: ${storedCode}, 過期時間: ${expiryTime}, 目前時間: ${currentTime}`);
                                console.log(`註冊碼是否匹配: ${storedCode === code}, 是否過期: ${expiryTime && currentTime > expiryTime}`);


                                if (!storedCode || storedCode !== code || (expiryTime && currentTime > expiryTime)) {
                                    showMessage('註冊失敗', '無效或過期的註冊碼。');
                                    console.error(`註冊失敗: 註冊碼不匹配或已過期。`);
                                    return;
                                }
                            } else {
                                showMessage('註冊失敗', '註冊系統未啟用或無效的註冊碼。請聯繫管理員。');
                                console.error("settings/registration 文檔不存在。");
                                return;
                            }
                            
                            // 重新登入以確保獲取正確的用戶憑證
                            const reAuthUserCredential = await auth.signInWithPopup(provider);
                            const reAuthUser = reAuthUserCredential.user;

                            console.log("嘗試創建新用戶文檔:", {
                                uid: reAuthUser.uid,
                                email: reAuthUser.email,
                                name: nickname,
                                role: 'unapproved', // 預設為未審核
                                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                                registeredWithCode: true,
                                registrationCodeUsed: code
                            });

                            await db.collection('users').doc(reAuthUser.uid).set({
                                email: reAuthUser.email,
                                name: nickname,
                                role: 'unapproved',
                                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                                registeredWithCode: true,
                                registrationCodeUsed: code
                            });
                            console.log("新用戶文檔創建成功。");

                            // 重要提示：前端嘗試使一次性註冊碼失效。
                            // 這需要觸發此操作的用戶擁有對 `settings/registration` 文檔的寫入權限。
                            // 通常，新註冊的用戶（role: 'unapproved'）不會有這種權限，這會導致 "Missing or insufficient permissions" 錯誤。
                            // 推薦的解決方案是使用 Firebase Cloud Functions：
                            // 在用戶成功註冊後（例如，觸發 `onCreate` 用戶事件），
                            // 由後端函數安全地將 `settings/registration` 中的 `oneTimeCode` 設為 `null`。
                            // 這樣可以確保安全且不會因前端權限問題而失敗。
                            // 為了保持此版本的功能，我們將保留此行，但請注意其權限限制。
                            try {
                                await db.collection('settings').doc('registration').set({
                                    oneTimeCode: null,
                                    oneTimeCodeExpiry: null
                                }, { merge: true });
                                console.log("一次性註冊碼已在 Firestore 中失效（前端嘗試操作）。");
                                showMessage('註冊成功', `歡迎 ${reAuthUser.email} (${nickname})！您的帳號已成功註冊，正在等待審核。`);
                            } catch (codeInvalidationError) {
                                console.warn("前端嘗試使註冊碼失效時發生權限不足錯誤:", codeInvalidationError.message);
                                showMessage(
                                    '註冊待審核', 
                                    `歡迎 ${reAuthUser.email} (${nickname})！您的帳號已成功註冊，正在等待審核。`
                                );
                            }

                        } catch (error) {
                            console.error("使用註冊碼登入/註冊失敗:", error);
                            if (error.code) {
                                console.error(`Firebase Error Code: ${error.code}`);
                            }
                            showMessage('註冊失敗', `使用註冊碼登入/註冊時發生錯誤: ${error.message} (請檢查安全規則)`);
                        }
                    } else {
                        showMessage('取消', '您已取消註冊。');
                    }
                });
            } else {
                showMessage('登入成功', `歡迎回來 ${user.email}！`);
            }
        }
        catch (error) {
            console.error("Google 登入失敗:", error);
            loginMessage.textContent = `登入失敗: ${error.message}`;
            showMessage('登入失敗', `Google 登入時發生錯誤: ${error.message}`);
        }
    });

    // 事件監聽器：登出
    logoutBtn.addEventListener('click', async () => {
        try {
            await auth.signOut();
            showMessage('登出成功', '用戶已登出。'); // 登出訊息已修改
        } catch (error) {
            console.error("登出失敗:", error);
            showMessage('登出失敗', `登出時發生錯誤: ${error.message}`);
        }
    });

    // 點擊 "尚未選擇檔案" 對話框也能選取檔案
    selectedKmlFileNameDashboard.addEventListener('click', () => {
        hiddenKmlFileInput.click();
    });

    // 監聽實際的文件選擇變化
    hiddenKmlFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            selectedKmlFileNameDashboard.textContent = file.name;
            uploadKmlSubmitBtnDashboard.disabled = false; // 啟用上傳按鈕
        } else {
            selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
            uploadKmlSubmitBtnDashboard.disabled = true; // 禁用上傳按鈕
        }
    });

// 通用的 GeoJSON 座標標準化函數
function normalizeCoordinates(coords, geometryType) {
    if (!Array.isArray(coords)) {
        return [];
    }

    if (geometryType === 'Point') {
        const flattened = coords.flat(Infinity).filter(val => typeof val === 'number');
        return flattened.slice(0, 2);
    }

    if (geometryType === 'LineString' || geometryType === 'MultiPoint') {
        return coords.map(pair => {
            const flattenedPair = Array.isArray(pair) ? pair.flat(Infinity).filter(val => typeof val === 'number') : [];
            return flattenedPair.slice(0, 2);
        }).filter(pair => pair.length === 2);
    }

    // 針對 Polygon 和 MultiLineString 進行更強健的修正
    if (geometryType === 'Polygon' || geometryType === 'MultiLineString') {
        // 確保每個「環」都是有效的陣列
        return coords.map(ring => {
            if (!Array.isArray(ring)) {
                console.warn(`Malformed ring/line in ${geometryType}:`, ring);
                return [];
            }
            // 處理環中的每個座標對，將其扁平化並移除 z 座標
            return ring.map(pair => {
                const flattenedPair = Array.isArray(pair) ? pair.flat(Infinity).filter(val => typeof val === 'number') : [];
                return flattenedPair.slice(0, 2);
            }).filter(pair => pair.length === 2);
        }).filter(ring => Array.isArray(ring) && ring.length > 0 && ring.every(p => p.length === 2));
    }

    // 針對 MultiPolygon 進行更強健的修正
    if (geometryType === 'MultiPolygon') {
        // 處理每個多邊形
        return coords.map(polygon => {
            if (!Array.isArray(polygon)) {
                console.warn(`Malformed polygon in MultiPolygon:`, polygon);
                return [];
            }
            // 處理多邊形中的每個環
            return polygon.map(ring => {
                if (!Array.isArray(ring)) {
                    console.warn(`Malformed ring in MultiPolygon's polygon:`, ring);
                    return [];
                }
                return ring.map(pair => {
                    const flattenedPair = Array.isArray(pair) ? pair.flat(Infinity).filter(val => typeof val === 'number') : [];
                    return flattenedPair.slice(0, 2);
                }).filter(pair => pair.length === 2);
            }).filter(ring => Array.isArray(ring) && ring.length > 0 && ring.every(p => p.length === 2));
        }).filter(polygon => Array.isArray(polygon) && polygon.length > 0);
    }
    
    // 對於未知的幾何類型，返回空陣列以避免錯誤
    return [];
}


// 實際執行上傳 KML 的函數
uploadKmlSubmitBtnDashboard.addEventListener('click', async () => {
    const file = hiddenKmlFileInput.files[0];
    if (!file) {
        window.showMessageCustom({
            title: '提示',
            message: '請先選擇 KML 檔案。',
            buttonText: '確定'
        });
        return;
    }
    if (!auth.currentUser || (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor')) {
        window.showMessageCustom({
            title: '錯誤',
            message: '您沒有權限上傳 KML，請登入或等待管理員審核。',
            buttonText: '確定'
        });
        return;
    }

    const fileName = file.name;
    const reader = new FileReader();
    reader.onload = async () => {
        console.log(`正在處理 KML 檔案: ${file.name}`);
        try {
            const kmlString = reader.result;
            const parser = new DOMParser();
            const kmlDoc = parser.parseFromString(kmlString, 'text/xml');

            if (kmlDoc.getElementsByTagName('parsererror').length > 0) {
                const errorText = kmlDoc.getElementsByTagName('parsererror')[0].textContent;
                throw new Error(`KML XML 解析錯誤: ${errorText}。請確保您的 KML 檔案是有效的 XML。`);
            }

            let geojson = toGeoJSON.kml(kmlDoc); // 將 KML 轉換為 GeoJSON (JSON 格式)
            
            // --- 診斷日誌：標準化前 GeoJSON 結構 ---
            console.log('--- 原始 GeoJSON (標準化前) ---');
            console.log(JSON.stringify(geojson, null, 2)); // 輸出漂亮的 JSON 格式
            // --- 診斷日誌結束 ---

            // **新增預處理邏輯：處理 GeometryCollection 類型**
            let flattenedFeatures = [];
            geojson.features.forEach(feature => {
                // 如果是 GeometryCollection，則將其拆解成多個獨立的 Feature
                if (feature.geometry && feature.geometry.type === 'GeometryCollection') {
                    feature.geometry.geometries.forEach(geometry => {
                        if (geometry && geometry.coordinates) {
                            flattenedFeatures.push({
                                ...feature, // 複製原始 feature 的所有屬性 (例如 properties)
                                geometry: { // 替換為單一 geometry
                                    type: geometry.type,
                                    coordinates: geometry.coordinates
                                }
                            });
                        }
                    });
                } else {
                    // 如果不是 GeometryCollection，則直接保留
                    flattenedFeatures.push(feature);
                }
            });

            // 將新的扁平化 features 陣列賦回 geojson 物件
            const standardizedGeojson = {
                ...geojson,
                features: flattenedFeatures
            };


            // --- 深度複製 GeoJSON 並標準化其坐標深度 ---
            standardizedGeojson.features = standardizedGeojson.features.map(feature => {
                if (feature.geometry && feature.geometry.coordinates) {
                    // 使用 normalizeCoordinates 函式處理所有幾何類型
                    feature.geometry.coordinates = normalizeCoordinates(feature.geometry.coordinates, feature.geometry.type);
                }
                return feature;
            });

            // --- 診斷日誌：標準化後 GeoJSON 結構 (即將上傳) ---
            console.log('--- 標準化後的 GeoJSON (即將上傳) ---');
            console.log(JSON.stringify(standardizedGeojson, null, 2)); // 輸出漂亮的 JSON 格式
            // --- 診斷日誌結束 ---

            const parsedFeatures = standardizedGeojson.features || []; // <-- 使用標準化後的 GeoJSON

            console.log('--- KML 檔案解析結果 (parsedFeatures) ---');
            console.log(`已解析出 ${parsedFeatures.length} 個地理要素。`);
            if (parsedFeatures.length === 0) {
                console.warn('togeojson.kml() 未能從 KML 檔案中識別出任何地理要素。請確認 KML 包含 <Placemark> 內的 <Point>, <LineString>, <Polygon> 及其有效座標和名稱。');
            } else {
                parsedFeatures.forEach((f, index) => {
                    console.log(`Feature ${index + 1}:`);
                    console.log(`  類型 (geometry.type): ${f.geometry ? f.geometry.type : 'N/A (無幾何資訊)'}`);
                    console.log(`  名稱 (properties.name): ${f.properties ? (f.properties.name || '未命名') : 'N/A (無屬性)'}`);
                    console.log(`  座標 (geometry.coordinates):`, f.geometry ? f.geometry.coordinates : 'N/A');
                });
            }
            console.log('--- KML 檔案解析結果結束 ---');

            if (parsedFeatures.length === 0) {
                window.showMessageCustom({
                    title: 'KML 載入',
                    message: 'KML 檔案中沒有找到任何可顯示的地理要素 (點、線、多邊形)。請確認 KML 檔案內容包含 <Placemark> 及其有效的地理要素。',
                    buttonText: '確定'
                });
                console.warn("KML 檔案不包含任何可用的 Point、LineString 或 Polygon 類型 feature。");
                return;
            }

            const kmlLayersCollectionRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers');

            // 查詢是否存在相同名稱的 KML 圖層
            const existingKmlQuery = await kmlLayersCollectionRef.where('name', '==', fileName).get();
            let kmlLayerDocRef;
            let isOverwriting = false;

            // **修正點：將 GeoJSON 物件轉換為 JSON 字串**
            const geojsonContentString = JSON.stringify(standardizedGeojson);

            if (!existingKmlQuery.empty) {
                // 找到相同名稱的圖層，詢問是否覆蓋
                const confirmOverwrite = await window.showConfirmationModal(
                    '覆蓋 KML 檔案',
                    `資料庫中已存在名為 "${fileName}" 的 KML 圖層。您確定要覆蓋它嗎？`
                );

                if (!confirmOverwrite) {
                    window.showMessageCustom({
                        title: '已取消',
                        message: 'KML 檔案上傳已取消。',
                        buttonText: '確定',
                        autoClose: true,
                        autoCloseDelay: 3000
                    });
                    hiddenKmlFileInput.value = '';
                    selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
                    uploadKmlSubmitBtnDashboard.disabled = true;
                    return; // 終止上傳流程
                }

                // 準備覆蓋
                kmlLayerDocRef = existingKmlQuery.docs[0].ref;
                isOverwriting = true;
                console.log(`找到相同名稱的 KML 圖層 "${fileName}"，使用者確認覆蓋。ID: ${kmlLayerDocRef.id}`);

                // 直接更新主 KML 圖層文件，包含新的 geojsonContent
                await kmlLayerDocRef.update({
                    geojsonContent: geojsonContentString, // <-- 儲存 JSON 字串
                    uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
                    uploadedBy: auth.currentUser.email || auth.currentUser.uid,
                    uploadedByRole: window.currentUserRole
                });
                console.log(`已更新主 KML 圖層文件 ${kmlLayerDocRef.id} 的元數據和 GeoJSON 內容。`);

            } else {
                // 沒有找到相同名稱的圖層，新增一個
                kmlLayerDocRef = await kmlLayersCollectionRef.add({
                    name: fileName,
                    geojsonContent: geojsonContentString, // <-- 儲存 JSON 字串
                    uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
                    uploadedBy: auth.currentUser.email || auth.currentUser.uid,
                    uploadedByRole: window.currentUserRole
                });
                console.log(`沒有找到相同名稱的 KML 圖層，已新增一個。ID: ${kmlLayerDocRef.id}`);
            }

            const successMessage = isOverwriting ?
                `KML 檔案 "${fileName}" 已成功覆蓋並儲存 ${parsedFeatures.length} 個地理要素。` :
                `KML 檔案 "${fileName}" 已成功上傳並儲存 ${parsedFeatures.length} 個地理要素。`;
            window.showMessageCustom({
                title: '成功',
                message: successMessage,
                buttonText: '確定',
                autoClose: true,
                autoCloseDelay: 3000
            });
            hiddenKmlFileInput.value = '';
            selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
            uploadKmlSubmitBtnDashboard.disabled = true;
            updateKmlLayerSelects(); // 重新整理 KML 選單
        } catch (error) {
            console.error("處理 KML 檔案或上傳到 Firebase 時出錯:", error);
            window.showMessageCustom({
                title: 'KML 處理錯誤',
                message: `處理 KML 檔案或上傳時發生錯誤：${error.message}`,
                buttonText: '確定'
            });
        }
    };
    reader.readAsText(file);
});

    // 事件監聽器：刪除 KML
    deleteSelectedKmlBtn.addEventListener('click', async () => {
        const kmlIdToDelete = kmlLayerSelectDashboard.value;
        if (!kmlIdToDelete) {
            window.showMessageCustom({
                title: '提示',
                message: '請先選擇要刪除的 KML 圖層。',
                buttonText: '確定'
            });
            return;
        }
        if (!auth.currentUser || (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor')) {
            window.showMessageCustom({
                title: '錯誤',
                message: '您沒有權限刪除 KML。',
                buttonText: '確定'
            });
            return;
        }

        const confirmDelete = await window.showConfirmationModal(
            '確認刪除 KML',
            '確定要刪除此 KML 圖層及其所有地理要素嗎？此操作不可逆！'
        );

        if (!confirmDelete) {
            return;
        }

        try {
            const kmlLayerDocRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers').doc(kmlIdToDelete);
            const kmlDoc = await kmlLayerDocRef.get();
            if (!kmlDoc.exists) {
                window.showMessageCustom({
                    title: '錯誤',
                    message: '找不到該 KML 圖層。',
                    buttonText: '確定'
                });
                return;
            }
            const kmlData = kmlDoc.data();
            const fileName = kmlData.name;
            // 由於 now GeoJSON 存在於主文件本身，計算地理要素數量
            const featureCount = (kmlData.geojsonContent && kmlData.geojsonContent.features) ? kmlData.geojsonContent.features.length : 0;

            // 只需刪除父 KML 文件
            await kmlLayerDocRef.delete();
            console.log(`已刪除父 KML 圖層文檔: ${kmlIdToDelete}`);

            window.showMessageCustom({
                title: '成功',
                message: `KML 圖層 "${fileName}" 已成功刪除，共包含 ${featureCount} 個地理要素。`,
                buttonText: '確定',
                autoClose: true,
                autoCloseDelay: 3000
            });
            updateKmlLayerSelects();
            window.clearAllKmlLayers(); // 清除地圖上的 KML 圖層
        }
        catch (error) {
            console.error("刪除 KML 失敗:", error);
            window.showMessageCustom({
                title: '刪除失敗',
                message: `刪除 KML 圖層時發生錯誤: ${error.message}`,
                buttonText: '確定'
            });
        }
    });

    // Function to generate the alphanumeric code (3 letters + 5 digits)
    function generateRegistrationAlphanumericCode() {
        let result = '';
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const digits = '013456789'; // 移除 0123456789 中的 2 以符合 3L+5D 模式

        // Generate 3 random letters
        for (let i = 0; i < 3; i++) {
            result += letters.charAt(Math.floor(Math.random() * letters.length));
        }
        // Generate 5 random digits
        for (let i = 0; i < 5; i++) {
            result += digits.charAt(Math.floor(Math.random() * digits.length));
        }
        return result;
    }

    // 事件監聽器：生成一次性註冊碼 (Owner Only)
    generateRegistrationCodeBtn.addEventListener('click', async () => {
        if (window.currentUserRole !== 'owner') {
            showMessage('權限不足', '只有管理員才能生成註冊碼。');
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

            registrationCodeDisplay.textContent = code;
            registrationCodeCountdown.textContent = ` (剩餘 ${countdownSeconds} 秒)`;
            registrationCodeDisplay.style.display = 'inline-block'; 
            registrationCodeCountdown.style.display = 'inline-block';
            registrationExpiryDisplay.style.display = 'none';

            registrationCodeTimer = setInterval(() => {
                countdownSeconds--;
                if (countdownSeconds >= 0) {
                    registrationCodeCountdown.textContent = ` (剩餘 ${countdownSeconds} 秒)`;
                } else {
                    clearInterval(registrationCodeTimer);
                    registrationCodeTimer = null;
                    registrationCodeDisplay.textContent = '註冊碼已過期';
                    registrationCodeCountdown.style.display = 'none';
                }
            }, 1000);
            
            const tempInput = document.createElement('textarea');
            tempInput.value = code;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand('copy');
            document.body.removeChild(tempInput);

            showMessage('成功', `一次性註冊碼已生成並複製到剪貼簿，設定為 ${countdownSeconds} 秒後過期！`);
        } catch (error) {
            console.error("生成註冊碼時出錯:", error);
            showMessage('錯誤', `生成註冊碼失敗: ${error.message}`);
        }
    });

    // 事件監聽器：重新整理用戶列表 (Owner Only)
    refreshUsersBtn.addEventListener('click', () => {
        if (window.currentUserRole !== 'owner') {
            showMessage('權限不足', '只有管理員才能查看或編輯使用者列表。');
            return;
        }
    
        const isVisible = userListDiv.style.display !== 'none';
    
        if (isVisible) {
            userListDiv.style.display = 'none';
        } else {
            userListDiv.style.display = 'block';
            refreshUserList();
        }
    });
    
        // ===== 圖釘按鈕邏輯（改用 img + 背景顏色）=====

  const kmlLayerSelect = document.getElementById('kmlLayerSelect');
  const pinKmlLayerBtn = document.getElementById('pinButton');
  
  // 初始化按鈕狀態
  if (pinKmlLayerBtn) {
      pinKmlLayerBtn.setAttribute('disabled', 'true');
      pinKmlLayerBtn.classList.remove('clicked'); // 清除釘選樣式
  }

  // 當圖層選單改變時，啟用或禁用圖釘按鈕
  kmlLayerSelect.addEventListener('change', () => {
      const hasSelection = !!kmlLayerSelect.value;
  
      if (hasSelection) {
          pinKmlLayerBtn.removeAttribute('disabled');
          pinKmlLayerBtn.classList.remove('clicked'); // 重新選擇圖層時重置為藍色
      } else {
          pinKmlLayerBtn.setAttribute('disabled', 'true');
          pinKmlLayerBtn.classList.remove('clicked');
      }
  });

  // 點擊圖釘按鈕時釘選圖層
  pinKmlLayerBtn?.addEventListener('click', async () => {
    const selectedKmlId = kmlLayerSelect.value;
    const currentPinnedId = localStorage.getItem('pinnedKmlLayerId');
  
    if (!selectedKmlId) {
      window.showMessageCustom({
        title: '釘選失敗',
        message: '請先從下拉選單中選擇一個 KML 圖層才能釘選。',
        buttonText: '確定'
      });
      console.warn('沒有選擇 KML 圖層可釘選。');
      return;
    }
  
    // ✅ 點到已釘選的圖層 → 取消釘選，但「不改變圖層內容或選單」
    if (currentPinnedId === selectedKmlId) {
      localStorage.removeItem('pinnedKmlLayerId');
      pinKmlLayerBtn.classList.remove('clicked'); // ← ✅ 恢復藍色樣式，不要變灰
      window.showMessageCustom({
        title: '取消釘選',
        message: `「${kmlLayerSelect.options[kmlLayerSelect.selectedIndex]?.textContent || selectedKmlId}」已取消釘選，下次將不自動載入。`,
        buttonText: '確定',
        autoClose: true,
        autoCloseDelay: 3000
      });
      return;
    }
  
    // ✅ 點的是未釘選圖層 → 執行釘選
    try {
      console.log(`嘗試釘選 KML 圖層: ${selectedKmlId}`);
      await window.loadKmlLayerFromFirestore(selectedKmlId);
  
      localStorage.setItem('pinnedKmlLayerId', selectedKmlId);
      pinKmlLayerBtn.classList.add('clicked'); // ← ✅ 變紅色
  
      const selectedOption = kmlLayerSelect.options[kmlLayerSelect.selectedIndex];
      const kmlLayerName = selectedOption?.textContent || selectedKmlId;
  
      window.showMessageCustom({
        title: '釘選成功',
        message: `「${kmlLayerName}」已釘選為預設圖層，下次載入網頁時將自動顯示。`,
        buttonText: '確定',
        autoClose: true,
        autoCloseDelay: 3000
      });
    } catch (error) {
      console.error('釘選 KML 圖層失敗:', error);
      window.showMessageCustom({
        title: '釘選失敗',
        message: '載入圖層時發生錯誤，請稍後再試。',
        buttonText: '確定'
      });
    }
  });
});