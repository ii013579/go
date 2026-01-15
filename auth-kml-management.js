// auth-kml-management.js
(function() {
    const db = window.db;
    const auth = window.auth;

    auth.onAuthStateChanged(async (user) => {
        const loginForm = document.getElementById('loginForm');
        const loggedInDashboard = document.getElementById('loggedInDashboard');
        const adminSection = document.getElementById('registrationSettingsSection');
        const userManagement = document.getElementById('userManagementSection');
        const userEmailDisplay = document.getElementById('userEmailDisplay');

        if (user) {
            userEmailDisplay.textContent = `${user.email} (確認中...)`;
            
            // 讀取使用者角色
            const userDoc = await db.collection('users').doc(user.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                window.currentUserRole = userData.role;
                userEmailDisplay.textContent = `${user.email} (${userData.role === 'owner' ? '擁有者' : '編輯者'})`;

                // 恢復 UI 顯示
                if (loginForm) loginForm.style.display = 'none';
                if (loggedInDashboard) loggedInDashboard.style.display = 'block';
                
                // 擁有者特有功能 (產生註冊碼、使用者管理)
                if (userData.role === 'owner') {
                    if (adminSection) adminSection.style.display = 'block';
                    if (userManagement) userManagement.style.display = 'block';
                    loadUserList(); // 恢復使用者管理清單
                }
            } else {
                // 新用戶跳轉註冊邏輯...
                window.showRegistrationModal(true);
            }
            window.updateKmlLayerSelects();
        } else {
            if (loginForm) loginForm.style.display = 'block';
            if (loggedInDashboard) loggedInDashboard.style.display = 'none';
        }
    });

    // 恢復使用者管理清單功能
    async function loadUserList() {
        const userTable = document.getElementById('userTableBody');
        if (!userTable) return;
        const snapshot = await db.collection('users').get();
        userTable.innerHTML = '';
        snapshot.forEach(doc => {
            const u = doc.data();
            userTable.innerHTML += `
                <tr>
                    <td>${u.email}</td>
                    <td>${u.name || ''}</td>
                    <td>${u.role}</td>
                    <td><button onclick="changeRole('${doc.id}', '${u.role}')">變更權限</button></td>
                </tr>`;
        });
    }
})();