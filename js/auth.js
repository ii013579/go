// 注意：以下是 auth.js 的內容，其中假設 `auth`, `db`, `storage`, `showMessage`
// 以及 `showRegistrationCodeModal` 已經在 `firebase-init.js` 中定義並可全局訪問。
// 在實際的模組化開發中，您會使用 ES Modules (import/export) 來明確依賴關係。

document.addEventListener('DOMContentLoaded', () => {
    // 獲取所有相關的 DOM 元素
    const authSection = document.getElementById('authSection');
    const loginForm = document.getElementById('loginForm');
    const loggedInDashboard = document.getElementById('loggedInDashboard');
    const emailLoginBtn = document.getElementById('emailLoginBtn');
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    const showRegisterFormBtn = document.getElementById('showRegisterFormBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    const loginMessage = document.getElementById('loginMessage');
    const userEmailDisplay = document.getElementById('userEmailDisplay');
    const userRoleDisplay = document.getElementById('userRoleDisplay');

    const hiddenKmlFileInput = document.getElementById('hiddenKmlFileInput');
    const selectedKmlFileNameDashboard = document.getElementById('selectedKmlFileNameDashboard');
    const uploadKmlSubmitBtnDashboard = document.getElementById('uploadKmlSubmitBtnDashboard');
    const kmlLayerSelectDashboard = document.getElementById('kmlLayerSelectDashboard');
    const deleteSelectedKmlBtn = document.getElementById('deleteSelectedKmlBtn');

    const registrationSettingsSection = document.getElementById('registrationSettingsSection');
    const generateRegistrationCodeBtn = document.getElementById('generateRegistrationCodeBtn');
    const registrationCodeDisplay = document.getElementById('registrationCodeDisplay');
    const registrationExpiryDisplay = document.getElementById('registrationExpiryDisplay');
    const allowDirectRegistration = document.getElementById('allowDirectRegistration');

    const userManagementSection = document.getElementById('userManagementSection');
    const refreshUsersBtn = document.getElementById('refreshUsersBtn');
    const userListDiv = document.getElementById('userList');

    // 全局變數
    let currentUserRole = null;
    let currentKmlLayers = []; // 用於存儲 KML 圖層的 ID 和名稱

    // 輔助函數：顯示訊息
    // showMessage 函數已在 firebase-init.js 中定義為全局函數

    // 輔助函數：更新 KML 圖層選單
    const updateKmlLayerSelects = async () => {
        const kmlLayerSelect = document.getElementById('kmlLayerSelect'); // 主地圖上的選擇器
        kmlLayerSelect.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
        kmlLayerSelectDashboard.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
        deleteSelectedKmlBtn.disabled = true;

        if (!auth.currentUser) {
            console.log("未登入，無法載入 KML 圖層列表。");
            return;
        }

        try {
            const kmlRef = db.collection('kml');
            const snapshot = await kmlRef.get();
            currentKmlLayers = []; // 清空現有列表

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

                const optionDashboard = document.createElement('option');
                optionDashboard.value = kmlId;
                optionDashboard.textContent = kmlName;
                kmlLayerSelectDashboard.appendChild(optionDashboard);

                currentKmlLayers.push({ id: kmlId, name: kmlName });
            });

            if (currentKmlLayers.length > 0) {
                deleteSelectedKmlBtn.disabled = false;
            }

            // 觸發 map-app.js 中的 KML 載入函數
            if (typeof window.loadKmlLayerFromFirestore === 'function') {
                kmlLayerSelect.addEventListener('change', (event) => {
                    const kmlId = event.target.value;
                    if (kmlId) {
                        window.loadKmlLayerFromFirestore(kmlId);
                    } else {
                        window.clearAllKmlLayers(); // 如果選擇空選項則清除所有 KML
                    }
                }, { once: true }); // 只監聽一次，避免重複事件
            }

        } catch (error) {
            console.error("更新 KML 圖層列表時出錯:", error);
            showMessage('錯誤', '無法載入 KML 圖層列表。');
        }
    };


    // 輔助函數：顯示用戶管理列表
    const refreshUserList = async () => {
        userListDiv.innerHTML = '載入中...';
        try {
            const usersRef = db.collection('users');
            const snapshot = await usersRef.get();
            userListDiv.innerHTML = ''; // 清空

            if (snapshot.empty) {
                userListDiv.innerHTML = '<p>目前沒有註冊用戶。</p>';
                return;
            }

            const table = document.createElement('table');
            table.style.width = '100%';
            table.style.borderCollapse = 'collapse';
            const thead = document.createElement('thead');
            thead.innerHTML = `
                <tr>
                    <th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2;">Email</th>
                    <th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2;">角色</th>
                    <th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2;">動作</th>
                </tr>
            `;
            const tbody = document.createElement('tbody');

            snapshot.forEach(doc => {
                const user = doc.data();
                const uid = doc.id;
                if (uid === auth.currentUser.uid) return; // 不顯示自己

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: left;">${user.email || 'N/A'}</td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">
                        <select data-uid="${uid}" class="user-role-select" style="padding: 5px; border-radius: 5px;">
                            <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
                            <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Editor</option>
                            <option value="owner" ${user.role === 'owner' ? 'selected' : ''} ${currentUserRole !== 'owner' ? 'disabled' : ''}>Owner</option>
                        </select>
                    </td>
                    <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">
                        <button class="delete-user-btn action-buttons delete-btn" data-uid="${uid}" style="padding: 6px 10px; font-size: 14px;">刪除</button>
                    </td>
                `;
                tbody.appendChild(row);
            });
            table.appendChild(thead);
            table.appendChild(tbody);
            userListDiv.appendChild(table);

            // 為角色選擇器添加事件監聽器
            userListDiv.querySelectorAll('.user-role-select').forEach(select => {
                select.addEventListener('change', async (event) => {
                    const uidToUpdate = event.target.dataset.uid;
                    const newRole = event.target.value;
                    try {
                        await db.collection('users').doc(uidToUpdate).update({ role: newRole });
                        showMessage('成功', `用戶 ${uidToUpdate} 的角色已更新為 ${newRole}。`);
                    } catch (error) {
                        console.error("更新用戶角色時出錯:", error);
                        showMessage('錯誤', `更新用戶角色失敗: ${error.message}`);
                        // 失敗時將選擇器恢復為原值
                        event.target.value = event.target.options[event.target.selectedIndex].dataset.originalValue;
                    }
                });
                // 保存原始值
                select.dataset.originalValue = select.value;
            });

            // 為刪除按鈕添加事件監聽器
            userListDiv.querySelectorAll('.delete-user-btn').forEach(button => {
                button.addEventListener('click', async (event) => {
                    const uidToDelete = event.target.dataset.uid;
                    if (confirm(`確定要刪除用戶 ${uidToDelete} 嗎？此操作不可逆！`)) {
                        try {
                            await db.collection('users').doc(uidToDelete).delete();
                            showMessage('成功', `用戶 ${uidToDelete} 已刪除。`);
                            refreshUserList(); // 重新整理列表
                        } catch (error) {
                            console.error("刪除用戶時出錯:", error);
                            showMessage('錯誤', `刪除用戶失敗: ${error.message}`);
                        }
                    }
                });
            });

        } catch (error) {
            console.error("載入用戶列表時出錯:", error);
            userListDiv.innerHTML = `<p style="color: red;">載入用戶列表失敗: ${error.message}</p>`;
        }
    };


    // Firestore 實時監聽器
    // 監聽用戶的權限變化
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            loginForm.style.display = 'none';
            loggedInDashboard.style.display = 'flex';
            userEmailDisplay.textContent = user.email;
            userEmailDisplay.style.display = 'block'; // 顯示 email

            // 獲取用戶角色
            db.collection('users').doc(user.uid).onSnapshot(async (doc) => {
                if (doc.exists) {
                    const userData = doc.data();
                    currentUserRole = userData.role || 'user';
                    userRoleDisplay.textContent = currentUserRole;
                    console.log("用戶角色:", currentUserRole);

                    // 根據角色顯示/隱藏管理選項
                    if (currentUserRole === 'owner' || currentUserRole === 'editor') {
                        // 讓編輯器和擁有者可以上傳和刪除 KML
                        uploadKmlSubmitBtnDashboard.disabled = false;
                        deleteSelectedKmlBtn.disabled = false;
                        // 確保 kmlLayerSelectDashboard 啟用
                        kmlLayerSelectDashboard.disabled = false;

                        // 只有 owner 才能看到和操作註冊設定和用戶管理
                        if (currentUserRole === 'owner') {
                            registrationSettingsSection.style.display = 'flex';
                            userManagementSection.style.display = 'block'; // Block for user list table
                            refreshUserList(); // 重新整理用戶列表

                            // 獲取註冊設定
                            db.collection('settings').doc('registration').onSnapshot((regDoc) => {
                                if (regDoc.exists) {
                                    const regData = regDoc.data();
                                    allowDirectRegistration.checked = regData.isRegistrationOpen || false;
                                    allowDirectRegistration.disabled = false; // Owner 可以啟用/禁用

                                    // 顯示註冊碼和過期時間
                                    if (regData.oneTimeCode) {
                                        registrationCodeDisplay.textContent = `一次性註冊碼: ${regData.oneTimeCode}`;
                                        registrationCodeDisplay.style.display = 'block';
                                        if (regData.oneTimeCodeExpiry) {
                                            const expiryDate = new Date(regData.oneTimeCodeExpiry.toDate());
                                            registrationExpiryDisplay.textContent = `過期時間: ${expiryDate.toLocaleString()}`;
                                            registrationExpiryDisplay.style.display = 'block';
                                        } else {
                                            registrationExpiryDisplay.style.display = 'none';
                                        }
                                    } else {
                                        registrationCodeDisplay.style.display = 'none';
                                        registrationExpiryDisplay.style.display = 'none';
                                    }
                                } else {
                                    allowDirectRegistration.checked = false;
                                    allowDirectRegistration.disabled = false;
                                    registrationCodeDisplay.style.display = 'none';
                                    registrationExpiryDisplay.style.display = 'none';
                                }
                            });

                        } else {
                            registrationSettingsSection.style.display = 'none';
                            userManagementSection.style.display = 'none';
                        }
                    } else { // 普通用戶
                        uploadKmlSubmitBtnDashboard.disabled = true;
                        deleteSelectedKmlBtn.disabled = true;
                        kmlLayerSelectDashboard.disabled = true;
                        registrationSettingsSection.style.display = 'none';
                        userManagementSection.style.display = 'none';
                    }

                    // 無論角色如何，都更新 KML 圖層選單
                    updateKmlLayerSelects();

                } else {
                    console.log("用戶數據不存在，可能需要創建用戶數據。");
                    // 這裡可以處理新註冊用戶的情況，例如自動給予 'user' 角色
                    try {
                        await db.collection('users').doc(user.uid).set({
                            email: user.email,
                            role: 'user', // 預設角色
                            createdAt: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true }); // 使用 merge 以避免覆蓋其他潛在數據
                        currentUserRole = 'user';
                        userRoleDisplay.textContent = currentUserRole;
                        showMessage('歡迎', '您的帳號已創建。');
                        updateKmlLayerSelects(); // 載入 KML 選單
                    } catch (error) {
                        console.error("創建用戶數據時出錯:", error);
                        showMessage('錯誤', `創建用戶數據失敗: ${error.message}`);
                    }
                }
            });

        } else {
            loginForm.style.display = 'flex';
            loggedInDashboard.style.display = 'none';
            userEmailDisplay.textContent = '';
            userEmailDisplay.style.display = 'none';
            userRoleDisplay.textContent = '';
            currentUserRole = null;
            updateKmlLayerSelects(); // 清空 KML 選單
        }
    });

    // 事件監聽器：Google 登入
    googleSignInBtn.addEventListener('click', async () => {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            await auth.signInWithPopup(provider);
            // 登入成功後 onAuthStateChanged 會處理後續邏輯
        } catch (error) {
            console.error("Google 登入失敗:", error);
            showMessage('登入失敗', `Google 登入時發生錯誤: ${error.message}`);
        }
    });

    // 事件監聽器：Email 登入
    emailLoginBtn.addEventListener('click', async () => {
        const email = loginEmail.value;
        const password = loginPassword.value;
        if (!email || !password) {
            loginMessage.textContent = 'Email 和密碼不能為空。';
            return;
        }
        try {
            await auth.signInWithEmailAndPassword(email, password);
            loginMessage.textContent = ''; // 清空訊息
            // 登入成功後 onAuthStateChanged 會處理後續邏輯
        } catch (error) {
            console.error("Email 登入失敗:", error);
            loginMessage.textContent = `登入失敗: ${error.message}`;
            showMessage('登入失敗', `Email 登入時發生錯誤: ${error.message}`);
        }
    });

    // 事件監聽器：顯示註冊表單
    showRegisterFormBtn.addEventListener('click', async () => {
        const allowDirectRegDoc = await db.collection('settings').doc('registration').get();
        const isDirectRegistrationOpen = allowDirectRegDoc.exists && allowDirectRegDoc.data().isRegistrationOpen;

        if (isDirectRegistrationOpen) {
            // 允許直接註冊，直接進入註冊流程
            registerUser();
        } else {
            // 需要一次性註冊碼
            window.showRegistrationCodeModal(async (code) => {
                if (code) {
                    try {
                        const regDoc = await db.collection('settings').doc('registration').get();
                        if (!regDoc.exists || regDoc.data().oneTimeCode !== code || new Date() > regDoc.data().oneTimeCodeExpiry.toDate()) {
                            showMessage('註冊失敗', '無效或過期的註冊碼。');
                            return;
                        }
                        // 如果註冊碼有效，則可以進行註冊
                        registerUser(code); // 將一次性註冊碼傳遞給註冊函數
                    } catch (error) {
                        console.error("檢查註冊碼時出錯:", error);
                        showMessage('錯誤', `檢查註冊碼失敗: ${error.message}`);
                    }
                } else {
                    showMessage('取消', '您已取消註冊。');
                }
            });
        }
    });

    // 註冊用戶函數 (處理 Email/密碼註冊)
    const registerUser = async (oneTimeCode = null) => {
        const email = loginEmail.value;
        const password = loginPassword.value;
        if (!email || !password) {
            loginMessage.textContent = 'Email 和密碼不能為空。';
            return;
        }

        try {
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;

            // 創建用戶資料到 Firestore
            await db.collection('users').doc(user.uid).set({
                email: user.email,
                role: 'user', // 預設為普通用戶
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                // 如果使用了一次性註冊碼，可以在這裡記錄
                registeredWithCode: oneTimeCode ? true : false,
                registrationCodeUsed: oneTimeCode || null
            });

            if (oneTimeCode) {
                // 如果使用了一次性註冊碼，則將其從 Firestore 中刪除
                await db.collection('settings').doc('registration').update({
                    oneTimeCode: firebase.firestore.FieldValue.delete(),
                    oneTimeCodeExpiry: firebase.firestore.FieldValue.delete()
                });
            }

            loginMessage.textContent = ''; // 清空訊息
            showMessage('註冊成功', `歡迎 ${user.email}！您已成功註冊。`);
            // 註冊成功後 onAuthStateChanged 會處理後續邏輯
        } catch (error) {
            console.error("註冊失敗:", error);
            loginMessage.textContent = `註冊失敗: ${error.message}`;
            showMessage('註冊失敗', `註冊帳號時發生錯誤: ${error.message}`);
        }
    };


    // 事件監聽器：登出
    logoutBtn.addEventListener('click', async () => {
        try {
            await auth.signOut();
            showMessage('登出成功', '您已成功登出。');
            // 登出成功後 onAuthStateChanged 會處理後續邏輯
        } catch (error) {
            console.error("登出失敗:", error);
            showMessage('登出失敗', `登出時發生錯誤: ${error.message}`);
        }
    });

    // 事件監聽器：上傳 KML
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
            showMessage('提示', '請先選擇 KML 檔案。');
            return;
        }
        if (!auth.currentUser) {
            showMessage('錯誤', '請先登入才能上傳 KML。');
            return;
        }

        const fileName = file.name;
        const storageRef = storage.ref(`kml/${fileName}`);
        const kmlDocRef = db.collection('kml').doc(); // 自動生成 ID

        try {
            showMessage('上傳中', '正在上傳 KML 檔案，請稍候...');
            const snapshot = await storageRef.put(file);
            const downloadURL = await snapshot.ref.getDownloadURL();

            await kmlDocRef.set({
                name: fileName,
                url: downloadURL,
                uploadedBy: auth.currentUser.uid,
                uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            showMessage('成功', `KML 檔案 "${fileName}" 上傳成功！`);
            hiddenKmlFileInput.value = ''; // 清空檔案選擇
            selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
            uploadKmlSubmitBtnDashboard.disabled = true;
            updateKmlLayerSelects(); // 更新列表
        } catch (error) {
            console.error("上傳 KML 失敗:", error);
            showMessage('上傳失敗', `上傳 KML 檔案時發生錯誤: ${error.message}`);
        }
    });

    // 事件監聽器：刪除 KML
    deleteSelectedKmlBtn.addEventListener('click', async () => {
        const kmlIdToDelete = kmlLayerSelectDashboard.value;
        if (!kmlIdToDelete) {
            showMessage('提示', '請先選擇要刪除的 KML 圖層。');
            return;
        }
        if (!auth.currentUser) {
            showMessage('錯誤', '請先登入才能刪除 KML。');
            return;
        }

        if (!confirm('確定要刪除此 KML 圖層嗎？此操作不可逆！')) {
            return;
        }

        try {
            const kmlDoc = await db.collection('kml').doc(kmlIdToDelete).get();
            if (!kmlDoc.exists) {
                showMessage('錯誤', '找不到該 KML 圖層。');
                return;
            }
            const kmlData = kmlDoc.data();
            const fileName = kmlData.name; // 從 Firestore 獲取文件名

            // 刪除 Storage 中的檔案
            const storageRef = storage.ref(`kml/${fileName}`);
            await storageRef.delete();

            // 刪除 Firestore 中的記錄
            await db.collection('kml').doc(kmlIdToDelete).delete();

            showMessage('成功', `KML 圖層 "${fileName}" 已成功刪除！`);
            updateKmlLayerSelects(); // 更新列表
            // 如果當前地圖上顯示的是這個 KML，則清除它
            if (typeof window.clearAllKmlLayers === 'function') {
                window.clearAllKmlLayers();
            }
        } catch (error) {
            console.error("刪除 KML 失敗:", error);
            showMessage('刪除失敗', `刪除 KML 圖層時發生錯誤: ${error.message}`);
        }
    });

    // 事件監聽器：生成一次性註冊碼 (Owner Only)
    generateRegistrationCodeBtn.addEventListener('click', async () => {
        if (currentUserRole !== 'owner') {
            showMessage('權限不足', '只有管理員才能生成註冊碼。');
            return;
        }

        try {
            // 生成一個隨機的 8 位字母數字字串
            const code = Math.random().toString(36).substring(2, 10).toUpperCase();
            // 設定 24 小時後過期
            const expiryDate = new Date();
            expiryDate.setHours(expiryDate.getHours() + 24);

            await db.collection('settings').doc('registration').set({
                oneTimeCode: code,
                oneTimeCodeExpiry: firebase.firestore.Timestamp.fromDate(expiryDate)
            }, { merge: true });

            registrationCodeDisplay.textContent = `一次性註冊碼: ${code}`;
            registrationExpiryDisplay.textContent = `過期時間: ${expiryDate.toLocaleString()}`;
            registrationCodeDisplay.style.display = 'block';
            registrationExpiryDisplay.style.display = 'block';
            showMessage('成功', '一次性註冊碼已生成！');
        } catch (error) {
            console.error("生成註冊碼時出錯:", error);
            showMessage('錯誤', `生成註冊碼失敗: ${error.message}`);
        }
    });

    // 事件監聽器：切換直接註冊權限 (Owner Only)
    allowDirectRegistration.addEventListener('change', async (event) => {
        if (currentUserRole !== 'owner') {
            showMessage('權限不足', '只有管理員才能修改此設定。');
            event.target.checked = !event.target.checked; // 恢復原狀態
            return;
        }
        try {
            await db.collection('settings').doc('registration').set({
                isRegistrationOpen: event.target.checked
            }, { merge: true });
            showMessage('成功', `直接註冊已${event.target.checked ? '啟用' : '禁用'}。`);
        } catch (error) {
            console.error("修改直接註冊設定時出錯:", error);
            showMessage('錯誤', `修改設定失敗: ${error.message}`);
        }
    });

    // 事件監聽器：重新整理用戶列表 (Owner Only)
    refreshUsersBtn.addEventListener('click', () => {
        if (currentUserRole === 'owner') {
            refreshUserList();
        } else {
            showMessage('權限不足', '只有管理員才能重新整理用戶列表。');
        }
    });

});