// auth.js
window.currentUserRole = 'user';
window.currentUserNickname = '';

auth.onAuthStateChanged(async (user) => {
    const els = {
        loginForm: document.getElementById('loginForm'),
        loggedInDashboard: document.getElementById('loggedInDashboard'),
        adminSection: document.getElementById('adminSection'),
        userManagementSection: document.getElementById('userManagementSection')
    };

    if (user) {
        els.loginForm.style.display = 'none';
        els.loggedInDashboard.style.display = 'block';
        const userDoc = await db.collection('users').doc(user.uid).get();
        if (userDoc.exists) {
            const data = userDoc.data();
            window.currentUserRole = data.role;
            window.currentUserNickname = data.nickname;
            document.getElementById('userEmailDisplay').textContent = `${data.nickname} (${data.role})`;
            
            // 權限面板邏輯: owner/editor 顯示管理區塊
            const isAdmin = ['owner', 'editor'].includes(data.role);
            els.adminSection.style.display = isAdmin ? 'block' : 'none';
            if (isAdmin) window.refreshUserList?.(); 
        }
        window.updateKmlLayerSelects(); // 呼叫 kml.js
    } else {
        els.loginForm.style.display = 'block';
        els.loggedInDashboard.style.display = 'none';
    }
});

// 保留註冊碼生成 logic
window.generateRegistrationCode = async () => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + (10 * 60 * 1000);
    await db.collection('registrationCodes').doc(code).set({ code, expiry, used: false });
    document.getElementById('registrationCodeDisplay').textContent = code;
    // ...加入原本的 setInterval 倒數邏輯
};