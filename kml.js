/*************************************************
 * kml.js (v2.0, compatible with v1.9.6)
 * 注意：不宣告 db
 *************************************************/

window.kmlState = {
    currentKmlId: null,
    unsubscribe: null
};

/**
 * 新核心 API
 */
window.loadKmlById = function (appId, kmlId) {
    if (!appId || !kmlId) return;

    if (kmlState.currentKmlId === kmlId) return;

    // 移除舊 listener，避免重複讀取
    if (typeof kmlState.unsubscribe === 'function') {
        kmlState.unsubscribe();
        kmlState.unsubscribe = null;
    }

    kmlState.currentKmlId = kmlId;

    const ref = db
        .collection('artifacts')
        .doc(appId)
        .collection('public')
        .doc('data')
        .collection('kmlLayers')
        .doc(kmlId);

    kmlState.unsubscribe = ref.onSnapshot((snap) => {
        if (!snap.exists) return;

        const data = snap.data();
        if (!data || !data.geojsonContent) return;

        document.dispatchEvent(
            new CustomEvent('kml-loaded', {
                detail: data.geojsonContent
            })
        );
    });
};

/**
 * v1.9.6 UI 仍會呼叫的函數
 */
window.loadKmlLayer = function (kmlId) {
    if (!window.APP_ID) {
        console.error('APP_ID not defined');
        return;
    }
    loadKmlById(window.APP_ID, kmlId);
};
