//(身份與權限模組)
// auth-service.js v2.0 

(function () {
    'use strict';
    const $ = id => document.getElementById(id);

    window.getRoleDisplayName = role => {
        const roles = { 'unapproved': '未審核', 'user': '一般', 'editor': '編輯者', 'owner': '擁有者' };
        return roles[role] || role || '';
    };

    const initAuth = () => {
        if (!window.auth) { setTimeout(initAuth, 100); return; }

        // 登入按鈕綁定
        const googleBtn = $('googleSignInBtn');
        if (googleBtn) {
            googleBtn.onclick = () => {
                const provider = new firebase.auth.GoogleAuthProvider();
                window.auth.signInWithPopup(provider).catch(e => window.showMessage('登入失敗', e.message));
            };
        }

        // 登出按鈕
        if ($('logoutBtn')) $('logoutBtn').onclick = () => window.auth.signOut();

        // 監聽狀態
        window.auth.onAuthStateChanged(async (user) => {
            const dashboard = $('loggedInDashboard');
            const loginForm = $('loginForm');
            
            if (user) {
                if ($('userEmailDisplay')) $('userEmailDisplay').textContent = user.email;
                loginForm.style.display = 'none';
                dashboard.style.display = 'block';
                
                // 觸發 KML 清單載入 (DataManager)
                if (window.DataManager) window.DataManager.fetchKmlList();
            } else {
                loginForm.style.display = 'block';
                dashboard.style.display = 'none';
            }
        });
    };

    document.addEventListener('DOMContentLoaded', initAuth);
})();