// auth-kml-management.js v1.9

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const loggedInDashboard = document.getElementById('loggedInDashboard');
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginMessage = document.getElementById('loginMessage');
    const userEmailDisplay = document.getElementById('userEmailDisplay');
    const pinButton = document.getElementById('pinButton');
    const kmlLayerSelect = document.getElementById('kmlLayerSelect');

    const uploadKmlSectionDashboard = document.getElementById('uploadKmlSectionDashboard');
    const selectedKmlFileNameDashboard = document.getElementById('selectedKmlFileNameDashboard');
    const uploadKmlSubmitBtnDashboard = document.getElementById('uploadKmlSubmitBtnDashboard');
    const hiddenKmlFileInput = document.getElementById('hiddenKmlFileInput');
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

    window.currentUserRole = null;
    let currentKmlLayers = [];
    let registrationCodeTimer = null;
    let currentPinnedKmlId = null;
    let kmlListInitialized = false;

// 圖層清單快取（只存 id 與 name）
    window.kmlListCache = null;
    window._kmlListLoading = null;

// 首次展開下拉才載入清單
    const kmlLayerSelect = document.getElementById('kmlLayerSelect');
    if (kmlLayerSelect) {
      kmlLayerSelect.addEventListener('focus', async () => {
        if (!kmlListInitialized) {
          await updateKmlLayerSelects(); // 第一次才去 Firestore 抓
          kmlListInitialized = true;
        }
      });
    }

    const getRoleDisplayName = (role) => {
        switch (role) {
            case 'unapproved': return '未審核';
            case 'user': return '一般';
            case 'editor': return '編輯者';
            case 'owner': return '擁有者';
            default: return role;
        }
    };

    const updatePinButtonState = () => {
        if (!pinButton || !kmlLayerSelect) return;

        const kmlId = kmlLayerSelect.value;
        const pinnedId = localStorage.getItem('pinnedKmlId');
        
        if (kmlId) {
            pinButton.removeAttribute('disabled');
        } else {
            pinButton.setAttribute('disabled', 'true');
        }

        if (kmlId && pinnedId === kmlId) {
            pinButton.classList.add('clicked');
        } else {
            pinButton.classList.remove('clicked');
        }
    };

    const handleKmlLayerSelectChange = () => {
        const kmlId = kmlLayerSelect?.value;
    
        updatePinButtonState();
    
        if (kmlId && typeof window.loadKmlLayerFromFirestore === 'function') {
            // 🔍 避免相同圖層重複讀取
            if (window.currentKmlLayerId === kmlId) {
                console.log(`⚠️ 已載入圖層 ${kmlId}，略過 change 觸發的重複讀取`);
                return;
            }
            window.loadKmlLayerFromFirestore(kmlId);
        } else if (!kmlId && typeof window.clearAllKmlLayers === 'function') {
            window.clearAllKmlLayers();
        }
    };
       
    // --- 載入釘選圖層（應用啟動時），已修正重複讀取問題 ---
   function tryLoadPinnedKmlLayerWhenReady() {
     const pinnedId = localStorage.getItem('pinnedKmlId');
     const kmlLayerSelect = document.getElementById('kmlLayerSelect');
   
     if (pinnedId && kmlLayerSelect) {
       const option = Array.from(kmlLayerSelect.options).find(opt => opt.value === pinnedId);
       if (option) {
         kmlLayerSelect.value = pinnedId;
   
         if (typeof window.loadKmlLayerFromFirestore === 'function') {
           console.log(`🔖 發現已釘選圖層 ${pinnedId}，自動載入`);
           window.loadKmlLayerFromFirestore(pinnedId); // ✅ 只有釘選時才自動載入
         }
   
         updatePinButtonState(); // 更新圖釘按鈕狀態
         return;
       } else {
         // 如果釘選的圖層不存在，清掉狀態
         localStorage.removeItem('pinnedKmlId');
         currentPinnedKmlId = null;
         console.warn(`已釘選的 KML 圖層 ID ${pinnedId} 不存在，已清除釘選狀態。`);
       }
     } else {
       console.log("無釘選圖層 → 等使用者操作才載入");
     }
   }
   
// 更新 KML 圖層下拉選單（有快取機制）
const updateKmlLayerSelects = async (force = false) => {
  const kmlLayerSelect = document.getElementById('kmlLayerSelect');
  const kmlLayerSelectDashboard = document.getElementById('kmlLayerSelectDashboard');
  const deleteSelectedKmlBtn = document.getElementById('deleteSelectedKmlBtn');

  if (!kmlLayerSelect) {
    console.error("找不到 KML 圖層下拉選單。");
    return;
  }

  // 如果已有快取且不是強制重抓，直接用快取重畫
  if (!force && window.kmlListCache) {
    renderKmlOptions(window.kmlListCache);
    tryLoadPinnedKmlLayerWhenReady();
    return;
  }

  // 如果已經在抓取，等待同一個 Promise
  if (window._kmlListLoading) {
    await window._kmlListLoading;
    renderKmlOptions(window.kmlListCache || []);
    tryLoadPinnedKmlLayerWhenReady();
    return;
  }

  // 沒有快取 → Firestore 抓一次集合
  window._kmlListLoading = (async () => {
    try {
      const kmlRef = db.collection('artifacts').doc(appId)
        .collection('public').doc('data').collection('kmlLayers');

      let snapshot;
      if (window.currentUserRole === 'editor' && auth.currentUser?.email) {
        snapshot = await kmlRef.where('uploadedBy', '==', auth.currentUser.email).get();
      } else {
        snapshot = await kmlRef.get(); // ⚠️ 每個文件都算一次讀取
      }

      const list = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        list.push({
          id: doc.id,
          name: data.name || `KML_${doc.id.substring(0, 8)}`
        });
      });

      // 存快取
      window.kmlListCache = list;

      // 渲染下拉選單
      renderKmlOptions(list);
      tryLoadPinnedKmlLayerWhenReady();
    } catch (err) {
      console.error("更新 KML 圖層列表時出錯:", err);
      window.showMessage('錯誤', '無法載入 KML 圖層列表。');
    } finally {
      window._kmlListLoading = null;
    }
  })();

  await window._kmlListLoading;

  // ====== 渲染函式 ======
  function renderKmlOptions(list) {
    // 重設選項
    kmlLayerSelect.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
    if (kmlLayerSelectDashboard) {
      kmlLayerSelectDashboard.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
    }

    // 依清單建立 option
    list.forEach(({ id, name }) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = name;
      kmlLayerSelect.appendChild(opt);

      if (kmlLayerSelectDashboard) {
        const opt2 = document.createElement('option');
        opt2.value = id;
        opt2.textContent = name;
        kmlLayerSelectDashboard.appendChild(opt2);
      }
    });

    // 刪除按鈕權限控制
    const canEdit = (window.currentUserRole === 'owner' || window.currentUserRole === 'editor');
    if (deleteSelectedKmlBtn) {
      deleteSelectedKmlBtn.disabled = !(canEdit && list.length > 0);
    }
  }
};

    if (typeof window.showConfirmationModal === 'undefined') {
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
    }

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
                        window.showMessage('成功', `用戶 ${nicknameToUpdate} 的角色已更新為 ${getRoleDisplayName(newRole)}。`);
                        select.dataset.originalValue = newRole;
                        changeButton.disabled = true;
                    } catch (error) {
                        window.showMessage('錯誤', `更新角色失敗: ${error.message}`);
                        select.value = select.dataset.originalValue;
                        changeButton.disabled = true;
                    }
                });
            });
    
            userListDiv.querySelectorAll('.delete-user-btn').forEach(button => {
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
                        window.showMessage('成功', `用戶 ${nicknameToDelete} 已刪除。`);
                        userCard.remove();
                    } catch (error) {
                        window.showMessage('錯誤', `刪除失敗: ${error.message}`);
                    }
                });
            });   
        } catch (error) {
            userListDiv.innerHTML = `<p style="color: red;">載入用戶列表失敗: ${error.message}</p>`;
            console.error("載入用戶列表時出錯:", error);
        }
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

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            loginForm.style.display = 'none';
            loggedInDashboard.style.display = 'block';
            userEmailDisplay.textContent = `${user.email} (載入中...)`;
            userEmailDisplay.style.display = 'block';

            db.collection('users').doc(user.uid).onSnapshot(async (doc) => {
                if (doc.exists) {
                    const userData = doc.data();
                    window.currentUserRole = userData.role || 'unapproved';

                    console.log("用戶角色:", window.currentUserRole);
                    userEmailDisplay.textContent = `${user.email} (${getRoleDisplayName(window.currentUserRole)})`;

                    const canEdit = (window.currentUserRole === 'owner' || window.currentUserRole === 'editor');
                    const isOwner = (window.currentUserRole === 'owner');

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
                        window.showMessage('帳號審核中', '您的帳號正在等待管理員審核。在審核通過之前，您將無法上傳或刪除 KML。');
                    }
                    // await updateKmlLayerSelects(); 避免登入時就讀取 Firestore
                    updatePinButtonState();
                } else {
                    console.log("用戶數據不存在，為新註冊用戶創建預設數據。");
                    auth.signOut();
                    window.showMessage('帳號資料異常', '您的帳號資料有誤或已被移除，請重新登入或聯繫管理員。');
                }
            }, (error) => {
                if (!auth.currentUser && error.code === 'permission-denied') {
                    console.warn("因登出導致的權限錯誤，已忽略訊息。");
                } else {
                    console.error("監聽用戶角色時出錯:", error);
                    window.showMessage('錯誤', `獲取用戶角色失敗: ${error.message}`);
                    auth.signOut();
                }
            });

        } else {
            loginForm.style.display = 'block';
            loggedInDashboard.style.display = 'none';
            userEmailDisplay.textContent = '';
            userEmailDisplay.style.display = 'none';
            window.currentUserRole = null;
            await updateKmlLayerSelects(true);
            updatePinButtonState();
        }
    });

    googleSignInBtn.addEventListener('click', async () => {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            const userCredential = await auth.signInWithPopup(provider);
            const user = userCredential.user;

            const userDoc = await db.collection('users').doc(user.uid).get();
            if (!userDoc.exists) {
                auth.signOut();
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
                                    window.showMessage('註冊失敗', '無效或過期的註冊碼。');
                                    console.error(`註冊失敗: 註冊碼不匹配或已過期。`);
                                    return;
                                }
                            } else {
                                window.showMessage('註冊失敗', '註冊系統未啟用或無效的註冊碼。請聯繫管理員。');
                                console.error("settings/registration 文檔不存在。");
                                return;
                            }
                            
                            const reAuthUserCredential = await auth.signInWithPopup(provider);
                            const reAuthUser = reAuthUserCredential.user;

                            console.log("嘗試創建新用戶文檔:", {
                                uid: reAuthUser.uid,
                                email: reAuthUser.email,
                                name: nickname,
                                role: 'unapproved',
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

                            try {
                                await db.collection('settings').doc('registration').set({
                                    oneTimeCode: null,
                                    oneTimeCodeExpiry: null
                                }, { merge: true });
                                console.warn("一次性註冊碼已在 Firestore 中失效（前端嘗試操作）。");
                                window.showMessage('註冊成功', `歡迎 ${reAuthUser.email} (${nickname})！您的帳號已成功註冊，正在等待審核。`);
                            } catch (codeInvalidationError) {
                                console.warn("前端嘗試使註冊碼失效時發生權限不足錯誤:", codeInvalidationError.message);
                                window.showMessage(
                                    '註冊待審核', 
                                    `歡迎 ${reAuthUser.email} (${nickname})！您的帳號已成功註冊，正在等待審核。`
                                );
                            }

                        } catch (error) {
                            console.error("使用註冊碼登入/註冊失敗:", error);
                            if (error.code) {
                                console.error(`Firebase Error Code: ${error.code}`);
                            }
                            window.showMessage('註冊失敗', `使用註冊碼登入/註冊時發生錯誤: ${error.message} (請檢查安全規則)`);
                        }
                    } else {
                        window.showMessage('取消', '您已取消註冊。');
                    }
                });
            } else {
                window.showMessage('登入成功', `歡迎回來 ${user.email}！`);
            }
        }
        catch (error) {
            console.error("Google 登入失敗:", error);
            loginMessage.textContent = `登入失敗: ${error.message}`;
            window.showMessage('登入失敗', `Google 登入時發生錯誤: ${error.message}`);
        }
    });

    logoutBtn.addEventListener('click', async () => {
        try {
            await auth.signOut();
            window.showMessage('登出成功', '用戶已登出。');
        } catch (error) {
            console.error("登出失敗:", error);
            window.showMessage('登出失敗', `登出時發生錯誤: ${error.message}`);
        }
    });

    selectedKmlFileNameDashboard.addEventListener('click', () => {
        hiddenKmlFileInput.click();
    });

    hiddenKmlFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            selectedKmlFileNameDashboard.textContent = file.name;
            uploadKmlSubmitBtnDashboard.disabled = false;
        } else {
            selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
            uploadKmlSubmitBtnDashboard.disabled = true;
        }
    });

    uploadKmlSubmitBtnDashboard.addEventListener('click', async () => {
        const file = hiddenKmlFileInput.files[0];
        if (!file) {
            window.showMessage('提示', '請先選擇 KML 檔案。');
            return;
        }
        if (!auth.currentUser || (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor')) {
            window.showMessage('錯誤', '您沒有權限上傳 KML，請登入或等待管理員審核。');
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

                const geojson = toGeoJSON.kml(kmlDoc); 
                const parsedFeatures = geojson.features || []; 

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
                    window.showMessage('KML 載入', 'KML 檔案中沒有找到任何可顯示的地理要素 (點、線、多邊形)。請確認 KML 檔案內容包含 <Placemark> 及其有效的地理要素。');
                    console.warn("KML 檔案不包含任何可用的 Point、LineString 或 Polygon 類型 feature。");
                    return;
                }

                const kmlLayersCollectionRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers');
                
                const existingKmlQuery = await kmlLayersCollectionRef.where('name', '==', fileName).get();
                let kmlLayerDocRef;
                let isOverwriting = false;

                if (!existingKmlQuery.empty) {
                    const confirmOverwrite = await window.showConfirmationModal(
                        '覆蓋 KML 檔案',
                        `資料庫中已存在名為 "${fileName}" 的 KML 圖層。您確定要覆蓋它嗎？`
                    );

                    if (!confirmOverwrite) {
                        window.showMessage('已取消', 'KML 檔案上傳已取消。');
                        hiddenKmlFileInput.value = '';
                        selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
                        uploadKmlSubmitBtnDashboard.disabled = true;
                        return;
                    }

                    kmlLayerDocRef = existingKmlQuery.docs[0].ref;
                    isOverwriting = true;
                    console.log(`找到相同名稱的 KML 圖層 "${fileName}"，使用者確認覆蓋。ID: ${kmlLayerDocRef.id}`);

                    const oldFeaturesSnapshot = await kmlLayersCollectionRef.doc(kmlLayerDocRef.id).collection('features').get();
                    const deleteBatch = db.batch();
                    oldFeaturesSnapshot.forEach(doc => {
                        deleteBatch.delete(doc.ref);
                    });
                    await deleteBatch.commit();
                    console.log(`已從子集合中刪除 ${oldFeaturesSnapshot.size} 個 features。`);

                    await kmlLayerDocRef.update({
                        uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
                        uploadedBy: auth.currentUser.email || auth.currentUser.uid,
                        uploadedByRole: window.currentUserRole
                    });
                    console.log(`已更新主 KML 圖層文件 ${kmlLayerDocRef.id} 的元數據。`);

                } else {
                    kmlLayerDocRef = await kmlLayersCollectionRef.add({
                        name: fileName,
                        uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
                        uploadedBy: auth.currentUser.email || auth.currentUser.uid,
                        uploadedByRole: window.currentUserRole
                    });
                    console.log(`沒有找到相同名稱的 KML 圖層，已新增一個。ID: ${kmlLayerDocRef.id}`);
                }

               // const featuresSubCollectionRef = kmlLayersCollectionRef.doc(kmlLayerDocRef.id).collection('features');
               // const batch = db.batch();
               // let addedCount = 0;
               // console.log(`開始批量寫入 ${parsedFeatures.length} 個 features 到 ${kmlLayerDocRef.id} 的子集合。`);
               // for (const f of parsedFeatures) {
               //     if (f.geometry && f.properties && f.geometry.coordinates) {
               //         batch.set(featuresSubCollectionRef.doc(), {
               //             geometry: f.geometry,
               //             properties: f.properties
               //         });
               //         addedCount++;
               //     } else {
               //         console.warn("上傳時跳過無效或無座標的 feature:", f.geometry ? f.geometry.type : '無幾何資訊', f);
               //     }
               // }
               // await batch.commit();
               // console.log(`批量提交成功。已添加 ${addedCount} 個 features。`)
               
                const successMessage = isOverwriting ? 
                    `KML 檔案 "${fileName}" 已成功覆蓋並儲存 ${addedCount} 個地理要素。` :
                    `KML 檔案 "${fileName}" 已成功上傳並儲存 ${addedCount} 個地理要素。`;
                Window.showMessage('成功', successMessage);
                hiddenKmlFileInput.value = '';
                selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
                uploadKmlSubmitBtnDashboard.disabled = true;
                await updateKmlLayerSelects();
                updatePinButtonState();
            } catch (error) {
                console.error("處理 KML 檔案或上傳到 Firebase 時出錯:", error);
                window.showMessage('KML 處理錯誤', `處理 KML 檔案或上傳時發生錯誤：${error.message}`);
            }
        };
        reader.readAsText(file);
    });

    deleteSelectedKmlBtn.addEventListener('click', async () => {
        const kmlIdToDelete = kmlLayerSelectDashboard.value;
        if (!kmlIdToDelete) {
            window.showMessage('提示', '請先選擇要刪除的 KML 圖層。');
            return;
        }
        if (!auth.currentUser || (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor')) {
            window.showMessage('錯誤', '您沒有權限刪除 KML。');
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
                window.showMessage('錯誤', '找不到該 KML 圖層。');
                return;
            }
            const kmlData = kmlDoc.data();
            const fileName = kmlData.name;

            const featuresSubCollectionRef = kmlLayerDocRef.collection('features');
            const featuresSnapshot = await featuresSubCollectionRef.get();
            const batch = db.batch();
            let deletedFeaturesCount = 0;
            featuresSnapshot.forEach(docRef => {
                batch.delete(docRef.ref);
                deletedFeaturesCount++;
            });
            await batch.commit();
            console.log(`已從子集合中刪除 ${deletedFeaturesCount} 個 features。`);

            await kmlLayerDocRef.delete();
            console.log(`已刪除父 KML 圖層文檔: ${kmlIdToDelete}`);

            window.showMessage('成功', `KML 圖層 "${fileName}" 已成功刪除，共刪除 ${deletedFeaturesCount} 個地理要素。`);
            await updateKmlLayerSelects();
            window.clearAllKmlLayers();
            updatePinButtonState();
        }
        catch (error) {
            console.error("刪除 KML 失敗:", error);
            window.showMessage('刪除失敗', `刪除 KML 圖層時發生錯誤: ${error.message}`);
        }
    });

    function generateRegistrationAlphanumericCode() {
        let result = '';
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const digits = '013456789';
        for (let i = 0; i < 3; i++) {
            result += letters.charAt(Math.floor(Math.random() * letters.length));
        }
        for (let i = 0; i < 5; i++) {
            result += digits.charAt(Math.floor(Math.random() * digits.length));
        }
        return result;
    }

    generateRegistrationCodeBtn.addEventListener('click', async () => {
        if (window.currentUserRole !== 'owner') {
            window.showMessage('權限不足', '只有管理員才能生成註冊碼。');
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

            window.showMessage('成功', `一次性註冊碼已生成並複製到剪貼簿，設定為 ${countdownSeconds} 秒後過期！`);
        } catch (error) {
            console.error("生成註冊碼時出錯:", error);
            window.showMessage('錯誤', `生成註冊碼失敗: ${error.message}`);
        }
    });

    refreshUsersBtn.addEventListener('click', () => {
        if (window.currentUserRole !== 'owner') {
            window.showMessage('權限不足', '只有管理員才能查看或編輯使用者列表。');
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

    if (kmlLayerSelect) {
      kmlLayerSelect.addEventListener('change', handleKmlLayerSelectChange);
    } else {
      console.error('找不到 id 為 "kmlLayerSelect" 的下拉選單，KML 載入功能無法啟用。');
    }

    if (pinButton) {
        pinButton.addEventListener('click', () => {
            const selectedKmlId = kmlLayerSelect.value;
            const currentPinnedId = localStorage.getItem('pinnedKmlId');

            if (!selectedKmlId) {
                window.showMessage('釘選失敗', '請先從下拉選單中選擇一個 KML 圖層才能釘選。');
                return;
            }
            
            if (currentPinnedId === selectedKmlId) {
                localStorage.removeItem('pinnedKmlId');
                window.showMessageCustom({
                    title: '取消釘選',
                    message: `「${kmlLayerSelect.options[kmlLayerSelect.selectedIndex]?.textContent || selectedKmlId}」已取消釘選，下次將不自動載入。`,
                    buttonText: '確定',
                    autoClose: true,
                    autoCloseDelay: 3000
                });
            } else {
                localStorage.setItem('pinnedKmlId', selectedKmlId);
                const selectedOption = kmlLayerSelect.options[kmlLayerSelect.selectedIndex];
                const kmlLayerName = selectedOption ? selectedOption.textContent : selectedKmlId;
                window.showMessageCustom({
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
});