/*************************************************
 * kml.js（v1.9.6 相容修正版）
 *************************************************/

const db = window.firebaseDB;

window.kmlState = {
    currentKmlId: null,
    unsubscribe: null
};

// === 新核心 ===
window.loadKmlById = function (appId, kmlId) {
    if (kmlState.currentKmlId === kmlId) return;

    if (typeof kmlState.unsubscribe === 'function') {
        kmlState.unsubscribe();
    }

    kmlState.currentKmlId = kmlId;

    const ref = db
        .collection('artifacts')
        .doc(appId)
        .collection('public')
        .doc('data')
        .collection('kmlLayers')
        .doc(kmlId);

    kmlState.unsubscribe = ref.onSnapshot(snap => {
        if (!snap.exists) return;
        const data = snap.data();
        if (!data.geojsonContent) return;

        document.dispatchEvent(
            new CustomEvent('kml-loaded', {
                detail: data.geojsonContent
            })
        );
    });
};

// === v1.9.6 bridge（非常重要） ===
// 舊 UI 其實是呼叫這個
window.loadKmlLayer = function (kmlId) {
    if (!window.APP_ID) {
        console.error('APP_ID not defined');
        return;
    }
    loadKmlById(window.APP_ID, kmlId);
};
