/*************************************************
 * kml.js
 * KML / GeoJSON 載入（v1.9.6 等價）
 *************************************************/

const db = window.firebaseDB;

window.kmlState = {
    currentKmlId: null,
    unsubscribe: null
};

/**
 * 載入指定 KML
 */
window.loadKmlById = function (appId, kmlId) {
    // 如果是同一個 KML，不重複載入
    if (kmlState.currentKmlId === kmlId) {
        console.log('[kml] same KML, skip reload');
        return;
    }

    // 取消舊 listener
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

    console.log('[kml] loading:', kmlId);

    // 單一 onSnapshot（關鍵）
    kmlState.unsubscribe = ref.onSnapshot((snap) => {
        if (!snap.exists) {
            console.warn('[kml] KML not found:', kmlId);
            return;
        }

        const data = snap.data();
        if (!data || !data.geojsonContent) {
            console.warn('[kml] invalid geojson');
            return;
        }

        // 通知 map 繪製
        document.dispatchEvent(
            new CustomEvent('kml-loaded', {
                detail: {
                    kmlId,
                    geojson: data.geojsonContent
                }
            })
        );
    });
};
