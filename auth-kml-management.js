// auth-kml-management.js
(function() {
    window.updateKmlLayerSelects = async function() {
        const snap = await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').get();
        let options = '<option value="">-- 請選擇圖層 --</option>';
        snap.forEach(doc => {
            options += `<option value="${doc.id}">${doc.data().name}</option>`;
        });

        const s1 = document.getElementById('kmlLayerSelect');
        const s2 = document.getElementById('kmlLayerSelectDashboard');
        if (s1) s1.innerHTML = options;
        if (s2) s2.innerHTML = options;
    };

    // 監聽首頁選單切換
    document.getElementById('kmlLayerSelect')?.addEventListener('change', (e) => {
        window.loadKmlLayerFromFirestore(e.target.value);
    });

    window.auth.onAuthStateChanged((user) => {
        if (user) {
            window.updateKmlLayerSelects();
            document.getElementById('userEmailDisplay').textContent = user.email;
        }
    });
})();