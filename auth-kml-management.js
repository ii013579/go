// auth-kml-management.js (針對您的 Firebase 規則進行對齊)

(function() {
    // 1. 初始化 (確保與 firebase-init.js 同步)
    const db = window.db;
    const auth = window.auth;
    const appId = window.appId;

    // 2. 監聽登入狀態
    auth.onAuthStateChanged(async (user) => {
        const loginForm = document.getElementById('loginForm');
        const loggedInDashboard = document.getElementById('loggedInDashboard');
        const userEmailDisplay = document.getElementById('userEmailDisplay');
        const adminSection = document.getElementById('registrationSettingsSection');

        if (user) {
            try {
                // 嘗試讀取用戶資料 (規則: allow read: if auth.uid == uid)
                const userDoc = await db.collection('users').doc(user.uid).get();
                
                if (!userDoc.exists) {
                    // 如果沒有用戶文檔，表示是新使用者，彈出註冊碼視窗 (規則要求註冊碼)
                    console.log("新使用者，啟動註冊碼驗證...");
                    window.showRegistrationModal(true); 
                } else {
                    const userData = userDoc.data();
                    window.currentUserRole = userData.role;
                    
                    // 登入後 UI 切換
                    if (loginForm) loginForm.style.display = 'none';
                    if (loggedInDashboard) loggedInDashboard.style.display = 'block';
                    if (userEmailDisplay) userEmailDisplay.textContent = user.email;
                    
                    // 只有 Owner 可以看管理區 (規則: isOwner())
                    if (window.currentUserRole === 'owner' && adminSection) {
                        adminSection.style.display = 'block';
                    }

                    // 載入 KML 清單 (規則: /artifacts/{appId}/public/... allow read: if true)
                    await window.updateKmlLayerSelects();
                }
            } catch (err) {
                console.error("登入後權限檢查出錯:", err);
                // 可能是因為規則擋住讀取
                window.showMessage("權限錯誤", "無法讀取使用者資料，請確認資料庫 users 集合。");
            }
        } else {
            if (loginForm) loginForm.style.display = 'block';
            if (loggedInDashboard) loggedInDashboard.style.display = 'none';
        }
    });

    // 3. Google 登入 (舊樣式按鈕 ID)
    document.getElementById('googleSignInBtn')?.addEventListener('click', () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider).catch(err => {
            window.showMessage("登入失敗", "Firebase 驗證失敗: " + err.message);
        });
    });

    // 4. 新使用者註冊功能 (對齊您的規則：request.resource.data.registrationCodeUsed == settings/registration.oneTimeCode)
    document.getElementById('confirmRegistrationCodeBtn')?.addEventListener('click', async () => {
        const codeInput = document.getElementById('registrationCodeInput').value;
        const nickname = document.getElementById('nicknameInput').value;
        const user = auth.currentUser;

        if (!codeInput || !nickname) return alert("請填寫完整資訊");

        try {
            // 寫入 users 集合 (必須符合規則中的欄位名稱)
            await db.collection('users').doc(user.uid).set({
                email: user.email,
                name: nickname, // 規則: request.resource.data.name is string
                role: 'unapproved', // 規則: request.resource.data.role == 'unapproved'
                registeredWithCode: true,
                registrationCodeUsed: codeInput, // 規則會拿這個跟 settings/registration 比對
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            window.showMessage("註冊成功", "請聯繫管理員審核您的 Editor 權限。");
            window.showRegistrationModal(false);
            location.reload(); // 重新整理以觸發 auth 狀態更新
        } catch (err) {
            console.error("註冊失敗:", err);
            window.showMessage("驗證失敗", "註冊碼錯誤或已過期 (規則驗證未通過)");
        }
    });

    // 5. 登出
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        auth.signOut().then(() => location.reload());
    });

})();