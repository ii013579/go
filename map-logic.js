// map-logic.js

let map;
let markers = L.featureGroup(); // 用於儲存所有標記以便管理
let navButtonsGroup = L.featureGroup(); // 用於儲存導航按鈕
let markerLabelsGroup = L.featureGroup(); // 用於儲存標記的文字標籤

// 新增一個全局變數，用於儲存所有地圖上 KML Point Features 的數據，供搜尋使用
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    // 初始化地圖
    map = L.map('map', { zoomControl: false }).setView([23.6, 120.9], 8); // 台灣中心經緯度，禁用預設縮放控制

    // 將 markerLabelsGroup 和 navButtonsGroup 添加到地圖
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
        'Google 地形圖': L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', { // 新增地形圖
            attribution: 'Google Maps'
        }),
        'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        })
    };

    // 預設加入 OpenStreetMap
    baseLayers['OpenStreetMap'].addTo(map);

    // 添加自定義縮放控制 (加號和減號按鈕，放置在右上角)
    L.control.zoom({
        position: 'topright' // 放置在右上角
    }).addTo(map);

    // 添加定位按鈕 (使用 Material Symbols Icon，放置在右上角)
    L.Control.LocateMe = L.Control.extend({
        _userLocationMarker: null,
        _userLocationCircle: null,

        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-locate-me');
            container.innerHTML = '<a href="#" title="定位到我的位置" role="button"><span class="material-symbols-outlined">my_location</span></a>';

            L.DomEvent.on(container, 'click', L.DomEvent.stopPropagation)
                      .on(container, 'click', () => {
                          map.locate({setView: true, maxZoom: 16}); // 定位並縮放到 16
                      });

            map.on('locationfound', (e) => {
                // 如果已經有標記，則更新其位置
                if (this._userLocationMarker) {
                    this._userLocationMarker.setLatLng(e.latlng);
                    this._userLocationCircle.setLatLng(e.latlng);
                    this._userLocationCircle.setRadius(e.accuracy / 2); // 調整半徑以反映精度
                } else {
                    // 否則創建新的標記和圓圈
                    this._userLocationMarker = L.marker(e.latlng, { icon: L.divIcon({
                        className: 'user-location-marker',
                        html: '<span class="material-symbols-outlined" style="font-size: 24px; color: #1a73e8;">person_pin_circle</span>',
                        iconSize: [24, 24],
                        iconAnchor: [12, 24]
                    })}).addTo(map);
                    this._userLocationCircle = L.circle(e.latlng, e.accuracy / 2, {
                        weight: 1,
                        color: '#1a73e8',
                        fillColor: '#1a73e8',
                        fillOpacity: 0.1
                    }).addTo(map);
                }
            });

            map.on('locationerror', (e) => {
                console.error("定位失敗:", e.message);
                window.showMessage('錯誤', `無法獲取您的位置: ${e.message}`);
            });

            return container;
        },

        onRemove: function(map) {
            if (this._userLocationMarker) {
                map.removeLayer(this._userLocationMarker);
                map.removeLayer(this._userLocationCircle);
            }
        }
    });
    L.control.locateMe = function(opts) {
        return new L.Control.LocateMe(opts);
    }
    L.control.locateMe({position: 'topright'}).addTo(map); // 放置在右上角

    // 將基本圖層控制添加到地圖 (放置在定位按鈕下方，右上角)
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);


    // 處理 KML 載入
    window.loadKmlLayer = (kmlUrl, layerName) => {
        // 檢查是否已經有同名的 KML 圖層，如果有則移除
        map.eachLayer((layer) => {
            if (layer.options && layer.options.layerName === layerName) {
                map.removeLayer(layer);
                console.log(`已移除舊的 KML 圖層: ${layerName}`);
            }
        });

        fetch(kmlUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP 錯誤! 狀態: ${response.status}`);
                }
                return response.text();
            })
            .then(kmlText => {
                const parser = new DOMParser();
                const kml = parser.parseFromString(kmlText, 'text/xml');
                const track = new L.KML(kml);

                track.options.layerName = layerName; // 將圖層名稱儲存到選項中
                track.addTo(map);
                // track.getBounds() 可能在 KML 較大時需要時間計算，可以選擇性地調用
                if (track.getBounds()) {
                    map.fitBounds(track.getBounds());
                }

                // 清空之前的 features
                window.allKmlFeatures = [];
                // 遍歷 KML 圖層中的每個圖徵 (feature)
                track.eachLayer(layer => {
                    if (layer instanceof L.Marker) { // 檢查是否是標記 (Point)
                        const latlng = layer.getLatLng();
                        const name = layer.options.name || "未知點位";
                        const description = layer.options.description || "";

                        // 將 Point features 儲存到全局陣列中，供搜尋使用
                        window.allKmlFeatures.push({
                            name: name,
                            latlng: latlng,
                            description: description,
                            rawFeature: layer // 儲存原始 Leaflet 層，可能在未來用於更多互動
                        });

                        // 創建一個自定義圖標，使其更容易點擊並顯示名稱
                        const customIcon = L.divIcon({
                            className: 'custom-div-icon',
                            html: `<div class="marker-pin"></div><i class="material-symbols-outlined" style="font-size: 24px; color: #f00;">location_on</i>`,
                            iconSize: [30, 42],
                            iconAnchor: [15, 42]
                        });

                        layer.setIcon(customIcon);

                        // 創建一個文字標籤並加入 markerLabelsGroup
                        const label = L.marker(latlng, {
                            icon: L.divIcon({
                                className: 'marker-label',
                                html: `<div class="marker-label-text">${name}</div>`,
                                iconAnchor: [-6, 20] // 調整標籤位置
                            })
                        }).addTo(markerLabelsGroup);

                        // 處理點擊事件，顯示導航按鈕
                        layer.on('click', (e) => {
                            L.DomEvent.stopPropagation(e); // 阻止事件傳播到地圖
                            createNavigationButton(name, latlng);
                            map.setView(latlng, map.getZoom()); // 點擊標記時保持當前縮放級別
                        });
                    } else if (layer instanceof L.Polyline || layer instanceof L.Polygon) {
                        // 可以為 Polyline 和 Polygon 添加額外的處理或綁定彈出視窗
                        if (layer.options && layer.options.name) {
                            layer.bindPopup(`<b>${layer.options.name}</b><br>${layer.options.description || ''}`);
                        }
                    }
                });
                console.log(`成功載入 KML: ${layerName} (${window.allKmlFeatures.length} 個點位)`);
                window.showMessage('成功', `KML圖層 "${layerName}" 已成功載入!`);
            })
            .catch(error => {
                console.error('載入 KML 時出錯:', error);
                window.showMessage('錯誤', `載入 KML 圖層 "${layerName}" 失敗: ${error.message}`);
            });
    };

    // 負責從地圖上移除指定的 KML 圖層 (由 kmlLayerSelectDashboard 調用)
    window.removeKmlLayer = (layerName) => {
        let layerRemoved = false;
        map.eachLayer((layer) => {
            if (layer.options && layer.options.layerName === layerName) {
                map.removeLayer(layer);
                layerRemoved = true;
                console.log(`已移除 KML 圖層: ${layerName}`);
            }
        });

        // 移除與該 KML 圖層相關的標記和導航按鈕
        // 由於我們重新構建 allKmlFeatures，這裡不需要特別清理 markers 和 navButtons
        // 但如果未來有多個 KML 圖層共存，且每個圖層有自己的 markers/navButtons，則需要更精細的處理
        markers.clearLayers();
        navButtonsGroup.clearLayers();
        markerLabelsGroup.clearLayers(); // 清除標籤

        // 重新構建 allKmlFeatures，只保留目前在圖上的 KML 點位
        // 這部分邏輯需要根據實際 KML 載入方式調整，目前假設每次載入 KML 都會完全替換 allKmlFeatures
        // 如果是多個 KML 疊加，則需要更複雜的狀態管理
        window.allKmlFeatures = window.allKmlFeatures.filter(feature => {
            // 這個過濾條件需要能判斷 feature 是否屬於被移除的 layerName
            // 目前實現中，allKmlFeatures 每次載入新 KML 就會被清空，所以這裡可能不需要過濾
            // 但為未來擴展性保留
            return true; // 暫時不過濾，因為目前只有一個 KML 被處理
        });


        if (layerRemoved) {
            window.showMessage('成功', `KML圖層 "${layerName}" 已成功移除!`);
        } else {
            window.showMessage('警告', `找不到 KML 圖層 "${layerName}"。`);
        }
    };


    // 創建導航按鈕並添加到 navButtonsGroup
    window.createNavigationButton = (name, latlng) => {
        navButtonsGroup.clearLayers();

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
        }).addTo(navButtonsGroup);

        console.log(`已為 ${name} 在 ${latlng.lat}, ${latlng.lng} 創建導航按鈕。`);
    };


    // 處理地圖點擊事件，隱藏搜尋結果和導航按鈕
    map.on('click', () => {
        const searchResults = document.getElementById('searchResults');
        const searchContainer = document.getElementById('searchContainer'); // 獲取搜尋容器

        if (searchResults) {
            searchResults.style.display = 'none';
            searchContainer.classList.remove('search-active');
        }
        navButtonsGroup.clearLayers(); // 清除導航按鈕
    });
});
