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
            try {
                const userDoc = await db.collection('users').doc(user.uid).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    window.currentUserRole = userData.role;
                    userEmailDisplay.textContent = `${user.email} (${userData.role === 'owner' ? '擁有者' : '編輯者'})`;

                    // UI 顯示切換
                    if (loginForm) loginForm.style.display = 'none';
                    if (loggedInDashboard) loggedInDashboard.style.display = 'block';
                    
                    // 擁有者特有功能 (產生註冊碼、使用者管理)
                    if (userData.role === 'owner') {
                        if (adminSection) adminSection.style.display = 'block';
                        if (userManagement) userManagement.style.display = 'block';
                        loadUserList(); 
                    }
                } else {
                    // 新用戶跳轉註冊邏輯
                    window.showRegistrationModal(true);
                }
                // 更新下拉選單
                if (window.updateKmlLayerSelects) await window.updateKmlLayerSelects();
            } catch (error) {
                console.error("讀取使用者資料出錯:", error);
            }
        } else {
            if (loginForm) loginForm.style.display = 'block';
            if (loggedInDashboard) loggedInDashboard.style.display = 'none';
        }
    });

    // 恢復使用者管理清單功能
    async function loadUserList() {
        const userTable = document.getElementById('userTableBody');
        if (!userTable) return;
        try {
            const snapshot = await db.collection('users').get();
            userTable.innerHTML = '';
            snapshot.forEach(doc => {
                const u = doc.data();
                const uid = doc.id;
                userTable.innerHTML += `
                    <tr>
                        <td>${u.email}</td>
                        <td>${u.name || ''}</td>
                        <td>${u.role}</td>
                        <td><button onclick="changeRole('${uid}', '${u.role}')">變更權限</button></td>
                    </tr>`;
            });
        } catch (error) {
            console.error("載入使用者列表失敗:", error);
        }
    }

    // 修正：補上變更權限函式
    window.changeRole = async function(uid, currentRole) {
        const newRole = currentRole === 'editor' ? 'unapproved' : 'editor';
        if(confirm(`確定要將該使用者的權限變更為 [${newRole}] 嗎？`)) {
            try {
                await db.collection('users').doc(uid).update({ role: newRole });
                window.showMessage("成功", "權限已更新");
                loadUserList(); // 重新整理列表
            } catch (error) {
                window.showMessage("錯誤", "更新失敗: " + error.message);
            }
        }
    };

    // 登出功能
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        auth.signOut().then(() => location.reload());
    });

})();