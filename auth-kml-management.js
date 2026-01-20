// auth-kml-management.js v1.9.6

(function() {
    /**
     * 1. 全域更新下拉選單
     * 作用：從 Firestore 讀取所有 KML 圖層，並同步更新「首頁選單」與「管理後台選單」
     */
    window.updateKmlLayerSelects = async function() {
        console.log("正在同步 KML 圖層選單...");
        try {
            // 存取路徑與 map-logic.js 一致
            const snap = await window.db.collection('artifacts').doc(window.appId)
                .collection('public').doc('data')
                .collection('kmlLayers').orderBy('uploadTime', 'desc').get();
            
            let optionsHtml = '<option value="">-- 請選擇資料庫 --</option>';
            
            snap.forEach(doc => {
                const data = doc.data();
                optionsHtml += `<option value="${doc.id}">${data.name || '未命名圖層'}</option>`;
            });

            // 同時更新兩個位置的下拉選單
            const mainSelect = document.getElementById('kmlLayerSelect');
            const dashboardSelect = document.getElementById('kmlLayerSelectDashboard');

            if (mainSelect) mainSelect.innerHTML = optionsHtml;
            if (dashboardSelect) dashboardSelect.innerHTML = optionsHtml;

        } catch (error) {
            console.error("更新選單失敗:", error);
        }
    };

    /**
     * 2. 監聽首頁選單變動
     * 作用：當使用者選擇圖層時，呼叫 map-logic.js 的載入功能
     */
    const mainSelect = document.getElementById('kmlLayerSelect');
    if (mainSelect) {
        mainSelect.addEventListener('change', (e) => {
            const kmlId = e.target.value;
            if (kmlId && window.loadKmlLayerFromFirestore) {
                window.loadKmlLayerFromFirestore(kmlId);
            } else if (!kmlId && window.clearAllKmlLayers) {
                window.clearAllKmlLayers();
            }
        });
    }

    /**
     * 3. Google 登入功能 (v1.9.6 專屬)
     * 對應截圖 image_a1c113.png 的藍色按鈕邏輯
     */
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    if (googleLoginBtn) {
        googleLoginBtn.onclick = async () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            try {
                // 使用 Google 彈出視窗進行驗證
                await window.auth.signInWithPopup(provider);
                console.log("Google 登入成功");
            } catch (error) {
                console.error("登入失敗:", error);
                alert("登入失敗: " + error.message);
            }
        };
    }

    /**
     * 4. Firebase 認證狀態監聽
     * 作用：處理登入後的 UI 切換（顯示管理面板/隱藏登入按鈕）
     */
    if (window.auth) {
        window.auth.onAuthStateChanged(async (user) => {
            const loginSection = document.getElementById('loginSection');
            const loggedInDashboard = document.getElementById('loggedInDashboard');
            const userEmailDisplay = document.getElementById('userEmailDisplay');

            if (user) {
                // 已登入狀態
                if (loginSection) loginSection.style.display = 'none';
                if (loggedInDashboard) loggedInDashboard.style.display = 'block';
                if (userEmailDisplay) userEmailDisplay.textContent = user.email;

                // 登入後自動加載圖層清單
                await window.updateKmlLayerSelects();
            } else {
                // 未登入狀態
                if (loginSection) loginSection.style.display = 'block';
                if (loggedInDashboard) loggedInDashboard.style.display = 'none';
            }
        });
    }

    /**
     * 5. 登出功能
     */
    window.handleLogout = function() {
        if (confirm("確定要登出管理系統嗎？")) {
            window.auth.signOut().then(() => {
                window.location.reload();
            });
        }
    };

})();