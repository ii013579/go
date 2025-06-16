// auth-kml-management.js v4.2.33 (使用表格佈局，基於原始邏輯優化)

// 全局變數
let currentSortColumn = 'role'; // 預設按 角色 排序
let currentSortDirection = 'asc'; // 預設升序
window.currentUserRole = null; // 初始化全局變數
let currentKmlLayers = []; // 初始化 KML 圖層數據
let registrationCodeTimer = null; // 初始化註冊碼計時器

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
    const userListContent = document.getElementById('userListContent'); // 現在這是 <tbody> 元素
    const userListHeader = document.querySelector('.user-list-header'); // 現在這是 <thead> 內的 <tr> 元素

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

    // 函數：顯示自定義確認模態框 (保持不變)
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
                if (onConfirmCallback) onConfirmCallback(true);
                resolve(true);
            };

            const handleCancel = () => {
                modalOverlay.classList.remove('visible');
                confirmYesBtn.removeEventListener('click', handleConfirm);
                confirmNoBtn.removeEventListener('click', handleCancel);
                if (onConfirmCallback) onConfirmCallback(false);
                resolve(false);
            };

            confirmYesBtn.addEventListener('click', handleConfirm);
            confirmNoBtn.addEventListener('click', handleCancel);
        });
    };

    // Firebase 認證狀態監聽 (保持原有邏輯)
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            loggedInDashboard.style.display = 'block';
            loginForm.style.display = 'none';
            userEmailDisplay.textContent = user.email;
            loginMessage.textContent = '';

            const userDocRef = db.collection('users').doc(user.uid);
            const userDoc = await userDocRef.get();

            if (userDoc.exists) {
                window.currentUserRole = userDoc.data().role || 'unverified';
            } else {
                window.currentUserRole = 'unverified';
                await userDocRef.set({ email: user.email, role: 'unverified', name: user.displayName || user.email.split('@')[0] }, { merge: true });
            }

            // 根據角色顯示或隱藏管理功能區塊
            const isAdminOrOwner = ['admin', 'owner'].includes(window.currentUserRole);
            const isOwner = window.currentUserRole === 'owner';

            uploadKmlSectionDashboard.style.display = isAdminOrOwner ? 'block' : 'none';
            deleteKmlSectionDashboard.style.display = isAdminOrOwner ? 'block' : 'none';
            registrationSettingsSection.style.display = isOwner ? 'block' : 'none';
            userManagementSection.style.display = isOwner ? 'block' : 'none'; // 讓使用者管理區塊只對 Owner 可見

            // 如果是 Owner，則載入使用者列表
            if (isOwner) {
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

    // Google 登入 (保持不變)
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

    // 登出 (保持不變)
    logoutBtn.addEventListener('click', async () => {
        try {
            await auth.signOut();
            showMessage('成功', '您已登出！');
        } catch (error) {
            console.error("登出失敗:", error);
            showMessage('錯誤', `登出失敗: ${error.message}`);
        }
    });

    // 檔案上傳相關邏輯 (保持不變)
    uploadKmlSubmitBtnDashboard.addEventListener('click', () => {
        hiddenKmlFileInput.click();
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

    // 重新整理 KML 圖層選單 (保持不變)
    async function refreshKmlLayerSelect() {
        kmlLayerSelectDashboard.innerHTML = '<option value="">-- 選擇要刪除的圖層 --</option>';
        try {
            const snapshot = await db.collection('kmlLayers').get();
            currentKmlLayers = [];

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

    // 刪除 KML 圖層 (保持不變)
    deleteSelectedKmlBtn.addEventListener('click', async () => {
        const selectedLayerName = kmlLayerSelectDashboard.value;
        if (!selectedLayerName) {
            showMessage('警告', '請選擇一個要刪除的 KML 圖層。');
            return;
        }

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
            const storageRef = storage.ref(`kml/${selectedLayerName}.kml`);
            await storageRef.delete();

            await db.collection('kmlLayers').doc(selectedLayerName).delete();

            showMessage('成功', `KML 圖層 "${selectedLayerName}" 已成功刪除！`);
            refreshKmlLayerSelect();
            if (typeof removeKmlLayerFromMap === 'function') {
                removeKmlLayerFromMap(selectedLayerName);
            }
        } catch (error) {
            console.error("刪除 KML 圖層失敗:", error);
            showMessage('錯誤', `刪除 KML 圖層失敗: ${error.message}`);
        }
    });

    // 註冊碼生成 (保持不變)
    generateRegistrationCodeBtn.addEventListener('click', async () => {
        if (window.currentUserRole !== 'owner') {
            showMessage('權限不足', '只有擁有者才能生成註冊碼。');
            return;
        }

        try {
            const codesRef = db.collection('registrationCodes');
            const newCodeDocRef = codesRef.doc();
            const code = newCodeDocRef.id;

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
    refreshUsersBtn.addEventListener('click', () => {
        if (userManagementSection.style.display === 'block' && window.currentUserRole === 'owner') {
            refreshUserList();
        } else if (window.currentUserRole !== 'owner') {
            showMessage('權限不足', '只有擁有者才能查看和管理使用者列表。');
        }
    });

    // 使用者列表標頭的點擊事件監聽 (現在監聽 <th>)
    if (userListHeader) {
        userListHeader.addEventListener('click', (event) => {
            const target = event.target.closest('.header-item'); // 確保點擊的是 <th> 元素
            if (target) {
                let column;
                if (target.classList.contains('user-email-header')) {
                    column = 'email';
                } else if (target.classList.contains('user-nickname-header')) {
                    column = 'nickname';
                } else if (target.classList.contains('user-role-header')) {
                    column = 'role';
                } else {
                    return;
                }

                if (currentSortColumn === column) {
                    currentSortDirection = (currentSortDirection === 'asc') ? 'desc' : 'asc';
                } else {
                    currentSortColumn = column;
                    currentSortDirection = 'asc';
                }

                userListHeader.querySelectorAll('.header-item').forEach(item => {
                    item.classList.remove('sort-asc', 'sort-desc');
                });
                target.classList.add(`sort-${currentSortDirection}`);

                refreshUserList();
            }
        });
    }

    // 初始載入時設定表頭的排序箭頭顯示
    if (userListHeader) {
        const initialSortHeader = userListHeader.querySelector(`.header-item.user-${currentSortColumn}-header`);
        if (initialSortHeader) {
            initialSortHeader.classList.add(`sort-${currentSortDirection}`);
        }
    }

}); // DOMContentLoaded end

// 顯示使用者管理列表 (現在生成 <tr> 元素)
async function refreshUserList() {
    const userListContent = document.getElementById('userListContent'); // 現在這是 <tbody> 元素
    if (!userListContent) {
        console.error("錯誤: 找不到 #userListContent 元素 (tbody)。");
        return;
    }

    userListContent.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">載入使用者中...</td></tr>'; // 表格載入訊息

    try {
        const usersRef = db.collection('users');
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
                    role: userData.role || 'unverified',
                    nickname: userData.name || '未設定'
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
                const roleOrder = {
                    'unverified': 0,
                    'user': 1,
                    'editor': 2,
                    'admin': 3,
                    'owner': 4
                };
                valA = roleOrder[a.role] !== undefined ? roleOrder[a.role] : -1;
                valB = roleOrder[b.role] !== undefined ? roleOrder[b.role] : -1;
            } else {
                return 0;
            }

            if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        userListContent.innerHTML = ''; // 清空現有列表

        if (users.length === 0) {
            userListContent.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">目前沒有其他使用者。</td></tr>'; // 沒有用戶訊息
            return;
        }

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

        users.forEach(user => {
            const userRow = document.createElement('tr'); // 創建 <tr> 元素
            userRow.classList.add('user-row'); // 添加 class 以便 CSS 樣式化
            userRow.dataset.uid = user.uid;

            // 角色下拉選單選項
            const roleOptions = `
                <option value="unverified" ${user.role === 'unverified' ? 'selected' : ''}>${getRoleDisplayName('unverified')}</option>
                <option value="user" ${user.role === 'user' ? 'selected' : ''}>${getRoleDisplayName('user')}</option>
                <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>${getRoleDisplayName('editor')}</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>${getRoleDisplayName('admin')}</option>
                <option value="owner" ${user.role === 'owner' ? 'selected' : ''} ${window.currentUserRole !== 'owner' ? 'disabled' : ''}>${getRoleDisplayName('owner')}</option>
            `;

            userRow.innerHTML = `
                <td class="user-email">${user.email}</td>
                <td class="user-nickname">${user.nickname}</td>
                <td class="user-role">
                    <div class="user-role-controls">
                        <select class="user-role-select" data-uid="${user.uid}" data-original-value="${user.role}" ${window.currentUserRole !== 'owner' && user.role === 'owner' ? 'disabled' : ''}>
                            ${roleOptions}
                        </select>
                    </div>
                </td>
                <td class="user-actions">
                    <button class="change-role-btn action-buttons" data-uid="${user.uid}" disabled ${window.currentUserRole !== 'owner' && user.role === 'owner' ? 'disabled' : ''}>變更</button>
                    <button class="delete-user-btn action-buttons delete-btn" data-uid="${user.uid}" ${user.role === 'owner' ? 'disabled' : ''}>刪除</button>
                </td>
            `;
            userListContent.appendChild(userRow);
        });

        attachUserActionListeners(); // 重新綁定事件監聽器

    } catch (error) {
        console.error("獲取使用者列表時出錯:", error);
        userListContent.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 20px; color: red;">載入使用者列表失敗: ${error.message}</td></tr>`;
    }
}

// 綁定使用者操作的事件監聽器 (保持不變，因為選擇器仍然適用)
function attachUserActionListeners() {
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

    document.querySelectorAll('.user-role-select').forEach(select => {
        select.dataset.originalValue = select.value;
        const userRow = select.closest('.user-row');
        const changeButton = userRow ? userRow.querySelector('.change-role-btn') : null;

        if (!changeButton) return;

        select.addEventListener('change', (event) => {
            const newValue = event.target.value;
            if (window.currentUserRole === 'owner') {
                changeButton.disabled = (newValue === select.dataset.originalValue);
            } else {
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

            if (window.currentUserRole !== 'owner' && (newRole === 'owner' || selectElement.dataset.originalValue === 'owner')) {
                showMessage('權限不足', '您沒有權限執行此角色變更操作。');
                selectElement.value = selectElement.dataset.originalValue;
                button.disabled = true;
                return;
            }

            const userRef = db.collection('users').doc(uid);
            const userDoc = await userRef.get();
            const currentUserData = userDoc.data();
            const currentRole = currentUserData.role;

            if (newRole === currentRole) {
                showMessage('提示', '新角色與當前角色相同，無需變更。');
                selectElement.value = selectElement.dataset.originalValue;
                button.disabled = true;
                return;
            }

            const confirmUpdate = await showConfirmationModal(`確認變更使用者角色？`, `您確定要將 ${currentUserData.email} 的角色從 ${getRoleDisplayName(currentRole)} 變更為 ${getRoleDisplayName(newRole)} 嗎？`, async (confirmed) => {
                if (confirmed) {
                    try {
                        await userRef.update({ role: newRole });
                        showMessage('成功', `使用者 ${currentUserData.email} 的角色已變更為 ${getRoleDisplayName(newRole)}。`);
                        refreshUserList();
                    } catch (error) {
                        console.error("變更使用者角色時出錯:", error);
                        showMessage('錯誤', `變更使用者角色失敗: ${error.message}`);
                    }
                } else {
                    selectElement.value = selectElement.dataset.originalValue;
                    button.disabled = true;
                }
            });
        };
    });

    document.querySelectorAll('.delete-user-btn').forEach(button => {
        button.onclick = async (event) => {
            const uid = event.target.dataset.uid;
            const userRef = db.collection('users').doc(uid);
            const userDoc = await userRef.get();
            const userData = userDoc.data();
            const userEmail = userData.email || uid;

            if (userData.role === 'owner') {
                showMessage('權限不足', '無法刪除 Owner 角色。');
                return;
            }
            if (uid === auth.currentUser.uid) {
                showMessage('提示', '無法刪除您自己的帳號。');
                return;
            }

            showConfirmationModal(`確認刪除使用者？`, `您確定要刪除使用者 ${userEmail} 嗎？此操作不可逆！`, async (confirm) => {
                if (confirm) {
                    try {
                        await userRef.delete();
                        showMessage('成功', `使用者 ${userEmail} 已從列表中刪除。`);
                        refreshUserList();
                    } catch (error) {
                        console.error("刪除使用者時出錯:", error);
                        showMessage('錯誤', `刪除使用者失敗: ${error.message}`);
                    }
                }
            });
        };
    });
}