//(資料讀取中心)
// data-manager.js v2.0
(function () {
    'use strict';
    const $ = id => document.getElementById(id);

    window.DataManager = {
        isLoading: false,
        allFeatures: [],
        currentKmlId: null,

        // 讀取 KML 清單並填充下拉選單
        fetchKmlList: async function() {
            if (!window.db || !window.appId) {
                console.error("DataManager: db 或 appId 未定義");
                return;
            }
            try {
                // 指向您的 Firestore 路徑
                const snapshot = await window.db.collection('artifacts').doc(window.appId)
                                         .collection('public').doc('data')
                                         .collection('kmlLayers').get();
                
                const select = $('kmlLayerSelect');
                const selectDash = $('kmlLayerSelectDashboard');
                if (!select) return;

                select.innerHTML = '<option value="">-- 請選擇 KML --</option>';
                if (selectDash) selectDash.innerHTML = '<option value="">-- 請選擇 KML --</option>';

                snapshot.forEach(doc => {
                    const data = doc.data();
                    const opt = new Option(data.name || doc.id, doc.id);
                    select.add(opt);
                    if (selectDash) selectDash.add(opt.cloneNode(true));
                });

                // 檢查是否有釘選的 ID
                const pinnedId = localStorage.getItem('pinnedKmlId');
                if (pinnedId) {
                    select.value = pinnedId;
                    this.loadKml(pinnedId);
                }
            } catch (e) {
                console.error("Firestore 讀取失敗:", e);
            }
        },

        // 讀取具體 KML 內容
        loadKml: async function(kmlId) {
            if (this.isLoading || !kmlId || this.currentKmlId === kmlId) return;
            this.isLoading = true;
            try {
                const doc = await window.db.collection('artifacts').doc(window.appId)
                                     .collection('public').doc('data')
                                     .collection('kmlLayers').doc(kmlId).get();
                if (doc.exists) {
                    const data = doc.data();
                    const geojson = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson;
                    this.allFeatures = (geojson.features || []).filter(f => f.geometry);
                    this.currentKmlId = kmlId;
                    
                    // 呼叫渲染器畫圖
                    if (window.addGeoJsonLayers) window.addGeoJsonLayers(this.allFeatures);
                }
            } catch (e) {
                if (window.showMessage) window.showMessage('錯誤', '載入圖層失敗: ' + e.message);
            } finally {
                this.isLoading = false;
            }
        }
    };

    // 綁定下拉選單事件
    document.addEventListener('DOMContentLoaded', () => {
        $('kmlLayerSelect')?.addEventListener('change', (e) => window.DataManager.loadKml(e.target.value));
    });
})();