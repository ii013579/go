// map-logic.js v2.0.0
// 職責：指揮官/畫家 (解析資料、地圖渲染、執行只讀一次快取邏輯)

// --- 全域變數定義 ---
window.isLoadingKml = false;      // 全域鎖定：避免重複讀取
window.currentKmlLayerId = null;  // 紀錄當前地圖上的圖層 ID (快取核心)
window.allKmlFeatures = [];       // 存放目前所有特徵 (供 ui-interactions.js 搜尋使用)

// Leaflet 相關全域容器
let geoJsonLayers = L.layerGroup();
let markers = L.layerGroup();

/**
 * 1. 核心功能：從 Firestore 載入 KML (GeoJSON 格式)
 * 實作「只讀取一次」與「快取鎖定」
 */
window.loadKmlLayerFromFirestore = async function(kmlId) {
    // 🔒【鎖定機制 A：避免重複讀取同一圖層】
    if (window.currentKmlLayerId === kmlId && kmlId !== null) {
        console.log(`♻️ 快取提示：圖層 ${kmlId} 已在地圖上，跳過讀取。`);
        return;
    }

    // 🔒【鎖定機制 B：避免連點導致的並行請求】
    if (window.isLoadingKml) {
        console.log("⏳ 讀取中，請稍候...");
        return;
    }

    if (!kmlId) {
        console.log("🧹 清空地圖圖層");
        window.clearAllKmlLayers();
        window.currentKmlLayerId = null;
        return;
    }

    window.isLoadingKml = true;
    
    // 顯示載入提示
    if (window.showMessageCustom) {
        window.showMessageCustom({ title: '載入中', message: '正在從資料庫提取地理資訊...', autoClose: true, autoCloseDelay: 1000 });
    }

    try {
        console.log(`📡 開始從 Firestore 搬運資料 (ID: ${kmlId})...`);
        
        // 指向 artifacts/{appId}/public/data/kmlLayers/{kmlId}
        const docRef = window.db.collection('artifacts')
            .doc(window.appId).collection('public')
            .doc('data').collection('kmlLayers')
            .doc(kmlId);

        const doc = await docRef.get();

        if (!doc.exists) {
            throw new Error('找不到該圖層的文件資料');
        }

        const kmlData = doc.data();
        let geojson = kmlData.geojson;

        // ⭐【整包儲存解析】：若是字串則轉回物件
        if (typeof geojson === 'string') {
            geojson = JSON.parse(geojson);
        }

        // 過濾無效資料
        const loadedFeatures = (geojson.features || []).filter(f =>
            f.geometry && f.geometry.coordinates
        );

        // 更新全域狀態供搜尋與快取比對
        window.allKmlFeatures = loadedFeatures;
        window.currentKmlLayerId = kmlId;

        // 畫布操作：清空舊的，畫上新的
        window.clearAllKmlLayers();
        window.addGeoJsonLayers(loadedFeatures);

        // 自動縮放地圖至資料範圍 (FitBounds)
        const allLayers = L.featureGroup([geoJsonLayers, markers]);
        const bounds = allLayers.getBounds();
        if (bounds && bounds.isValid()) {
            map.fitBounds(bounds, { padding: L.point(50, 50) });
        }

        console.log(`✅ 圖層載入成功：共 ${loadedFeatures.length} 個點位`);

    } catch (error) {
        console.error("❌ 載入失敗:", error);
        window.showMessage('錯誤', `無法載入圖層資料：${error.message}`);
    } finally {
        window.isLoadingKml = false;
        // 隱藏載入提示
        if (window.hideMessage) window.hideMessage();
    }
};

/**
 * 2. 清除地圖上所有 KML 相關圖層
 */
window.clearAllKmlLayers = function() {
    if (geoJsonLayers) geoJsonLayers.clearLayers();
    if (markers) markers.clearLayers();
    if (window.map) {
        window.map.removeLayer(geoJsonLayers);
        window.map.removeLayer(markers);
    }
    // 重設搜尋資料
    window.allKmlFeatures = [];
};

/**
 * 3. 畫布渲染：將 GeoJSON Features 繪製到 Leaflet
 */
window.addGeoJsonLayers = function(features) {
    if (!window.map) return;

    features.forEach(feature => {
        const [lon, lat] = feature.geometry.coordinates;
        const name = feature.properties.name || "未命名";

        // 建立標籤
        const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');
        const customIcon = L.divIcon({
            className: 'marker-label',
            html: `<span id="${labelId}">${name}</span>`,
            iconSize: [100, 20],
            iconAnchor: [50, 10]
        });

        const marker = L.marker([lat, lon], { icon: customIcon });
        
        // 點擊 Marker 自動顯示導航按鈕 (與 ui-interactions 聯動)
        marker.on('click', () => {
            if (window.createNavButton) {
                window.createNavButton(L.latLng(lat, lon), name);
            }
        });

        markers.addLayer(marker);
    });

    geoJsonLayers.addTo(window.map);
    markers.addTo(window.map);
};

/**
 * 4. 監聽選單切換事件 (與 kml-worker 產生的選單對接)
 */
document.addEventListener('DOMContentLoaded', () => {
    const kmlLayerSelect = document.getElementById('kmlLayerSelect');
    if (kmlLayerSelect) {
        kmlLayerSelect.addEventListener('change', (e) => {
            window.loadKmlLayerFromFirestore(e.target.value);
        });
    }
});