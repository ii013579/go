// map-logic.js

let map;
// 用於儲存所有 KML 標記、線條、多邊形以便管理
let markerLabelsGroup = L.featureGroup();
// 用於儲存導航按鈕
let navButtonsGroup = L.featureGroup();

// 新增一個全局變數，用於儲存所有地圖上 KML Point Features 的數據，供搜尋使用
// 注意：此變數的填充將由 auth-kml-management.js 完成
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    // 初始化地圖
    map = L.map('map', { zoomControl: false }).setView([23.6, 120.9], 8); // 台灣中心經緯度，禁用預設縮放控制

    // 將 markerLabelsGroup 和 navButtonsGroup 添加到地圖
    // 注意：這裡將 Group 添加到地圖，而不是直接將單個圖層添加到地圖
    markerLabelsGroup.addTo(map);
    navButtonsGroup.addTo(map);

    // 定義基本圖層
    const baseLayers = {
        'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
            attribution: 'Google Maps'
        }),
        'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
            attribution: 'Google Maps'
        }),
        'Google 地形圖': L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
            attribution: 'Google Maps'
        }),
        'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        })
    };

    // 預設將 'Google 街道圖' 添加到地圖
    baseLayers['Google 街道圖'].addTo(map);

    // 將縮放控制添加到地圖的右上角
    L.control.zoom({
        position: 'topright' // 從 'topleft' 改為 'topright'
    }).addTo(map);

    // 自定義定位控制項
    const LocateMeControl = L.Control.extend({
        _userLocationMarker: null,
        _userLocationCircle: null,

        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-locate-me');
            const button = L.DomUtil.create('a', '', container);
            button.href = "#";
            button.title = "顯示我的位置";
            button.setAttribute("role", "button");
            button.setAttribute("aria-label", "顯示我的位置");
            button.innerHTML = `<span class="material-symbols-outlined" style="font-size: 24px; line-height: 30px;">my_location</span>`;

            L.DomEvent.on(button, 'click', this._locateUser, this);

            // 為地理定位成功/失敗事件添加監聽器
            map.on('locationfound', this._onLocationFound, this);
            map.on('locationerror', this._onLocationError, this);

            return container;
        },

        onRemove: function(map) {
            map.off('locationfound', this._onLocationFound, this);
            map.off('locationerror', this._onLocationError, this);
            this._clearLocationMarkers();
        },

        _locateUser: function(e) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);

            this._clearLocationMarkers();

            // 開始定位用戶位置
            map.locate({
                setView: true,
                maxZoom: 16,
                enableHighAccuracy: true,
                watch: false
            });
            window.showMessage('定位中', '正在獲取您的位置...');
        },

        _onLocationFound: function(e) {
            this._clearLocationMarkers();

            const radius = e.accuracy / 2;

            this._userLocationMarker = L.marker(e.latlng, {
                icon: L.divIcon({
                    className: 'user-location-dot',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                })
            }).addTo(map);

            this._userLocationCircle = L.circle(e.latlng, radius, {
                color: '#1a73e8',
                fillColor: '#1a73e8',
                fillOpacity: 0.15,
                weight: 2
            }).addTo(map);

            window.showMessage('定位成功', `您的位置已定位，誤差約 ${radius.toFixed(0)} 公尺。`);
        },

        _onLocationError: function(e) {
            this._clearLocationMarkers();
            window.showMessage('定位失敗', `無法獲取您的位置: ${e.message}`);
            console.error('Geolocation error:', e.message);
        },

        _clearLocationMarkers: function() {
            if (this._userLocationMarker) {
                map.removeLayer(this._userLocationMarker);
                this._userLocationMarker = null;
            }
            if (this._userLocationCircle) {
                map.removeLayer(this._userLocationCircle);
                this._userLocationCircle = null;
            }
        }
    });

    // 將自定義定位控制項添加到地圖的右上角
    new LocateMeControl({ position: 'topright' }).addTo(map); // 從 'topleft' 改為 'topright'

    // 將基本圖層控制添加到地圖的右上角 (放置在定位按鈕下方)
    L.control.layers(baseLayers, null, {
        position: 'topright' // 從 'topleft' 改為 'topright'
    }).addTo(map);

    // 處理地圖點擊事件，隱藏搜尋結果和導航按鈕
    map.on('click', () => {
        const searchResults = document.getElementById('searchResults');
        const searchContainer = document.getElementById('searchContainer'); // 獲取搜尋容器
        if (searchResults) {
            searchResults.style.display = 'none';
            searchContainer.classList.remove('search-active'); // 移除活躍狀態類別
        }
        const searchBox = document.getElementById('searchBox');
        if (searchBox) {
            searchBox.value = '';
        }
        navButtonsGroup.clearLayers(); // 清除導航按鈕
        console.log("地圖點擊事件：隱藏搜尋結果和導航按鈕。");
    });
});

/**
 * 清除地圖上所有 KML 相關的圖層和數據。
 * 這個函數會在 auth-kml-management.js 中被調用。
 */
window.clearAllKmlLayers = () => {
    markerLabelsGroup.clearLayers(); // 清除所有 KML 標記、線、多邊形
    navButtonsGroup.clearLayers(); // 清除導航按鈕
    window.allKmlFeatures = []; // 清空全局搜尋數據
    console.log("[Map Logic] 所有 KML 圖層和搜尋資料已清除。");
};

/**
 * 將 GeoJSON features 添加到地圖上，並更新全局搜尋數據。
 * 這個函數會在 auth-kml-management.js 中被調用，接收從 Firestore 獲取的 GeoJSON features。
 * @param {Array<Object>} featuresToDisplay - 從 Firestore 獲取的 GeoJSON features 陣列。
 * 這些 features 應該是 GeoJSON Feature 物件，
 * 包含 `geometry` 和 `properties`。
 */
window.addMarkers = (featuresToDisplay) => {
    console.log("[Map Logic] addMarkers 被呼叫。");
    // 每次添加新圖層前，先清除舊的 KML 相關圖層和數據
    window.clearAllKmlLayers();

    if (!featuresToDisplay || featuresToDisplay.length === 0) {
        console.warn("[Map Logic] 沒有 GeoJSON features 提供給 addMarkers，或者 GeoJSON 數據為空。");
        window.showMessage('載入警示', 'KML 圖層載入完成但未發現有效地圖元素。');
        return;
    }

    // 重新填充 window.allKmlFeatures，因為 clearAllKmlLayers 清空了它
    window.allKmlFeatures = featuresToDisplay;

    // 使用 L.geoJSON 添加 GeoJSON 圖層
    L.geoJSON(featuresToDisplay, {
        // 為每個 GeoJSON 點位創建一個 Leaflet 標記
        pointToLayer: function (feature, latlng) {
            const name = feature.properties.name || '未知地點';
            const description = feature.properties.description || '無描述';

            const marker = L.marker(latlng);
            // 綁定彈出視窗
            marker.bindPopup(`<b>${name}</b><br>${description}`);
            // 添加點擊事件，顯示導航按鈕
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                window.createNavButton(e.latlng, name);
                console.log(`點擊 KML 標記: ${name} 在 ${e.latlng.lat}, ${e.latlng.lng}`);
            });
            return marker;
        },
        // 對於其他 GeoJSON 幾何類型 (線條、多邊形) 的樣式
        style: function (feature) {
            if (feature.geometry.type === 'LineString') {
                return { color: 'blue', weight: 3, opacity: 0.7 };
            }
            if (feature.geometry.type === 'Polygon') {
                return { color: 'blue', fillColor: 'lightblue', fillOpacity: 0.3, weight: 2 };
            }
            return {}; // 預設空樣式
        },
        onEachFeature: function (feature, layer) {
            // 如果有描述，確保綁定彈出視窗
            if (feature.properties && feature.properties.description && feature.geometry.type !== 'Point') {
                layer.bindPopup(feature.properties.description);
            }
        }
    }).addTo(markerLabelsGroup); // 將 GeoJSON 圖層添加到 markerLabelsGroup

    console.log(`[Map Logic] GeoJSON 層已添加到 markerLabelsGroup。目前圖層數量: ${markerLabelsGroup.getLayers().length}`);

    // 調整地圖視角以包含所有添加的 GeoJSON 要素
    if (markerLabelsGroup.getLayers().length > 0 && map) {
        const bounds = markerLabelsGroup.getBounds();
        if (bounds.isValid()) { // 檢查邊界是否有效（例如，不是空的）
            map.fitBounds(bounds);
            console.log("[Map Logic] 地圖視圖已調整以包含所有載入的地理要素。");
        } else {
            console.warn("[Map Logic] 無效的邊界，可能 GeoJSON 中沒有可見的幾何。");
        }
    }
    window.showMessage('載入成功', `KML 圖層已成功載入並顯示。`);
};


// 重寫 createNavButton 以使用 navButtonsGroup
window.createNavButton = (latlng, name) => {
    navButtonsGroup.clearLayers(); // 清除之前的導航按鈕

    // 使用通用的 Google Maps 查詢 URL，現代手機會自動識別並提供開啟地圖應用的選項。
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${latlng.lat},${latlng.lng}`;


    const buttonHtml = `
        <div class="nav-button-content" onclick="window.open('${googleMapsUrl}', '_blank'); event.stopPropagation();">
            <img src="https://i0.wp.com/canadasafetycouncil.org/wp-content/uploads/2018/08/offroad.png" alt="導航" />
        </div>
    `;
    const buttonIcon = L.divIcon({
        className: 'nav-button-icon',
        html: buttonHtml,
        iconSize: [50, 50],
        iconAnchor: [25, 25]
    });

    const navMarker = L.marker(latlng, {
        icon: buttonIcon,
        interactive: true
    }).addTo(navButtonsGroup); // 添加到 navButtonsGroup

    console.log(`已為 ${name} 在 ${latlng.lat}, ${latlng.lng} 創建導航按鈕。`);
};

// 移除 loadKmlLayer，因為 auth-kml-management.js 將直接調用 addMarkers
// window.loadKmlLayer = async (kmlUrl, layerName) => { /* ... */ };
