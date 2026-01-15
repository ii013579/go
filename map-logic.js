// map-logic.js (對齊 Leaflet & MarkerCluster)

// 1. 初始化全域狀態
window.currentKmlLayerId = null;
window.allKmlFeatures = [];
window.isLoadingKml = false;

// 2. 初始化地圖 (對齊 HTML 中的 <div id="map">)
const map = L.map('map').setView([23.6, 121.0], 7);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
window.map = map;

// 3. 初始化 MarkerCluster (對齊 HTML 引入的 markercluster.js)
let markerClusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    disableClusteringAtZoom: 16 // 放大到 16 級後展開所有圖釘
});
map.addLayer(markerClusterGroup);

/**
 * 核心功能：從 Firestore 載入資料 (只讀一次快取機制)
 */
window.loadKmlLayerFromFirestore = async function(kmlId) {
    // 【快取鎖定】：若已載入相同 ID 且非空，則不動作
    if (window.currentKmlLayerId === kmlId && kmlId !== "") {
        console.log("♻️ 使用快取資料，不重複讀取 Firebase");
        return;
    }

    if (window.isLoadingKml) return;

    // 若選擇空白項，則清空地圖
    if (!kmlId) {
        markerClusterGroup.clearLayers();
        window.currentKmlLayerId = null;
        window.allKmlFeatures = [];
        return;
    }

    window.isLoadingKml = true;
    console.log(`📡 正在讀取圖層: ${kmlId}`);

    try {
        // 對齊 Firebase 規則路徑：artifacts/{appId}/public/data/kmlLayers/{id}
        const docRef = window.db.collection('artifacts')
            .doc(window.appId).collection('public')
            .doc('data').collection('kmlLayers')
            .doc(kmlId);

        const doc = await docRef.get();

        if (!doc.exists) {
            throw new Error("找不到該圖層資料，請檢查路徑。");
        }

        const data = doc.data();
        // 處理整包 JSON 格式
        let geojson = (typeof data.geojson === 'string') ? JSON.parse(data.geojson) : data.geojson;

        if (!geojson || !geojson.features) {
            throw new Error("GeoJSON 格式不正確");
        }

        // 清空現有圖層
        markerClusterGroup.clearLayers();
        window.allKmlFeatures = geojson.features;

        // 4. 繪製圖釘
        window.allKmlFeatures.forEach(feature => {
            if (feature.geometry && feature.geometry.type === 'Point') {
                const [lon, lat] = feature.geometry.coordinates;
                const name = feature.properties.name || "未命名點位";

                // 建立自定義標籤 (對齊您的 marker-label 樣式)
                const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');
                const customIcon = L.divIcon({
                    className: 'marker-label',
                    html: `<span id="${labelId}">${name}</span>`,
                    iconSize: [100, 20],
                    iconAnchor: [50, 10]
                });

                const marker = L.marker([lat, lon], { icon: customIcon });

                // 點擊圖釘連動 survey-logic.js
                marker.on('click', () => {
                    if (window.createNavButton) {
                        window.createNavButton(L.latLng(lat, lon), name);
                    }
                });

                markerClusterGroup.addLayer(marker);
            }
        });

        // 自動縮放至資料範圍
        if (markerClusterGroup.getLayers().length > 0) {
            map.fitBounds(markerClusterGroup.getBounds(), { padding: [50, 50] });
        }

        // 更新快取狀態
        window.currentKmlLayerId = kmlId;
        console.log(`✅ 成功載入 ${window.allKmlFeatures.length} 個點位`);

    } catch (error) {
        console.error("❌ 載入失敗:", error);
        window.showMessage("資料讀取失敗", error.message);
    } finally {
        window.isLoadingKml = false;
    }
};

// 監聽下拉選單 (對齊 HTML ID: kmlLayerSelect)
document.addEventListener('DOMContentLoaded', () => {
    const selectEl = document.getElementById('kmlLayerSelect');
    if (selectEl) {
        selectEl.addEventListener('change', (e) => {
            window.loadKmlLayerFromFirestore(e.target.value);
        });
    }
});