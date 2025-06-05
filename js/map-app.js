// 注意：以下是 map-app.js 的內容，其中假設 `db`, `showMessage`
// 已經在 `firebase-init.js` 中定義並可全局訪問。
// 在實際的模組化開發中，您會使用 ES Modules (import/export) 來明確依賴關係。

let map;
let currentKmlLayer = null; // 用於儲存當前載入的 KML 圖層
let markers = L.featureGroup(); // 用於儲存所有標記以便管理
let navButtons = L.featureGroup(); // 用於儲存導航按鈕

document.addEventListener('DOMContentLoaded', () => {
    // 初始化地圖
    map = L.map('map').setView([23.6, 120.9], 8); // 台灣中心經緯度

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // 添加定位控制項
    L.control.locate({
        position: 'topleft',
        strings: {
            title: "顯示我的位置"
        },
        locateOptions: {
            enableHighAccuracy: true,
            maxZoom: 16 // 定位後縮放級別
        },
        markerStyle: {
            className: 'user-location-dot' // 自定義用戶位置標記樣式
        },
        circleStyle: {
            color: '#1a73e8', // 藍色圈
            fillColor: '#1a73e8',
            fillOpacity: 0.15
        },
        // 添加自定義按鈕類別
        icon: 'material-symbols-outlined',
        iconLoading: 'material-symbols-outlined'
    }).addTo(map);

    // 將 markers 和 navButtons 添加到地圖
    markers.addTo(map);
    navButtons.addTo(map);

    // 全局函數：載入 KML 圖層
    window.loadKmlLayerFromFirestore = async function(kmlId) {
        if (!kmlId) {
            console.log("未提供 KML ID，不載入。");
            clearAllKmlLayers();
            return;
        }

        // 移除現有 KML 圖層和所有標記
        clearAllKmlLayers();

        try {
            // 從 Firestore 獲取 KML 文件的 URL
            const doc = await db.collection('kml').doc(kmlId).get();
            if (!doc.exists) {
                showMessage('錯誤', '找不到指定的 KML 圖層資料。');
                return;
            }
            const kmlData = doc.data();
            const kmlUrl = kmlData.url;

            console.log(`載入 KML: ${kmlUrl}`);
            showMessage('載入中', '正在載入 KML 圖層，請稍候...');

            // 使用 Leaflet Omnivore 載入 KML
            currentKmlLayer = omnivore.kml(kmlUrl)
                .on('ready', function() {
                    map.fitBounds(this.getBounds()); // 縮放地圖以適應 KML 圖層
                    this.eachLayer(function(layer) {
                        // 為每個圖層創建標記和導航按鈕
                        if (layer.feature && layer.feature.geometry.type === 'Point') {
                            const name = layer.feature.properties.name || '未知地點';
                            createMarkerWithLabel(layer.getLatLng(), name);
                            createNavButton(layer.getLatLng(), name);
                        }
                    });
                    showMessage('成功', `KML 圖層 "${kmlData.name}" 載入完成！`);
                })
                .on('error', function(error) {
                    console.error("載入 KML 時出錯:", error);
                    showMessage('錯誤', `載入 KML 失敗: ${error.message}`);
                })
                .addTo(map);

        } catch (error) {
            console.error("獲取 KML URL 或載入 KML 時出錯:", error);
            showMessage('錯誤', `無法載入 KML 圖層: ${error.message}`);
        }
    };

    // 全局函數：清除所有 KML 圖層、標記和導航按鈕
    window.clearAllKmlLayers = function() {
        if (currentKmlLayer) {
            map.removeLayer(currentKmlLayer);
            currentKmlLayer = null;
        }
        markers.clearLayers(); // 清除所有標記
        navButtons.clearLayers(); // 清除所有導航按鈕
        console.log("所有 KML 圖層、標記和導航按鈕已清除。");
    };

    // 全局函數：創建帶有標籤的標記
    window.createMarkerWithLabel = function(latlng, labelText) {
        const customIcon = L.divIcon({
            className: 'custom-dot-icon', // 使用自定義圓點樣式
            iconSize: [18, 18],
            iconAnchor: [9, 9]
        });

        const marker = L.marker(latlng, { icon: customIcon }).addTo(markers); // 添加到 markers FeatureGroup
        marker.bindTooltip(labelText, {
            permanent: true,
            direction: 'bottom',
            className: 'marker-label', // 使用自定義標籤樣式
            offset: [0, 10]
        }).openTooltip();
        return marker;
    };

    // 全局函數：創建導航按鈕
    window.createNavButton = function(latlng, name) {
        // 創建一個自定義圖標，其中包含圖片
        const navIcon = L.divIcon({
            className: 'nav-button-icon', // 容器樣式
            html: `<div class="nav-button-content"><img src="image_ac684c.jpg" alt="導航" title="導航到 ${name}"></div>`,
            iconSize: [48, 48], // 圖標大小
            iconAnchor: [24, 24] // 圖標中心點
        });

        const navMarker = L.marker(latlng, { icon: navIcon }).addTo(navButtons); // 添加到 navButtons FeatureGroup

        // 為導航按鈕添加點擊事件
        navMarker.on('click', () => {
            const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latlng.lat},${latlng.lng}`;
            window.open(googleMapsUrl, '_blank');
        });
        return navMarker;
    };

    // 處理地圖上的點擊事件，隱藏搜尋結果
    map.on('click', () => {
        const searchResults = document.getElementById('searchResults');
        if (searchResults) {
            searchResults.style.display = 'none';
        }
        const searchBox = document.getElementById('searchBox');
        if (searchBox) {
            searchBox.value = '';
        }
    });

    // 初始化時載入預設 KML 或第一層 KML (如果有的話)
    // 這部分邏輯會由 auth.js 中的 updateKmlLayerSelects 觸發
});