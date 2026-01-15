// auth-kml-management.js v2.0.0 (修復版)
(function() {
    // 更新所有下拉選單
    window.updateKmlLayerSelects = async function() {
        const snap = await window.db.collection('artifacts').doc(window.appId)
            .collection('public').doc('data').collection('kmlLayers').get();
        
        let html = '<option value="">-- 請選擇圖層 --</option>';
        snap.forEach(doc => {
            html += `<option value="${doc.id}">${doc.data().name}</option>`;
        });

        const mainSelect = document.getElementById('kmlLayerSelect');
        const dashSelect = document.getElementById('kmlLayerSelectDashboard');
        
        if (mainSelect) mainSelect.innerHTML = html;
        if (dashSelect) dashSelect.innerHTML = html;
    };

    // 監聽選單切換 (首頁)
    document.getElementById('kmlLayerSelect')?.addEventListener('change', (e) => {
        if (window.loadKmlLayerFromFirestore) {
            window.loadKmlLayerFromFirestore(e.target.value);
        }
    });

    // 初始載入
    window.auth.onAuthStateChanged((user) => {
        if (user) {
            window.updateKmlLayerSelects();
        }
    });
})();