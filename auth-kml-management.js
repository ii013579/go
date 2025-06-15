// auth-kml-management.js v4.2.31

// 新增排序相關的全局變數
let currentSortColumn = 'role'; // 預設按 角色 排序
let currentSortDirection = 'asc'; // 預設升序

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
    const hiddenKmlFileInput = document.getElementById('hiddenKmlFileInput');
    const deleteKmlSectionDashboard = document.getElementById('deleteKmlSectionDashboard');
    const kmlLayerSelectDashboard = document.getElementById('kmlLayerSelectDashboard');
    const deleteSelectedKmlBtn = document.getElementById('deleteSelectedKmlBtn');

    const registrationSettingsSection = document.getElementById('registrationSettingsSection');
    const generateRegistrationCodeBtn = document.getElementById('generateRegistrationCodeBtn');
    const registrationCodeDisplay = document.getElementById('registrationCodeDisplay');
    const registrationCodeCountdown = document.getElementById('registrationCodeCountdown');
    const registrationExpiryDisplay = document.getElementById('registrationExpiryDisplay');

    // 新增使用者管理相關元素
    const userManagementSection = document.getElementById('userManagementSection');
    const refreshUsersBtn = document.getElementById('refreshUsersBtn');
    const userListContent = document.getElementById('userListContent'); // 新增：獲取新的內容容器
    const userListHeader = document.querySelector('.user-list-header'); // 新增：獲取表頭

    // 全局變數
    window.currentUserRole = null;
    let currentKmlLayers = [];
    let registrationCodeTimer = null;

    // 輔助函數：將角色英文轉換為中文
    const getRoleDisplayName = (role) => {
        switch (role) {
            case 'unverified': return '未審核';
            case 'user': return '一般用戶';
            case 'editor': return '編輯者';
            case 'admin': return '管理員';
            case 'owner': return '擁有者';
            default: return role;
        }
    };

    // 輔助函數：定義角色排序 (用於排序邏輯，而不是顯示名稱)
    const roleOrder = {
        'unverified': 0,
        'user': 1,
        'editor': 2,
        'admin': 3,
        'owner': 4
    };

    // 函數：顯示自定義確認模態框
    window.showConfirmationModal = (title, message, onConfirmCallback) => {
        const modalOverlay = document.getElementById('confirmationModalOverlay');
        const modalTitle = document.getElementById('confirmationModalTitle');
        const modalMessage = document.getElementById('confirmationModalMessage');
        const confirmYesBtn = document.getElementById('confirmYesBtn');
        const confirmNoBtn = document.getElementById('confirmNoBtn');

        modalTitle.textContent = title;
        modalMessage.textContent = message;
        modalOverlay.classList.add('visible');

        return new Promise(resolve => {
            const handleConfirm = () => {
                modalOverlay.classList.remove('visible');
                confirmYesBtn.removeEventListener('click', handleConfirm);
                confirmNoBtn.removeEventListener('click', handleCancel);
                if (onConfirmCallback) onConfirmCallback(true); // 如果提供了回調，則執行
                resolve(true);
            };

            const handleCancel = () => {
                modalOverlay.classList.remove('visible');
                confirmYesBtn.removeEventListener('click', handleConfirm);
                confirmNoBtn.removeEventListener('click', handleCancel);
                if (onConfirmCallback) onConfirmCallback(false); // 如果提供了回調，則執行
                resolve(false);
            };

            confirmYesBtn.addEventListener('click', handleConfirm);
            confirmNoBtn.addEventListener('click', handleCancel);
        });
    };


    // Firebase 認證狀態監聽
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            loggedInDashboard.style.display = 'block';
            loginForm.style.display = 'none';
            userEmailDisplay.textContent = user.email;
            loginMessage.textContent = '';

            const userDocRef = db.collection('users').doc(user.uid);
            const userDoc = await userDocRef.get();

            if (userDoc.exists) {
                window.currentUserRole = userDoc.data().role || 'unapproved';
            } else {
                // 新註冊用戶或首次登入
                window.currentUserRole = 'unapproved';
                await userDocRef.set({ email: user.email, role: 'unapproved', name: user.displayName || user.email.split('@')[0] }, { merge: true });
            }

            // 根據角色顯示或隱藏管理功能
            const isAdminOrOwner = ['admin', 'owner'].includes(window.currentUserRole);
            const isOwner = window.currentUserRole === 'owner';

            uploadKmlSectionDashboard.style.display = isAdminOrOwner ? 'block' : 'none';
            deleteKmlSectionDashboard.style.display = isAdminOrOwner ? 'block' : 'none';
            registrationSettingsSection.style.display = isOwner ? 'block' : 'none';
            userManagementSection.style.display = isOwner ? 'block' : 'none'; // 讓使用者管理區塊只對 Owner 可見

            // 如果是 Owner 且 userManagementSection 預設為顯示，則載入使用者列表
            if (isOwner && userManagementSection.style.display === 'block') {
                refreshUserList();
            }

            refreshKmlLayerSelect(); // 更新KML圖層列表
        } else {
            loggedInDashboard.style.display = 'none';
            loginForm.style.display = 'block';
            userEmailDisplay.textContent = '';
            loginMessage.textContent = '請登入以使用地圖管理功能。';
            window.currentUserRole = null;
            uploadKmlSectionDashboard.style.display = 'none';
            deleteKmlSectionDashboard.style.display = 'none';
            registrationSettingsSection.style.display = 'none';
            userManagementSection.style.display = 'none'; // 登出後隱藏使用者管理區塊
        }
    });

    // Google 登入
    googleSignInBtn.addEventListener('click', async () => {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            await auth.signInWithPopup(provider);
            showMessage('成功', '登入成功！');
        } catch (error) {
            console.error("Google 登入失敗:", error);
            showMessage('錯誤', `登入失敗: ${error.message}`);
        }
    });

    // 登出
    logoutBtn.addEventListener('click', async () => {
        try {
            await auth.signOut();
            showMessage('成功', '您已登出！');
        } catch (error) {
            console.error("登出失敗:", error);
            showMessage('錯誤', `登出失敗: ${error.message}`);
        }
    });

    // 檔案上傳相關邏輯
    uploadKmlSubmitBtnDashboard.addEventListener('click', () => {
        hiddenKmlFileInput.click(); // 觸發隱藏的檔案輸入框
    });

    hiddenKmlFileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) {
            selectedKmlFileNameDashboard.textContent = '未選擇檔案';
            return;
        }

        selectedKmlFileNameDashboard.textContent = file.name;

        if (file.type !== 'application/vnd.google-earth.kml+xml' && file.type !== 'application/xml' && !file.name.toLowerCase().endsWith('.kml')) {
            showMessage('錯誤', '請選擇有效的 KML 檔案 (.kml)。');
            selectedKmlFileNameDashboard.textContent = '未選擇檔案';
            return;
        }

        // 檢查權限
        if (!['admin', 'owner'].includes(window.currentUserRole)) {
            showMessage('權限不足', '只有管理員或擁有者才能上傳 KML 檔案。');
            selectedKmlFileNameDashboard.textContent = '未選擇檔案';
            return;
        }

        try {
            const storageRef = storage.ref(`kml/${file.name}`);
            const uploadTask = storageRef.put(file);

            showMessage('上傳中', 'KML 檔案上傳中，請稍候...');

            uploadTask.on('state_changed',
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    showMessage('上傳中', `上傳進度: ${progress.toFixed(2)}%`);
                },
                (error) => {
                    console.error("上傳失敗:", error);
                    showMessage('錯誤', `KML 檔案上傳失敗: ${error.message}`);
                },
                async () => {
                    const downloadURL = await storageRef.getDownloadURL();
                    await db.collection('kmlLayers').doc(file.name.replace(/\.kml$/, '')).set({
                        name: file.name.replace(/\.kml$/, ''),
                        url: downloadURL,
                        uploadedBy: auth.currentUser.email,
                        uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    showMessage('成功', `KML 檔案 "${file.name}" 上傳成功並已註冊！`);
                    refreshKmlLayerSelect();
                }
            );
        } catch (error) {
            console.error("處理KML上傳時出錯:", error);
            showMessage('錯誤', `處理KML上傳失敗: ${error.message}`);
        }
    });

    // 重新整理 KML 圖層選單
    async function refreshKmlLayerSelect() {
        kmlLayerSelectDashboard.innerHTML = '<option value="">-- 選擇要刪除的圖層 --</option>';
        try {
            const snapshot = await db.collection('kmlLayers').get();
            currentKmlLayers = []; // 清空現有 KML 圖層數據

            if (snapshot.empty) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = '目前沒有任何 KML 圖層';
                option.disabled = true;
                kmlLayerSelectDashboard.appendChild(option);
                deleteSelectedKmlBtn.disabled = true;
                return;
            }

            snapshot.forEach(doc => {
                const layer = doc.data();
                currentKmlLayers.push(layer);
                const option = document.createElement('option');
                option.value = layer.name;
                option.textContent = layer.name;
                kmlLayerSelectDashboard.appendChild(option);
            });
            deleteSelectedKmlBtn.disabled = false;
        } catch (error) {
            console.error("載入 KML 圖層失敗:", error);
            showMessage('錯誤', `載入 KML 圖層失敗: ${error.message}`);
            deleteSelectedKmlBtn.disabled = true;
        }
    }

    // 刪除 KML 圖層
    deleteSelectedKmlBtn.addEventListener('click', async () => {
        const selectedLayerName = kmlLayerSelectDashboard.value;
        if (!selectedLayerName) {
            showMessage('警告', '請選擇一個要刪除的 KML 圖層。');
            return;
        }

        // 檢查權限
        if (!['admin', 'owner'].includes(window.currentUserRole)) {
            showMessage('權限不足', '只有管理員或擁有者才能刪除 KML 檔案。');
            return;
        }

        const confirmDelete = await showConfirmationModal(
            '確認刪除 KML 圖層',
            `您確定要刪除 KML 圖層 "${selectedLayerName}" 嗎？此操作不可逆！`
        );

        if (!confirmDelete) {
            return;
        }

        try {
            // 從 Storage 刪除檔案
            const storageRef = storage.ref(`kml/${selectedLayerName}.kml`);
            await storageRef.delete();

            // 從 Firestore 刪除記錄
            await db.collection('kmlLayers').doc(selectedLayerName).delete();

            showMessage('成功', `KML 圖層 "${selectedLayerName}" 已成功刪除！`);
            refreshKmlLayerSelect(); // 重新整理 KML 圖層選單
            removeKmlLayerFromMap(selectedLayerName); // 從地圖上移除
        } catch (error) {
            console.error("刪除 KML 圖層失敗:", error);
            showMessage('錯誤', `刪除 KML 圖層失敗: ${error.message}`);
        }
    });

    // 註冊碼生成
    generateRegistrationCodeBtn.addEventListener('click', async () => {
        if (window.currentUserRole !== 'owner') {
            showMessage('權限不足', '只有擁有者才能生成註冊碼。');
            return;
        }

        try {
            const codesRef = db.collection('registrationCodes');
            const newCodeDocRef = codesRef.doc(); // 自動生成ID
            const code = newCodeDocRef.id; // 將文檔ID作為註冊碼

            const expiryTime = firebase.firestore.Timestamp.now().toMillis() + (30 * 1000); // 30秒後過期
            await newCodeDocRef.set({
                code: code,
                expiresAt: expiryTime,
                generatedBy: auth.currentUser.email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                isUsed: false
            });

            if (registrationCodeTimer) {
                clearInterval(registrationCodeTimer);
            }

            let countdownSeconds = 30;
            registrationCodeDisplay.textContent = `註冊碼: ${code}`;
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

            showMessage('成功', `一次性註冊碼已生成並複製到剪貼簿，設定為 ${countdownSeconds} 秒後過期！`);
        } catch (error) {
            console.error("生成註冊碼時出錯:", error);
            showMessage('錯誤', `生成註冊碼失敗: ${error.message}`);
        }
    });

    // 事件監聽器：重新整理使用者列表 (Owner Only)
    // 調整 refreshUsersBtn 的事件監聽器，使其在點擊時也觸發 refreshUserList
    // ui-interactions.js 已經處理了這個按鈕的顯示/隱藏切換
    // 這裡我們讓它專注於重新整理，這樣當介面顯示時，可以手動點擊它來更新數據
    refreshUsersBtn.addEventListener('click', () => {
        // 只有當區塊顯示時才刷新
        if (userManagementSection.style.display === 'block') {
            if (window.currentUserRole === 'owner') {
                refreshUserList();
            } else {
                showMessage('權限不足', '只有管理員才能查看和管理使用者列表。');
            }
        }
    });

    // 新增：使用者列表標頭的點擊事件監聽
    if (userListHeader) {
        userListHeader.addEventListener('click', (event) => {
            const target = event.target;
            if (target.classList.contains('header-item')) {
                let column;
                // 根據點擊的 header-item 類別判斷排序欄位
                if (target.classList.contains('user-email-header')) {
                    column = 'email';
                } else if (target.classList.contains('user-nickname-header')) {
                    column = 'nickname';
                } else if (target.classList.contains('user-role-header')) {
                    column = 'role';
                } else {
                    return; // 如果點擊的不是這些標頭，則不做排序
                }

                // 切換排序方向
                if (currentSortColumn === column) {
                    currentSortDirection = (currentSortDirection === 'asc') ? 'desc' : 'asc';
                } else {
                    currentSortColumn = column;
                    currentSortDirection = 'asc'; // 新的排序欄位預設升序
                }

                // 更新標頭的排序箭頭樣式
                userListHeader.querySelectorAll('.header-item').forEach(item => {
                    item.classList.remove('sort-asc', 'sort-desc');
                });
                target.classList.add(`sort-${currentSortDirection}`);

                refreshUserList(); // 重新整理並排序使用者列表
            }
        });
    }

    // 初始載入使用者列表 (當使用者管理介面預設開啟時，且是 Owner)
    // 這會在 onAuthStateChanged 之後觸發，確保權限正確判斷
    // if (userManagementSection.style.display === 'block' && window.currentUserRole === 'owner') {
    //     refreshUserList();
    // }

    // 新增：初始化標頭排序箭頭顯示 (當頁面載入時)
    if (userListHeader) { // 確保 userListHeader 存在
        const initialSortHeader = userListHeader.querySelector(`.header-item.user-${currentSortColumn}-header`);
        if (initialSortHeader) {
            initialSortHeader.classList.add(`sort-${currentSortDirection}`);
        }
    }

}); // DOMContentLoaded end

// 將 refreshUserList 函數修改為以下內容
async function refreshUserList() {
    const userListContent = document.getElementById('userListContent'); // 獲取新的內容容器
    if (!userListContent) {
        console.error("錯誤: 找不到 #userListContent 元素。");
        return;
    }

    userListContent.innerHTML = '載入使用者中...';

    try {
        const usersRef = db.collection('users'); // 假設使用者數據在根級 'users' 集合
        const querySnapshot = await usersRef.get();
        let users = [];

        querySnapshot.forEach(doc => {
            const userData = doc.data();
            const uid = doc.id;
            // 不顯示當前登入用戶，也不顯示沒有 email 的用戶
            if (uid !== auth.currentUser.uid && userData.email) {
                users.push({
                    uid: doc.id,
                    email: userData.email,
                    role: userData.role || 'unverified', // 預設角色為 'unverified'
                    nickname: userData.name || '未設定' // 預設暱稱
                });
            }
        });

        // 排序使用者列表
        users.sort((a, b) => {
            let valA, valB;

            if (currentSortColumn === 'email') {
                valA = a.email.toLowerCase();
                valB = b.email.toLowerCase();
            } else if (currentSortColumn === 'nickname') {
                valA = a.nickname.toLowerCase();
                valB = b.nickname.toLowerCase();
            } else if (currentSortColumn === 'role') {
                // 自定義角色排序：未審核 < 一般用戶 < 編輯者 < 管理員 < 擁有者
                const roleOrder = {
                    'unverified': 0,
                    'user': 1,
                    'editor': 2,
                    'admin': 3,
                    'owner': 4
                };
                // 確保有預設值，如果角色不存在於 roleOrder，則給予一個較低的值
                valA = roleOrder[a.role] !== undefined ? roleOrder[a.role] : -1;
                valB = roleOrder[b.role] !== undefined ? roleOrder[b.role] : -1;
            } else {
                return 0; // 不支援的排序欄位
            }

            if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        userListContent.innerHTML = ''; // 清空現有列表

        if (users.length === 0) {
            userListContent.innerHTML = '<p style="text-align: center; padding: 20px;">目前沒有其他使用者。</p>';
            return;
        }

        users.forEach(user => {
            const userRow = document.createElement('div');
            userRow.classList.add('user-row');
            userRow.dataset.uid = user.uid; // 將 UID 儲存到 dataset

            // 角色下拉選單選項
            const roleOptions = `
                <option value="unverified" ${user.role === 'unverified' ? 'selected' : ''}>${getRoleDisplayName('unverified')}</option>
                <option value="user" ${user.role === 'user' ? 'selected' : ''}>${getRoleDisplayName('user')}</option>
                <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>${getRoleDisplayName('editor')}</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>${getRoleDisplayName('admin')}</option>
                <option value="owner" ${user.role === 'owner' ? 'selected' : ''} ${window.currentUserRole !== 'owner' ? 'disabled' : ''}>${getRoleDisplayName('owner')}</option>
            `;

            userRow.innerHTML = `
                <div class="user-email">${user.email}</div>
                <div class="user-nickname">${user.nickname}</div>
                <div class="user-role">
                    <div class="user-role-controls">
                        <select class="user-role-select" data-uid="${user.uid}" data-original-value="${user.role}" ${window.currentUserRole !== 'owner' && user.role === 'owner' ? 'disabled' : ''}>
                            ${roleOptions}
                        </select>
                    </div>
                </div>
                <div class="user-actions">
                    <button class="change-role-btn action-buttons" data-uid="${user.uid}" disabled ${window.currentUserRole !== 'owner' && user.role === 'owner' ? 'disabled' : ''}>變更</button>
                    <button class="delete-user-btn action-buttons delete-btn" data-uid="${user.uid}" ${user.role === 'owner' ? 'disabled' : ''}>刪除</button>
                </div>
            `;
            userListContent.appendChild(userRow);
        });

        // 重新綁定事件監聽器 (因為是動態生成的元素)
        attachUserActionListeners();

    } catch (error) {
        console.error("獲取使用者列表時出錯:", error);
        userListContent.innerHTML = '<p style="text-align: center; padding: 20px; color: red;">載入使用者列表失敗。</p>';
    }
}

// 確保 attachUserActionListeners 函數存在
function attachUserActionListeners() {
    // 綁定變更角色按鈕的事件
    document.querySelectorAll('.user-role-select').forEach(select => {
        select.dataset.originalValue = select.value; // 設置初始值
        // 找到對應的變更按鈕 (假設它在同一個 user-row 內的 user-actions 區塊中)
        const userRow = select.closest('.user-row');
        const changeButton = userRow ? userRow.querySelector('.change-role-btn') : null;
        const userUid = select.dataset.uid;

        if (!changeButton) return; // 如果找不到按鈕，跳過

        // 檢查權限：如果當前使用者不是 owner 且嘗試修改 owner 角色，則禁用選擇框和按鈕
        // 這個檢查在 HTML 生成時已經做了，這裡再次確保
        if (window.currentUserRole !== 'owner' && select.value === 'owner') {
            select.disabled = true;
            changeButton.disabled = true;
        }

        select.addEventListener('change', (event) => {
            const newValue = event.target.value;
            // 只有當新值與舊值不同，且有權限變更時才啟用按鈕
            // Owner 可以修改 Owner 以外的任何角色，或將任何角色變更為 Owner
            // 非 Owner 不能修改 Owner 角色，也不能將角色變更為 Owner
            if (window.currentUserRole === 'owner') {
                changeButton.disabled = (newValue === select.dataset.originalValue);
            } else {
                // 如果不是 owner，且新角色或舊角色是 owner，則禁用
                if (newValue === 'owner' || select.dataset.originalValue === 'owner') {
                    changeButton.disabled = true;
                } else {
                    changeButton.disabled = (newValue === select.dataset.originalValue);
                }
            }
        });
    });

    document.querySelectorAll('.change-role-btn').forEach(button => {
        button.onclick = async (event) => {
            const uid = event.target.dataset.uid;
            const selectElement = document.querySelector(`.user-role-select[data-uid="${uid}"]`);
            const newRole = selectElement.value;

            // 再次檢查權限：最終確認
            if (window.currentUserRole !== 'owner' && (newRole === 'owner' || selectElement.dataset.originalValue === 'owner')) {
                showMessage('權限不足', '您沒有權限執行此角色變更操作。');
                selectElement.value = selectElement.dataset.originalValue; // 恢復選中值
                button.disabled = true; // 禁用按鈕
                return;
            }

            // 獲取當前使用者的角色
            const userRef = db.collection('users').doc(uid); // 假設使用者數據在根級 'users' 集合
            const userDoc = await userRef.get();
            const currentUserData = userDoc.data();
            const currentRole = currentUserData.role;

            // 如果新角色與當前角色相同，則不執行任何操作
            if (newRole === currentRole) {
                showMessage('提示', '新角色與當前角色相同，無需變更。');
                selectElement.value = selectElement.dataset.originalValue; // 恢復選中值
                button.disabled = true; // 禁用按鈕
                return;
            }

            const confirmUpdate = await showConfirmationModal(`確認變更使用者角色？`, `您確定要將 ${currentUserData.email} 的角色從 ${getRoleDisplayName(currentRole)} 變更為 ${getRoleDisplayName(newRole)} 嗎？`, async (confirmed) => {
                if (confirmed) {
                    try {
                        await userRef.update({ role: newRole });
                        showMessage('成功', `使用者 ${currentUserData.email} 的角色已變更為 ${getRoleDisplayName(newRole)}。`);
                        refreshUserList(); // 變更後重新整理列表
                    } catch (error) {
                        console.error("變更使用者角色時出錯:", error);
                        showMessage('錯誤', `變更使用者角色失敗: ${error.message}`);
                    }
                } else {
                    selectElement.value = selectElement.dataset.originalValue; // 用戶取消，恢復選中值
                    button.disabled = true; // 禁用按鈕
                }
            });
        };
    });

    // 綁定刪除使用者按鈕的事件
    document.querySelectorAll('.delete-user-btn').forEach(button => {
        button.onclick = async (event) => {
            const uid = event.target.dataset.uid;
            // 獲取當前使用者資訊 (email, nickname) 以在確認訊息中顯示
            const userRef = db.collection('users').doc(uid); // 假設使用者數據在根級 'users' 集合
            const userDoc = await userRef.get();
            const userData = userDoc.data();
            const userEmail = userData.email || uid; // 如果沒有email，顯示uid

            // 阻止刪除 Owner
            if (userData.role === 'owner') {
                showMessage('權限不足', '無法刪除 Owner 角色。');
                return;
            }
            // 阻止刪除自己
            if (uid === auth.currentUser.uid) {
                showMessage('提示', '無法刪除您自己的帳號。');
                return;
            }

            showConfirmationModal(`確認刪除使用者？`, `您確定要刪除使用者 ${userEmail} 嗎？此操作不可逆！`, async (confirm) => {
                if (confirm) {
                    try {
                        // 這裡只從 Firestore 刪除使用者的應用程式資料
                        // Firebase Authentication 中的使用者帳號需要更高權限的後端操作
                        // 如果您也想刪除 Firebase Auth 帳號，需要設定 Firebase Functions 或其他後端服務
                        await userRef.delete();
                        showMessage('成功', `使用者 ${userEmail} 已從列表中刪除。`);
                        refreshUserList(); // 刪除後重新整理列表
                    } catch (error) {
                        console.error("刪除使用者時出錯:", error);
                        showMessage('錯誤', `刪除使用者失敗: ${error.message}`);
                    }
                }
            });
        };
    });
}