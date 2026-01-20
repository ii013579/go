// map-logic.js v1.9.6 完整邏輯版

// 全域變數初始化
let map;
let markers = L.featureGroup();
let geoJsonLayers = L.featureGroup();
window.allKmlFeatures = [];
window.currentKmlLayerId = null;
window.isLoadingKml = false;

document.addEventListener('DOMContentLoaded', () => {
    // 1. 初始化地圖
    map = L.map('map', {
        attributionControl: true,
        zoomControl: false,
        maxZoom: 25,
        minZoom: 5
    }).setView([23.6, 120.9], 8);
    window.map = map;

    // 預設底圖 (Google 街道圖)
    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        attribution: 'Google Maps',
        maxZoom: 25,
        maxNativeZoom: 20
    }).addTo(map);

    // 將圖層容器加入地圖
    geoJsonLayers.addTo(map);
    markers.addTo(map);
});

/**
 * 核心功能：將 GeoJSON 特徵點展現在地圖上
 * @param {Array} features - GeoJSON features 陣列
 */
window.addGeoJsonLayers = function(features) {
    // 清除舊有圖層
    geoJsonLayers.clearLayers();
    markers.clearLayers();

    if (!features || features.length === 0) return;

    L.geoJSON(features, {
        pointToLayer: (feature, latlng) => {
            // 建立自定義紅點圖標 (對應 CSS .custom-dot-icon)
            const dotIcon = L.divIcon({
                className: 'custom-dot-icon',
                iconSize: [5, 5],
                iconAnchor: [5, 5]
            });

            const marker = L.marker(latlng, { icon: dotIcon });

            // 建立文字標籤 (對應 CSS .marker-label span)
            const name = feature.properties.name || "未命名";
            marker.bindTooltip(`<span>${name}</span>`, {
                permanent: true,
                direction: 'right',
                className: 'marker-label',
                offset: [10, 0]
            });

            // 點擊事件邏輯
            marker.on('click', (e) => {
                // 1. 處理 CSS 高亮 (對應 CSS .label-active)
                document.querySelectorAll('.marker-label span').forEach(el => {
                    el.classList.remove('label-active');
                });
                const tooltip = marker.getTooltip().getElement();
                if (tooltip) {
                    tooltip.querySelector('span').classList.add('label-active');
                }

                // 2. 觸發清查功能 (呼叫 survey-logic.js 中的函數)
                if (window.openSurveyPanel) {
                    window.openSurveyPanel(feature, latlng);
                }

                // 3. 視圖自動對焦
                map.setView(latlng, Math.max(map.getZoom(), 16));
                L.DomEvent.stopPropagation(e);
            });

            return marker;
        }
    }).addTo(geoJsonLayers);

    // 自動縮放至所有點的範圍
    const bounds = geoJsonLayers.getBounds();
    if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }
};

/**
 * 從 Firestore 載入指定的 KML 圖層資料
 * @param {string} kmlId - Firestore 中的 document ID
 */
window.loadKmlLayerFromFirestore = async function(kmlId) {
    if (!kmlId || window.isLoadingKml) return;
    
    window.isLoadingKml = true;
    console.log(`正在載入圖層: ${kmlId}`);

    try {
        const docRef = window.db.collection('artifacts').doc(window.appId)
            .collection('public').doc('data')
            .collection('kmlLayers').doc(kmlId);

        const doc = await docRef.get();

        if (!doc.exists) {
            window.showMessage('錯誤', '找不到該圖層資料。');
            window.isLoadingKml = false;
            return;
        }

        const kmlData = doc.data();
        let geojson = kmlData.geojson;
        
        // 若為字串則解析
        if (typeof geojson === 'string') {
            geojson = JSON.parse(geojson);
        }

        // 過濾無效資料
        const validFeatures = (geojson.features || []).filter(f => 
            f.geometry && f.geometry.coordinates && f.properties
        );

        window.allKmlFeatures = validFeatures;
        window.currentKmlLayerId = kmlId;

        // 執行展點
        window.addGeoJsonLayers(validFeatures);

    } catch (error) {
        console.error("載入 KML 失敗:", error);
        window.showMessage('錯誤', '載入圖層時發生異常。');
    } finally {
        window.isLoadingKml = false;
    }
};

/**
 * 全域搜尋定位功能
 * @param {string} targetName - 要尋找的名稱
 */
window.focusOnFeatureByName = function(targetName) {
    geoJsonLayers.eachLayer(layer => {
        layer.eachLayer(marker => {
            if (marker.getTooltip && marker.getTooltip().getContent().includes(targetName)) {
                marker.fire('click'); // 模擬點擊，觸發高亮與清查面板
                map.setView(marker.getLatLng(), 18);
            }
        });
    });
};