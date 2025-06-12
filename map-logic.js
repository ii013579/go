// map-logic.js

let map;
// 將現有的 markers 重新命名為 markerLabelsGroup，用於儲存所有 KML 標記以便管理
let markerLabelsGroup = L.featureGroup();
// 將現有的 navButtons 重新命名為 navButtonsGroup，用於儲存導航按鈕
let navButtonsGroup = L.featureGroup();

// 新增一個全局變數，用於儲存所有地圖上 KML Point Features 的數據，供搜尋使用
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    // 初始化地圖
    // 移除預設的 OpenStreetMap 圖層添加到地圖的行為，因為將通過圖層控制器添加
    map = L.map('map', { zoomControl: false }).setView([23.6, 120.9], 8); // 台灣中心經緯度，禁用預設縮放控制

    // 將 markerLabelsGroup 和 navButtonsGroup 添加到地圖
    markerLabelsGroup.addTo(map);
    navButtonsGroup.addTo(map);

    // 定義基本圖層
    const baseLayers = { // 使用 const 因為它不會被重新賦值
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

    // 添加自定義縮放控制 (加號和減號按鈕，放置在右上角)
    L.control.zoom({
        position: 'topright' // 放置在右上角
    }).addTo(map);

    // 自定義定位控制項
    const LocateMeControl = L.Control.extend({
        _userLocationMarker: null, // 用於儲存使用者位置標記
        _userLocationCircle: null, // 用於儲存使用者位置精度圓

        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-locate-me');
            const button = L.DomUtil.create('a', '', container);
            button.href = "#";
            button.title = "定位到我的位置";
            button.role = "button";
            button.innerHTML = '<span class="material-symbols-outlined">my_location</span>'; // 使用 Material Symbols Icon

            // 設置點擊事件
            L.DomEvent.on(button, 'click', (e) => {
                L.DomEvent.stopPropagation(e); // 阻止事件冒泡
                map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true }); // 定位並縮放到 16, 啟用高精度
            });

            // 處理定位成功事件
            map.on('locationfound', (e) => {
                const radius = e.accuracy / 2;

                if (this._userLocationMarker) {
                    this._userLocationMarker.setLatLng(e.latlng);
                    this._userLocationCircle.setLatLng(e.latlng).setRadius(radius);
                } else {
                    this._userLocationMarker = L.marker(e.latlng).addTo(map)
                        .bindPopup(`你距離這裡約 ${radius.toFixed(0)} 公尺`).openPopup();
                    this._userLocationCircle = L.circle(e.latlng, radius).addTo(map);
                }
                console.log(`定位成功：緯度 ${e.latlng.lat}, 經度 ${e.latlng.lng}, 精度 ${e.accuracy} 公尺`);
                window.showMessage('定位成功', `已定位到您的位置，精度約 ${e.accuracy.toFixed(0)} 公尺。`);
            });

            // 處理定位失敗事件
            map.on('locationerror', (e) => {
                console.error("定位失敗:", e.message);
                window.showMessage('定位失敗', `無法獲取您的位置：${e.message}`);
                // 如果無法定位，移除標記和圓圈
                if (this._userLocationMarker) {
                    map.removeLayer(this._userLocationMarker);
                    this._userLocationMarker = null;
                }
                if (this._userLocationCircle) {
                    map.removeLayer(this._userLocationCircle);
                    this._userLocationCircle = null;
                }
            });

            return container;
        },

        onRemove: function(map) {
            // 清理事件監聽器和圖層
            map.off('locationfound');
            map.off('locationerror');
            if (this._userLocationMarker) {
                map.removeLayer(this._userLocationMarker);
            }
            if (this._userLocationCircle) {
                map.removeLayer(this._userLocationCircle);
            }
        }
    });
    // 實例化並添加到地圖
    L.control.locateMe = function(opts) {
        return new L.Control.LocateMe(opts);
    };
    L.control.locateMe({position: 'topright'}).addTo(map); // 放置在右上角

    // 將基本圖層控制添加到地圖 (放置在定位按鈕下方，右上角)
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);


    // 處理地圖點擊事件，隱藏搜尋結果和導航按鈕
    map.on('click', () => {
        const searchResults = document.getElementById('searchResults');
        const searchContainer = document.getElementById('searchContainer'); // 獲取搜尋容器
        if (searchResults) {
            searchResults.style.display = 'none';
        }
        if (searchContainer) {
            searchContainer.classList.remove('search-active'); // 移除活躍狀態類別
        }
        navButtonsGroup.clearLayers(); // 清除導航按鈕
        console.log("地圖點擊事件：隱藏搜尋結果和導航按鈕。");
    });
});

// 重寫 loadKmlLayer 以使用 markerLabelsGroup
window.loadKmlLayer = async (kmlUrl, layerName) => {
    // 確保每次載入新的 KML 圖層時，清除舊的 KML 相關標記和圖層
    markerLabelsGroup.clearLayers(); // 清除所有 KML 標記

    window.allKmlFeatures = []; // 清空之前的 KML feature 數據

    // 取得 KML 數據
    try {
        const response = await fetch(kmlUrl);
        if (!response.ok) {
            throw new Error(`HTTP 錯誤! 狀態: ${response.status}`);
        }
        const kmlText = await response.text();

        // 解析 KML
        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(kmlText, 'text/xml');

        const kmlLayer = new L.KML(kmlDoc);
        kmlLayer.eachLayer(layer => {
            if (layer instanceof L.Marker) { // 檢查是否為標記
                const latlng = layer.getLatLng();
                const name = layer.feature && layer.feature.properties && layer.feature.properties.name ? layer.feature.properties.name : '未知地點';
                const description = layer.feature && layer.feature.properties && layer.feature.properties.description ? layer.feature.properties.description : '無描述';

                // 將 KML Point feature 數據儲存到全局變數中，供搜尋使用
                window.allKmlFeatures.push({
                    properties: {
                        name: name,
                        description: description
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [latlng.lng, latlng.lat] // 經緯度順序
                    }
                });

                // 為每個 KML 標記添加點擊事件，顯示導航按鈕
                layer.on('click', (e) => {
                    L.DomEvent.stopPropagation(e); // 阻止事件冒泡到地圖
                    window.createNavButton(e.latlng, name);
                    console.log(`點擊 KML 標記: ${name} 在 ${e.latlng.lat}, ${e.latlng.lng}`);
                });

                // 將標記添加到 markerLabelsGroup
                markerLabelsGroup.addLayer(layer);
            }
        });
        // 不直接添加到 map，而是添加到 markerLabelsGroup
        // kmlLayer.addTo(map); // 移除此行

        console.log(`已載入 KML 圖層: ${layerName}`);
        window.showMessage('載入成功', `KML 圖層 "${layerName}" 已成功載入。`);
    } catch (error) {
        console.error("載入 KML 圖層時出錯:", error);
        window.showMessage('載入失敗', `無法載入 KML 圖層 "${layerName}": ${error.message}`);
    }
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
