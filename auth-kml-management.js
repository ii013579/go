// auth-kml-management.js v1.9.6 完整邏輯版

(function() {
    /**
     * 1. 全域更新下拉選單
     * 作用：從 Firestore 讀取所有 KML 圖層清單，並同時更新「首頁選單」與「管理後台選單」
     */
    window.updateKmlLayerSelects = async function() {
        console.log("正在同步 KML 圖層選單...");
        try {
            const snap = await window.db.collection('artifacts').doc(window.appId)
                .collection('public').doc('data')
                .collection('kmlLayers').orderBy('uploadTime', 'desc').get();
            
            let optionsHtml = '<option value="">-- 請選擇 KML 圖層 --</option>';
            
            snap.forEach(doc => {
                const data = doc.data();
                optionsHtml += `<option value="${doc.id}">${data.name || '未命名圖層'}</option>`;
            });

            // 同時更新兩個位置的下拉選單 (對應 style.css 中的輸入框樣式)
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
     * 作用：當使用者在首頁選擇圖層時，立刻觸發地圖展點
     */
    const mainSelect = document.getElementById('kmlLayerSelect');
    if (mainSelect) {
        mainSelect.addEventListener('change', (e) => {
            const kmlId = e.target.value;
            if (kmlId && window.loadKmlLayerFromFirestore) {
                window.loadKmlLayerFromFirestore(kmlId);
            } else if (!kmlId && window.addGeoJsonLayers) {
                // 若選回預設，則清空地圖
                window.addGeoJsonLayers([]);
                window.allKmlFeatures = [];
                window.currentKmlLayerId = null;
            }
        });
    }

    /**
     * 3. Firebase 認證狀態監聽
     * 作用：處理使用者登入後的 UI 變化，如顯示 Email、載入權限資料等
     */
    if (window.auth) {
        window.auth.onAuthStateChanged(async (user) => {
            const userEmailDisplay = document.getElementById('userEmailDisplay');
            const loginForm = document.getElementById('loginForm');
            const loggedInDashboard = document.getElementById('loggedInDashboard');

            if (user) {
                console.log("使用者已登入:", user.email);
                
                // 1. 更新 Email 顯示 (對應 CSS #userEmailDisplay)
                if (userEmailDisplay) userEmailDisplay.textContent = user.email;

                // 2. 切換 UI 面板 (對應 CSS 佈局)
                if (loginForm) loginForm.style.display = 'none';
                if (loggedInDashboard) loggedInDashboard.style.display = 'block';

                // 3. 登入後執行初始化更新
                await window.updateKmlLayerSelects();
                
                // 4. (選配) 如果有使用者管理功能，可在此載入使用者列表
                if (window.loadUserList) window.loadUserList();

            } else {
                console.log("使用者未登入");
                if (loginForm) loginForm.style.display = 'block';
                if (loggedInDashboard) loggedInDashboard.style.display = 'none';
                if (userEmailDisplay) userEmailDisplay.textContent = "未登入";
            }
        });
    }

    /**
     * 4. 登出功能
     */
    window.handleLogout = function() {
        if (confirm("確定要登出嗎？")) {
            window.auth.signOut().then(() => {
                window.location.reload(); // 登出後重新整理確保安全性
            });
        }
    };

})();