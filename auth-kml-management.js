// auth-kml-management.js v4.2.31

document.addEventListener('DOMContentLoaded', () => {
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
    let registrationCodeTimer = null; // 用於儲存倒數計時器
    const refreshUsersBtn = document.getElementById('refreshUsersBtn');
    const userList = document.getElementById('userList'); // 用戶列表容器

    // 模態框相關元素
    const registrationCodeModalOverlay = document.getElementById('registrationCodeModalOverlay');
    const registrationCodeInput = document.getElementById('registrationCodeInput');
    const nicknameInput = document.getElementById('nicknameInput');
    const confirmRegistrationCodeBtn = document.getElementById('confirmRegistrationCodeBtn');
    const cancelRegistrationCodeBtn = document.getElementById('cancelRegistrationCodeBtn');
    const registrationModalMessage = document.getElementById('registrationModalMessage');

    // Firestore 和 Auth 實例已在 firebase-init.js 中初始化
    const db = firebase.firestore();
    const auth = firebase.auth();
    const storage = firebase.storage();
    const appId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.projectId; // 確保使用正確的 appId

    // 用戶角色相關變數
    window.currentUserRole = 'guest'; // 預設為 guest

    // --- 輔助函數 ---
    const showMessageBox = window.showMessage; // 引入全局 showMessage 函數
    const showConfirmationBox = window.showConfirmationBox; // 引入全局 showConfirmationBox 函數
    const showRegistrationModal = window.showRegistrationModal; // 引入全局 showRegistrationModal 函數

    // 清除 KML 圖層的輔助函數，直接調用 map-logic.js 中的全局函數
    const clearAllKmlLayers = () => {
        if (typeof window.clearAllKmlLayers === 'function') {
            window.clearAllKmlLayers();
        } else {
            // 如果 window.clearAllKmlLayers 未定義，則嘗試使用 markerLabelsGroup 和 navButtonsGroup
            // 這是一個備用方案，建議確保 map-logic.js 中的函數存在
            console.warn("window.clearAllKmlLayers 函數未定義。嘗試直接清除地圖群組。");
            if (window.markerLabelsGroup) window.markerLabelsGroup.clearLayers();
            if (window.navButtonsGroup) window.navButtonsGroup.clearLayers();
            window.allKmlFeatures = [];
        }
    };


    // --- Firestore 路徑輔助函數 ---
    const getUserDocRef = (uid) => {
        return db.collection('artifacts').doc(appId).collection('users').doc(uid);
    };
    const getRegistrationCodeDocRef = (codeId = 'one-time-code') => {
        return db.collection('artifacts').doc(appId).collection('public').doc('data').collection('registrationCodes').doc(codeId);
    };
    const getKmlLayerRef = (kmlId) => {
        return db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers').doc(kmlId);
    };
    const getKmlFeaturesCollectionRef = (kmlId) => {
        return getKmlLayerRef(kmlId).collection('features');
    };


    // --- 身份驗證狀態監聽 ---
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            loggedInDashboard.style.display = 'block';
            loginForm.style.display = 'none';
            userEmailDisplay.textContent = `歡迎, ${user.email || user.uid}`;
            loginMessage.textContent = ''; // 清除登入訊息

            // 獲取用戶角色
            await fetchUserRole(user.uid);
            updateUiBasedOnRole();

            // 載入可用的 KML 圖層列表
            loadAvailableKmlLayers();

        } else {
            loggedInDashboard.style.display = 'none';
            loginForm.style.display = 'block';
            userEmailDisplay.textContent = '未登入';
            window.currentUserRole = 'guest'; // 重置為 guest
            updateUiBasedOnRole();
            clearAllKmlLayers(); // 用戶登出時清除所有 KML 圖層

            // 檢查是否需要顯示註冊碼模態框
            const storedPrompted = sessionStorage.getItem('promptedForRegistration');
            if (!storedPrompted) {
                showRegistrationModal(async (result) => {
                    sessionStorage.setItem('promptedForRegistration', 'true'); // 設置標誌
                    if (result && result.code && result.nickname) {
                        try {
                            const codeDoc = await getRegistrationCodeDocRef(result.code).get();
                            if (codeDoc.exists && !codeDoc.data().used) {
                                // 嘗試匿名登入以獲取 uid
                                const anonUserCred = await auth.signInAnonymously();
                                const anonUid = anonUserCred.user.uid;

                                // 更新註冊碼狀態為已使用，並記錄使用者的匿名 UID
                                await getRegistrationCodeDocRef(result.code).update({
                                    used: true,
                                    usedBy: anonUid,
                                    usedAt: firebase.firestore.FieldValue.serverTimestamp()
                                });

                                // 在 users 集合中創建新用戶文件
                                await getUserDocRef(anonUid).set({
                                    email: `anonymous-${anonUid.substring(0, 8)}@example.com`,
                                    nickname: result.nickname,
                                    role: 'member', // 新註冊用戶預設為 member
                                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                                    registeredWithCode: result.code
                                });

                                showMessageBox('註冊成功', `您的帳戶已註冊成功，角色為 'member'，您的暱稱是 ${result.nickname}。請重新登入。`);
                                auth.signOut(); // 強制登出以重新觸發 onAuthStateChanged

                            } else {
                                showMessageBox('註冊失敗', '無效的註冊碼或註冊碼已使用。');
                            }
                        } catch (err) {
                            console.error("註冊失敗:", err);
                            showMessageBox('註冊失敗', `註冊過程中發生錯誤: ${err.message}`);
                        }
                    } else {
                        // 用戶取消或時間到期，不執行任何操作
                        showMessageBox('提示', '您取消了註冊或註冊碼已過期。');
                    }
                });
            }
        }
    });


    // --- 角色管理函數 ---
    async function fetchUserRole(uid) {
        try {
            const userDoc = await getUserDocRef(uid).get();
            if (userDoc.exists) {
                window.currentUserRole = userDoc.data().role;
                console.log("用戶角色:", window.currentUserRole);
                if (userDoc.data().nickname) {
                    userEmailDisplay.textContent = `歡迎, ${userDoc.data().nickname} (${userDoc.data().role})`;
                } else {
                    userEmailDisplay.textContent = `歡迎, ${userDoc.data().email || userDoc.id} (${userDoc.data().role})`;
                }
            } else {
                // 如果用戶文檔不存在，可能是新登入的 Google 用戶，建立一個新的 member 角色
                const isGoogleUser = auth.currentUser && auth.currentUser.providerData.some(provider => provider.providerId === 'google.com');
                if (isGoogleUser) {
                    await getUserDocRef(uid).set({
                        email: auth.currentUser.email,
                        nickname: auth.currentUser.displayName || '未設定暱稱',
                        role: 'member', // Google 登入預設為 member
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    window.currentUserRole = 'member';
                    console.log("新 Google 用戶註冊為 member 角色。");
                    userEmailDisplay.textContent = `歡迎, ${auth.currentUser.displayName || auth.currentUser.email} (member)`;
                } else {
                    // 如果不是 Google 用戶且文檔不存在，則視為 guest
                    window.currentUserRole = 'guest';
                    userEmailDisplay.textContent = '未登入';
                    console.log("用戶文檔不存在，設定為 guest 角色。");
                }
            }
        } catch (error) {
            console.error("獲取或設定用戶角色時出錯:", error);
            window.currentUserRole = 'guest'; // 出錯時預設為 guest
            showMessageBox('錯誤', `獲取用戶角色失敗: ${error.message}`);
        }
    }

    function updateUiBasedOnRole() {
        const isOwner = window.currentUserRole === 'owner';
        const isMember = window.currentUserRole === 'member';

        // 控制上傳 KML 區塊的顯示
        uploadKmlSectionDashboard.style.display = (isOwner || isMember) ? 'block' : 'none';

        // 控制刪除 KML 區塊的顯示
        deleteKmlSectionDashboard.style.display = (isOwner || isMember) ? 'block' : 'none';

        // 控制註冊碼設定區塊的顯示 (僅限 owner)
        registrationSettingsSection.style.display = isOwner ? 'block' : 'none';
    }


    // --- KML 圖層管理 ---
    async function loadAvailableKmlLayers() {
        const kmlLayerSelect = document.getElementById('kmlLayerSelect');
        const kmlLayerSelectDashboard = document.getElementById('kmlLayerSelectDashboard');

        // 清空現有選項
        kmlLayerSelect.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
        kmlLayerSelectDashboard.innerHTML = '<option value="">-- 選擇要刪除的 KML 圖層 --</option>';

        try {
            const kmlLayersRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers');
            const snapshot = await kmlLayersRef.get();

            if (snapshot.empty) {
                console.log("沒有可用的 KML 圖層。");
                return;
            }

            snapshot.forEach(doc => {
                const data = doc.data();
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = data.name || doc.id; // 顯示名稱，如果沒有則顯示 ID
                kmlLayerSelect.appendChild(option);

                // 如果是管理員，也添加到刪除下拉選單
                if (window.currentUserRole === 'owner' || window.currentUserRole === 'member') {
                    const dashboardOption = document.createElement('option');
                    dashboardOption.value = doc.id;
                    dashboardOption.textContent = data.name || doc.id;
                    kmlLayerSelectDashboard.appendChild(dashboardOption);
                }
            });
            console.log("已載入所有可用的 KML 圖層列表。");

        } catch (error) {
            console.error("載入可用 KML 圖層時出錯:", error);
            showMessageBox('錯誤', `載入 KML 圖層列表失敗: ${error.message}`);
        }
    }

    // 事件監聽器：選擇 KML 圖層
    document.getElementById('kmlLayerSelect').addEventListener('change', (e) => {
        const selectedKmlId = e.target.value;
        if (selectedKmlId) {
            // 調用 map-logic.js 中的函數來載入 KML 圖層
            // 我們現在期望這個函數從 Firestore 加載數據並渲染 GeoJSON
            window.loadKmlLayerFromFirestore(selectedKmlId);
        } else {
            // 清除地圖上的所有 KML 圖層和導航按鈕
            clearAllKmlLayers();
        }
    });


    // --- KML 上傳和刪除功能 ---
    hiddenKmlFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            selectedKmlFileNameDashboard.textContent = file.name;
            uploadKmlSubmitBtnDashboard.disabled = false;
        } else {
            selectedKmlFileNameDashboard.textContent = '未選擇檔案';
            uploadKmlSubmitBtnDashboard.disabled = true;
        }
    });

    uploadKmlSubmitBtnDashboard.addEventListener('click', async () => {
        if (window.currentUserRole !== 'owner' && window.currentUserRole !== 'member') {
            showMessageBox('權限不足', '只有管理員和成員才能上傳 KML 圖層。');
            return;
        }

        const file = hiddenKmlFileInput.files[0];
        if (!file) {
            showMessageBox('錯誤', '請選擇一個 KML 檔案。');
            return;
        }

        if (file.type !== 'text/xml' && !file.name.endsWith('.kml')) {
            showMessageBox('錯誤', '請選擇有效的 KML 檔案 (.kml 或 XML 格式)。');
            return;
        }

        showMessageBox('上傳中', '正在處理 KML 檔案，請稍候...');

        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const kmlText = e.target.result;
                const parser = new DOMParser();
                const kmlDom = parser.parseFromString(kmlText, 'text/xml');

                // 使用 togeojson 轉換為 GeoJSON
                const geojsonData = togeojson.kml(kmlDom);

                if (!geojsonData || !geojsonData.features || geojsonData.features.length === 0) {
                    showMessageBox('上傳失敗', 'KML 檔案中沒有有效地圖元素 (點、線、多邊形)。');
                    return;
                }

                const kmlId = file.name.split('.')[0] + '-' + Date.now(); // 使用檔名和時間戳作為 ID

                // 儲存 KML 元數據 (名稱)
                await getKmlLayerRef(kmlId).set({
                    name: file.name,
                    uploadedBy: auth.currentUser.uid,
                    uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                // 將 GeoJSON features 分批儲存到子集合
                const batch = db.batch();
                const featuresCollectionRef = getKmlFeaturesCollectionRef(kmlId);
                geojsonData.features.forEach(feature => {
                    // 檢查 GeoJSON feature 是否符合 Firestore 儲存的限制
                    // 例如，如果 GeoJSON 數據過於複雜，可能需要簡化或分割
                    // 這裡只是簡單地將每個 feature 作為一個文檔儲存
                    batch.set(featuresCollectionRef.doc(), feature); // Firestore 會自動生成文檔 ID
                });
                await batch.commit();

                showMessageBox('成功', `KML 圖層 "${file.name}" 已成功上傳。`);
                hiddenKmlFileInput.value = ''; // 清空檔案輸入框
                selectedKmlFileNameDashboard.textContent = '未選擇檔案';
                uploadKmlSubmitBtnDashboard.disabled = true;
                loadAvailableKmlLayers(); // 重新載入列表
            };
            reader.readAsText(file);

        } catch (error) {
            console.error("上傳 KML 時出錯:", error);
            showMessageBox('錯誤', `上傳 KML 圖層失敗: ${error.message}`);
        }
    });

    deleteSelectedKmlBtn.addEventListener('click', async () => {
        if (window.currentUserRole !== 'owner' && window.currentUserRole !== 'member') {
            showMessageBox('權限不足', '只有管理員和成員才能刪除 KML 圖層。');
            return;
        }

        const kmlIdToDelete = kmlLayerSelectDashboard.value;
        if (!kmlIdToDelete) {
            showMessageBox('錯誤', '請選擇一個要刪除的 KML 圖層。');
            return;
        }

        showConfirmationBox('確認刪除', `您確定要刪除圖層 "${kmlLayerSelectDashboard.options[kmlLayerSelectDashboard.selectedIndex].text}" 嗎？此操作不可撤銷。`, async (confirmed) => {
            if (confirmed) {
                showMessageBox('刪除中', '正在刪除 KML 圖層，請稍候...');
                try {
                    // 刪除子集合中的所有 features (需要分批刪除，或使用雲函數)
                    // 這裡是一個簡化的範例，實際生產環境可能需要更複雜的批量刪除邏輯
                    const featuresSnapshot = await getKmlFeaturesCollectionRef(kmlIdToDelete).get();
                    const deleteBatch = db.batch();
                    featuresSnapshot.forEach(doc => {
                        deleteBatch.delete(doc.ref);
                    });
                    await deleteBatch.commit();

                    // 刪除 KML 元數據文檔
                    await getKmlLayerRef(kmlIdToDelete).delete();

                    showMessageBox('成功', `KML 圖層 "${kmlLayerSelectDashboard.options[kmlLayerSelectDashboard.selectedIndex].text}" 已成功刪除。`);
                    loadAvailableKmlLayers(); // 重新載入列表
                    clearAllKmlLayers(); // 清除地圖上的 KML 圖層
                } catch (error) {
                    console.error("刪除 KML 時出錯:", error);
                    showMessageBox('錯誤', `刪除 KML 圖層失敗: ${error.message}`);
                }
            }
        });
    });


    // --- 登入/登出事件監聽器 ---
    googleSignInBtn.addEventListener('click', async () => {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            await auth.signInWithPopup(provider);
            showMessageBox('登入成功', '您已成功登入！');
        } catch (error) {
            console.error("Google 登入失敗:", error);
            showMessageBox('登入失敗', `Google 登入失敗: ${error.message}`);
        }
    });

    logoutBtn.addEventListener('click', async () => {
        try {
            await auth.signOut();
            showMessageBox('登出成功', '您已登出。');
            clearAllKmlLayers(); // 登出時清除所有 KML 圖層
        } catch (error) {
            console.error("登出失敗:", error);
            showMessageBox('登出失敗', `登出失敗: ${error.message}`);
        }
    });


    // --- 註冊碼管理 (Owner Only) ---
    generateRegistrationCodeBtn.addEventListener('click', async () => {
        if (window.currentUserRole !== 'owner') {
            showMessageBox('權限不足', '只有管理員才能生成註冊碼。');
            return;
        }

        try {
            const code = Math.random().toString(36).substring(2, 10).toUpperCase(); // 簡單的隨機碼
            const expirySeconds = 60; // 註冊碼有效時間，例如 60 秒

            // 儲存一次性註冊碼到 Firestore
            await getRegistrationCodeDocRef(code).set({
                code: code,
                used: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                expiresAt: firebase.firestore.Timestamp.fromMillis(Date.now() + expirySeconds * 1000)
            });

            registrationCodeDisplay.textContent = code;
            let countdownSeconds = expirySeconds; // 將倒計時秒數獨立出來
            registrationCodeCountdown.textContent = ` (剩餘 ${countdownSeconds} 秒)`;
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

            showMessageBox('成功', `一次性註冊碼已生成並複製到剪貼簿，設定為 ${expirySeconds} 秒後過期！`);
        } catch (error) {
            console.error("生成註冊碼時出錯:", error);
            showMessageBox('錯誤', `生成註冊碼失敗: ${error.message}`);
        }
    });

    // 事件監聽器：重新整理用戶列表 (Owner Only)
    refreshUsersBtn.addEventListener('click', () => {
        if (window.currentUserRole === 'owner') {
            refreshUserList();
        } else {
            showMessageBox('權限不足', '只有管理員才能重新整理用戶列表。');
        }
    });

    async function refreshUserList() {
        if (window.currentUserRole !== 'owner') {
            console.warn("只有管理員才能查看用戶列表。");
            return;
        }

        userList.innerHTML = '<p>載入用戶中...</p>'; // 清空並顯示載入狀態
        try {
            const usersRef = db.collection('artifacts').doc(appId).collection('users');
            const snapshot = await usersRef.get();

            if (snapshot.empty) {
                userList.innerHTML = '<p>沒有註冊用戶。</p>';
                return;
            }

            userList.innerHTML = ''; // 清空載入狀態

            snapshot.forEach(doc => {
                const userData = doc.data();
                const userId = doc.id;
                const userCard = document.createElement('div');
                userCard.className = 'user-card';
                userCard.dataset.userId = userId;

                // 避免顯示匿名的 email，改用暱稱和 UID 縮寫
                const displayEmail = userData.nickname || userData.email || `匿名用戶 ${userId.substring(0, 8)}`;
                const displayRole = userData.role || 'guest'; // 確保有預設角色

                userCard.innerHTML = `
                    <div class="user-card-row-1">
                        <span class="user-email">${displayEmail}</span>
                        <span class="user-nickname">${userData.nickname || '未設定暱稱'}</span>
                    </div>
                    <div class="user-card-row-2">
                        <span class="user-role-display">角色: ${displayRole}</span>
                        <div class="user-role-controls">
                            <select class="user-role-select">
                                <option value="guest" ${displayRole === 'guest' ? 'selected' : ''}>訪客</option>
                                <option value="member" ${displayRole === 'member' ? 'selected' : ''}>成員</option>
                                <option value="owner" ${displayRole === 'owner' ? 'selected' : ''}>管理員</option>
                            </select>
                            <button class="change-role-btn">變更角色</button>
                        </div>
                        <div class="user-actions">
                            <button class="delete-user-btn">刪除</button>
                        </div>
                    </div>
                `;
                userList.appendChild(userCard);
            });

            // 為每個用戶卡片添加事件監聽器
            userList.querySelectorAll('.user-card').forEach(card => {
                const userId = card.dataset.userId;
                const selectElement = card.querySelector('.user-role-select');
                const changeRoleBtn = card.querySelector('.change-role-btn');
                const deleteUserBtn = card.querySelector('.delete-user-btn');

                changeRoleBtn.addEventListener('click', async () => {
                    const newRole = selectElement.value;
                    if (newRole && userId) {
                        showConfirmationBox('確認變更', `您確定要將用戶 ${userId.substring(0, 8)} 的角色變更為 ${newRole} 嗎？`, async (confirmed) => {
                            if (confirmed) {
                                try {
                                    await getUserDocRef(userId).update({ role: newRole });
                                    showMessageBox('成功', `用戶 ${userId.substring(0, 8)} 的角色已更新為 ${newRole}。`);
                                    refreshUserList(); // 重新整理列表
                                } catch (error) {
                                    console.error("更新用戶角色失敗:", error);
                                    showMessageBox('錯誤', `更新角色失敗: ${error.message}`);
                                }
                            }
                        });
                    }
                });

                deleteUserBtn.addEventListener('click', async () => {
                    if (userId) {
                        showConfirmationBox('確認刪除', `您確定要刪除用戶 ${userId.substring(0, 8)} 嗎？此操作不可撤銷。`, async (confirmed) => {
                            if (confirmed) {
                                try {
                                    // 為了安全，實際的用戶刪除應該在後端（Cloud Functions）執行，
                                    // 因為這裡無法直接刪除 Firebase Authentication 用戶。
                                    // 這裡只刪除 Firestore 中的用戶文件。
                                    await getUserDocRef(userId).delete();
                                    showMessageBox('成功', `用戶 ${userId.substring(0, 8)} 的記錄已從資料庫中刪除。`);
                                    refreshUserList(); // 重新整理列表
                                } catch (error) {
                                    console.error("刪除用戶失敗:", error);
                                    showMessageBox('錯誤', `刪除用戶失敗: ${error.message}`);
                                }
                            }
                        });
                    }
                });
            });

        } catch (error) {
            console.error("載入用戶列表失敗:", error);
            userList.innerHTML = '<p>載入用戶列表失敗。</p>';
            showMessageBox('錯誤', `載入用戶列表失敗: ${error.message}`);
        }
    }
});
