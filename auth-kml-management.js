// auth-kml-management.js
(function() {
    window.updateKmlLayerSelects = async function() {
        try {
            const snap = await window.db.collection('artifacts').doc(window.appId)
                .collection('public').doc('data').collection('kmlLayers').get();
            
            let html = '<option value="">-- 請選擇圖層 --</option>';
            snap.forEach(doc => {
                html += `<option value="${doc.id}">${doc.data().name}</option>`;
            });

            const s1 = document.getElementById('kmlLayerSelect');
            const s2 = document.getElementById('kmlLayerSelectDashboard');
            if (s1) s1.innerHTML = html;
            if (s2) s2.innerHTML = html;
        } catch (err) {
            console.error("更新選單失敗:", err);
        }
    };

    // 監聽首頁選單變動
    document.getElementById('kmlLayerSelect')?.addEventListener('change', (e) => {
        if (window.loadKmlLayerFromFirestore) {
            window.loadKmlLayerFromFirestore(e.target.value);
        }
    });

    // 初始化與狀態監聽
    window.auth.onAuthStateChanged((user) => {
        if (user) {
            window.updateKmlLayerSelects();
            const emailDisp = document.getElementById('userEmailDisplay');
            if (emailDisp) emailDisp.textContent = user.email;
        }
    });
})();