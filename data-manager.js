// data-manager.js v2.0 (KML 與 Firestore 資料模組)
(function () {
    'use strict';
    const $ = id => document.getElementById(id);

    const els = {
        select: $('kmlLayerSelect'),
        pinBtn: $('pinButton'),
        uploadSec: $('uploadKmlSectionDashboard')
    };

    window.DataManager = {
        isLoading: false,
        allFeatures: [],

        loadKml: async function (kmlId) {
            if (this.isLoading) return;
            this.isLoading = true;
            try {
                const doc = await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers').doc(kmlId).get();
                if (!doc.exists) return;
                
                const data = doc.data();
                const geojson = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson;
                this.allFeatures = geojson.features.filter(f => f.geometry);
                
                window.addGeoJsonLayers(this.allFeatures);
            } catch (e) {
                console.error("KML 載入失敗", e);
            } finally {
                this.isLoading = false;
            }
        },

        handlePin: function() {
            if (!els.select) return;
            const id = els.select.value;
            const current = localStorage.getItem('pinnedKmlId');
            if (current === id) {
                localStorage.removeItem('pinnedKmlId');
                alert('已取消釘選');
            } else {
                localStorage.setItem('pinnedKmlId', id);
                alert('已成功釘選');
            }
        }
    };

    if (els.pinBtn) els.pinBtn.onclick = () => window.DataManager.handlePin();
    window.loadKmlLayerFromFirestore = (id) => window.DataManager.loadKml(id);
})();