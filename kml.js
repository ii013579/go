// kml.js
// KML 載入 + inspectionStatus listener（改寫自 map-logic.js 的 loadKmlLayerFromFirestore 部分）

(function () {
  'use strict';

  if (typeof db === 'undefined' || typeof appId === 'undefined') {
    // appId 在原專案中是全域常數，若不存在請在 index.html 或其它初始化檔設定 window.appId
    console.warn('kml.js: db 或 appId 未定義，請確認 firebase 與 appId 已初始化。');
  }

  // 全域鎖（避免重複載入）
  const state = {
    isLoadingKml: false,
    currentKmlLayerId: null,
    allKmlFeatures: []
  };

  // 將 GeoJSON features 加到地圖的 API（由 map.js 提供），保持相容
  window.loadKmlLayerFromFirestore = async function (kmlId) {
    if (state.isLoadingKml) {
      console.info('已有 KML 載入程序，略過本次呼叫。');
      return;
    }
    state.isLoadingKml = true;

    try {
      if (!kmlId) {
        console.info('未提供 KML ID，不載入。');
        if (typeof window.clearAllKmlLayers === 'function') window.clearAllKmlLayers();
        state.isLoadingKml = false;
        return;
      }

      if (state.currentKmlLayerId === kmlId) {
        console.info(`已載入圖層 ${kmlId}，略過重複讀取`);
        state.isLoadingKml = false;
        return;
      }

      if (typeof db === 'undefined' || typeof appId === 'undefined') {
        throw new Error('Firestore 或 appId 未定義，無法讀取 KML。');
      }

      // 取得 KML doc（路徑依 repo 原設計）
      const docRef = db.collection('artifacts').doc(appId)
        .collection('public').doc('data').collection('kmlLayers')
        .doc(kmlId);

      const doc = await docRef.get();
      if (!doc.exists) {
        window.showMessageCustom?.({ title: '錯誤', message: '找不到指定的 KML 圖層資料。', buttonText: '確定' });
        return;
      }

      let kmlData = doc.data();
      let geojson = kmlData.geojson;

      if (typeof geojson === 'string') {
        geojson = JSON.parse(geojson);
      }

      const loadedFeatures = (geojson?.features || []).filter(f => f && f.geometry && f.properties);
      state.allKmlFeatures = loadedFeatures;
      state.currentKmlLayerId = kmlId;
      window.allKmlFeatures = loadedFeatures;

      // 呼叫 map.js 的 addGeoJsonLayers（保持向後相容）
      if (typeof window.addGeoJsonLayers === 'function') {
        window.addGeoJsonLayers(loadedFeatures);
      } else {
        console.warn('找不到 addGeoJsonLayers，無法將 GeoJSON 加到地圖。');
      }
    } catch (err) {
      console.error('載入 KML 圖層失敗：', err);
      window.showMessageCustom?.({ title: '錯誤', message: `無法載入 KML 圖層: ${err && err.message ? err.message : err}`, buttonText: '確定' });
    } finally {
      state.isLoadingKml = false;
    }
  };

  // 監聽某個 KML 的 inspectionStatus（示意用），callback signature: (statusDoc) => {}
  window.listenToInspectionStatus = function (kmlId, callback) {
    if (typeof db === 'undefined' || !kmlId) return () => {};
    const statusRef = db.collection('artifacts').doc(appId)
      .collection('public').doc('data').collection('kmlLayers')
      .doc(kmlId).collection('meta').doc('inspectionStatus'); // 假設有此路徑
    const unsub = statusRef.onSnapshot((doc) => {
      callback && callback(doc.exists ? doc.data() : null, doc);
    }, (err) => {
      console.error('listenToInspectionStatus 錯誤：', err);
    });
    return unsub;
  };
})();