// auth-core.js v2.0.0
// 職責：守門員 (驗證身分、判定角色、切換 UI 權限)

// 全域狀態管理
window.currentUserRole = 'unapproved'; // 預設權限
window.currentUserEmail = null;

/**
 * 監聽 Firebase 登入狀態
 */
window.auth.onAuthStateChanged(async (user) => {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userRoleDisplay = document.getElementById('userRoleDisplay');
    const loggedInDashboard = document.getElementById('loggedInDashboard');
    const adminSection = document.getElementById('adminSection');

    if (user) {
        // 使用者已登入
        window.currentUserEmail = user.email;
        console.log("守門員：使用者已登入 ->", user.email);

        try {
            // 1. 從 Firestore 取得使用者角色
            const userDoc = await window.db.collection('users').doc(user.uid).get();
            
            if (userDoc.exists) {
                window.currentUserRole = userDoc.data().role || 'unapproved';
            } else {
                // 第一次登入的新使用者，先在資料庫建立基本資料
                await window.db.collection('users').doc(user.uid).set({
                    email: user.email,
                    role: 'unapproved',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                window.currentUserRole = 'unapproved';
            }

            // 2. 更新介面顯示
            if (loginBtn) loginBtn.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'block';
            if (userRoleDisplay) userRoleDisplay.textContent = `身分: ${window.currentUserRole} (${user.email})`;
            
            // 3. 根據角色顯示功能區塊
            if (window.currentUserRole === 'owner' || window.currentUserRole === 'editor') {
                if (loggedInDashboard) loggedInDashboard.style.display = 'block';
                // 只有 owner 可以看到管理員專區 (例如生成註冊碼)
                if (adminSection) {
                    adminSection.style.display = (window.currentUserRole === 'owner') ? 'block' : 'none';
                }
            } else {
                // 未審核使用者
                if (loggedInDashboard) loggedInDashboard.style.display = 'none';
                handleUnapprovedUser();
            }

            // ? 重要：通知搬運工 (kml-worker.js)，身分已確認，可以開始載入清單
            document.dispatchEvent(new CustomEvent('authReady', { 
                detail: { role: window.currentUserRole, email: user.email } 
            }));

        } catch (error) {
            console.error("取得權限失敗:", error);
            window.showMessage('錯誤', '無法取得您的權限資料。');
        }
    } else {
        // 使用者未登入
        resetAuthUI();
    }
});

/**
 * 處理未審核使用者的流程
 */
function handleUnapprovedUser() {
    window.showRegistrationCodeModal(async (result) => {
        if (!result) return;

        const { code, nickname } = result;
        try {
            // 呼叫註冊碼驗證邏輯 (通常會寫在後端或由 kml-worker 處理)
            // 這裡發送一個事件讓專門處理資料的 worker 去執行驗證
            document.dispatchEvent(new CustomEvent('requestVerifyCode', { 
                detail: { code, nickname } 
            }));
        } catch (error) {
            window.showMessage('驗證失敗', error.message);
        }
    });
}

/**
 * 重置登入 UI
 */
function resetAuthUI() {
    window.currentUserRole = 'unapproved';
    window.currentUserEmail = null;
    
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userRoleDisplay = document.getElementById('userRoleDisplay');
    const loggedInDashboard = document.getElementById('loggedInDashboard');

    if (loginBtn) loginBtn.style.display = 'block';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (userRoleDisplay) userRoleDisplay.textContent = '身分: 未登入';
    if (loggedInDashboard) loggedInDashboard.style.display = 'none';
    
    // 通知搬運工清空權限相關資料
    document.dispatchEvent(new CustomEvent('authLoggedOut'));
}

// --- 監聽登入與登出按鈕 ---
document.getElementById('loginBtn')?.addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    window.auth.signInWithPopup(provider);
});

document.getElementById('logoutBtn')?.addEventListener('click', () => {
    window.auth.signOut().then(() => {
        window.location.reload(); // 登出後重新整理最乾淨
    });
});