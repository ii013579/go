// js/auth.js

// 假設 auth 和 db 已經在 firebase-init.js 中初始化並成為全域變數

const userStatusElement = document.getElementById('user-status');
const authButton = document.getElementById('auth-button');
const logoutButton = document.getElementById('logout-button');
const ownerPanel = document.getElementById('ownerPanel');
const openRegistrationCodeButton = document.getElementById('openRegistrationCodeButton');
const registrationCodeStatus = document.getElementById('registrationCodeStatus');
const refreshPendingUsersButton = document.getElementById('refreshPendingUsersButton');
const pendingUsersList = document.getElementById('pendingUsersList');
const messageDisplayOwner = document.getElementById('messageDisplayOwner'); // Owner面板的訊息顯示區


// Firestore 中的設定文檔參考
const settingsDocRef = db.collection('settings').doc('registration');


// 檢查註冊碼狀態並更新 UI (在 owner 面板中顯示)
async function checkRegistrationStatus() {
    try {
        const doc = await settingsDocRef.get();
        if (doc.exists && doc.data().isRegistrationOpen) {
            const expiresAt = doc.data().expiresAt ? doc.data().expiresAt.toDate() : null;
            const code = doc.data().registrationCode;
            if (expiresAt && expiresAt > new Date()) {
                registrationCodeStatus.textContent = `註冊碼已啟用：${code} (將於 ${expiresAt.toLocaleTimeString()} 失效)`;
                registrationCodeStatus.style.color = 'green';
            } else {
                registrationCodeStatus.textContent = '註冊碼已過期或未啟用。';
                registrationCodeStatus.style.color = 'orange';
            }
        } else {
            registrationCodeStatus.textContent = '目前註冊碼未啟用。';
            registrationCodeStatus.style.color = 'orange';
        }
    } catch (error) {
        console.error("檢查註冊碼狀態失敗:", error);
        registrationCodeStatus.textContent = '無法檢查註冊碼狀態，請稍後再試。';
        registrationCodeStatus.style.color = 'red';
    }
}


// 處理「開啟註冊碼」按鈕點擊事件 (僅限 Owner 執行)
openRegistrationCodeButton.addEventListener('click', async () => {
    setLoading('openRegistrationCodeButton', 'loadingSpinnerOwner', true); // 使用 Owner 面板的 spinner
    showMessage('messageDisplayOwner', '', false); // 清除舊訊息

    const currentAuthUser = auth.currentUser;
    if (!currentAuthUser) {
        showMessage('messageDisplayOwner', '請先登入 Owner 帳號才能開啟註冊碼。');
        setLoading('openRegistrationCodeButton', 'loadingSpinnerOwner', false);
        return;
    }

    try {
        // 規則已在 Firestore 確保只有 owner 能寫入 settings
        const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const expiresAt = new Date(Date.now() + 30 * 1000); // 30 秒後過期

        await settingsDocRef.set({
            isRegistrationOpen: true,
            registrationCode: newCode,
            expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt)
        }, { merge: true });

        showMessage('messageDisplayOwner', `註冊碼已成功開啟：${newCode} (30秒內有效)。`, false);
        checkRegistrationStatus(); // 更新 UI 狀態
    } catch (error) {
        console.error("開啟註冊碼失敗:", error);
        showMessage('messageDisplayOwner', '開啟註冊碼失敗，請檢查權限或網路。' + error.message);
    } finally {
        setLoading('openRegistrationCodeButton', 'loadingSpinnerOwner', false);
    }
});


// 載入並顯示待處理用戶列表
async function fetchPendingUsers() {
    pendingUsersList.innerHTML = '<p>載入中...</p>'; // 顯示載入中訊息
    try {
        // Owner 權限在 rules 中已允許讀取所有用戶文檔
        const usersSnapshot = await db.collection('users').get();
        const pending = [];

        usersSnapshot.forEach(doc => {
            const userData = doc.data();
            // 判斷條件：沒有 role 字段 或者 role 字段為空字串/null
            if (!userData.role || userData.role === '' || userData.role === null) {
                pending.push({ id: doc.id, ...userData });
            }
        });

        if (pending.length === 0) {
            pendingUsersList.innerHTML = '<p>沒有待處理的註冊。</p>';
        } else {
            pendingUsersList.innerHTML = ''; // 清空列表
            pending.forEach(user => {
                const userItem = document.createElement('div');
                userItem.className = 'pending-user-item';
                userItem.style.cssText = 'border-bottom: 1px solid #eee; padding: 8px 0; display: flex; justify-content: space-between; align-items: center;';
                userItem.innerHTML = `
                    <span>${user.name} (${user.email})</span>
                    <button data-uid="${user.id}" class="assign-editor-btn" style="background-color: #007bff; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">賦予 Editor</button>
                `;
                pendingUsersList.appendChild(userItem);
            });

            // 為每個「賦予 Editor」按鈕添加事件監聽器
            document.querySelectorAll('.assign-editor-btn').forEach(button => {
                button.addEventListener('click', async (event) => {
                    const userId = event.target.dataset.uid;
                    event.target.disabled = true; // 防止重複點擊
                    event.target.textContent = '處理中...';
                    try {
                        // owner 權限在 rules 中已允許更新任何用戶的 role 字段
                        await db.collection('users').doc(userId).update({ role: 'editor' });
                        showMessage('messageDisplayOwner', `已成功將 ${event.target.parentNode.querySelector('span').textContent} 設置為 editor。`, false);
                        await fetchPendingUsers(); // 重新整理列表
                    } catch (error) {
                        console.error("賦予 editor 權限失敗:", error);
                        showMessage('messageDisplayOwner', `賦予權限失敗: ${error.message}`);
                        event.target.disabled = false;
                        event.target.textContent = '賦予 Editor';
                    }
                });
            });
        }

    } catch (error) {
        console.error("載入待處理用戶失敗:", error);
        pendingUsersList.innerHTML = `<p style="color: red;">載入失敗: ${error.message}</p>`;
    }
}


// --- 監聽 Firebase 認證狀態變化 (主要邏輯) ---
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        userStatusElement.textContent = `載入用戶資料...`;
        authButton.style.display = 'none';
        logoutButton.style.display = 'block';

        try {
            const userDoc = await db.collection('users').doc(user.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                const userRole = userData.role || '未設定'; // 如果沒有 role 字段，顯示 '未設定'
                userStatusElement.textContent = `歡迎, ${userData.name || user.email} (角色: ${userRole})`;

                // 如果是 owner，則顯示 Owner 管理面板並載入相關資訊
                if (userRole === 'owner') {
                    ownerPanel.style.display = 'block';
                    checkRegistrationStatus(); // 檢查註冊碼狀態
                    fetchPendingUsers(); // 載入待處理用戶列表
                } else {
                    ownerPanel.style.display = 'none'; // 隱藏面板
                }
            } else {
                // 用戶文檔不存在 (可能新註冊還未成功寫入 Firestore 或其他問題)
                userStatusElement.textContent = `歡迎, ${user.email} (用戶資料缺失)`;
                ownerPanel.style.display = 'none'; // 隱藏面板
            }
            // 登入後載入 KML 資料
            if (typeof loadKMLFromFirestore === 'function') {
                loadKMLFromFirestore();
            } else {
                console.warn('loadKMLFromFirestore 函數未定義。');
            }
        } catch (error) {
            console.error("讀取用戶角色失敗:", error);
            userStatusElement.textContent = `歡迎, ${user.email} (讀取角色失敗)`;
            ownerPanel.style.display = 'none'; // 隱藏面板
            if (typeof loadKMLFromFirestore === 'function') {
                loadKMLFromFirestore(); // 即使讀取角色失敗，仍嘗試載入 KML 資料
            }
        }

    } else {
        // 用戶未登入
        userStatusElement.textContent = '您尚未登入。';
        authButton.textContent = '登入 / 註冊';
        authButton.style.display = 'block';
        logoutButton.style.display = 'none';
        ownerPanel.style.display = 'none'; // 未登入隱藏面板
        // 清除地圖上的 KML 層和搜尋資料 (如果 map-app.js 定義了這些變數)
        if (typeof kmlFeatures !== 'undefined') kmlFeatures.clearLayers();
        if (typeof allKmlData !== 'undefined') allKmlData = [];
    }
});

// 登入/註冊按鈕點擊事件 (導向登入頁面)
authButton.addEventListener('click', () => {
    // 這裡導向到統一的登入頁面，這個頁面將承擔註冊和登入的功能
    window.location.href = 'login.html';
});

// 登出按鈕點擊事件
logoutButton.addEventListener('click', async () => {
    try {
        await firebase.auth().signOut();
        alert('您已登出。');
        // 登出後頁面會自動刷新，onAuthStateChanged 會處理未登入狀態
    } catch (error) {
        console.error("登出失敗:", error);
        alert('登出失敗: ' + error.message);
    }
});

// 重新整理待處理用戶按鈕的事件監聽器
refreshPendingUsersButton.addEventListener('click', fetchPendingUsers);