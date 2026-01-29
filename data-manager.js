//(KML 與 Firestore 資料模組)
// data-manager.js v2.0 
(function () {
    'use strict';
    const $ = id => document.getElementById(id);

    window.DataManager = {
        isLoading: false,
        allFeatures: [],

        fetchKmlList: async function() {
            if (!window.db) return;
            try {
                const snapshot = await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').get();
                const select = $('kmlLayerSelect');
                const selectDash = $('kmlLayerSelectDashboard');
                if (!select) return;

                select.innerHTML = '<option value="">-- 請選擇 KML --</option>';
                snapshot.forEach(doc => {
                    const opt = new Option(doc.data().name, doc.id);
                    select.add(opt);
                    if (selectDash) selectDash.add(opt.cloneNode(true));
                });
                
                // 檢查釘選
                const pinnedId = localStorage.getItem('pinnedKmlId');
                if (pinnedId) {
                    select.value = pinnedId;
                    this.loadKml(pinnedId);
                }
            } catch (e) { console.error("清單讀取失敗", e); }
        },

        loadKml: async function (kmlId) {
            if (this.isLoading || !kmlId) return;
            this.isLoading = true;
            try {
                const doc = await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').doc(kmlId).get();
                if (!doc.exists) return;
                const data = doc.data();
                const geojson = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson;
                this.allFeatures = geojson.features.filter(f => f.geometry);
                window.addGeoJsonLayers(this.allFeatures);
            } catch (e) { window.showMessage('載入失敗', e.message); }
            finally { this.isLoading = false; }
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        $('kmlLayerSelect')?.addEventListener('change', (e) => window.DataManager.loadKml(e.target.value));
        $('pinButton')?.addEventListener('click', () => {
            const id = $('kmlLayerSelect').value;
            if (id) {
                localStorage.setItem('pinnedKmlId', id);
                window.showMessage('成功', '已釘選圖層');
            }
        });
    });
})();