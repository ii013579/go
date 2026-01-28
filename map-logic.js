// map-logic.js v1.9.6

// 全域變數初始化，確保它們在整個腳本中可被訪問
let map;
let markers = L.featureGroup();
let navButtons = L.featureGroup();
let geoJsonLayers = L.featureGroup();
window.allKmlFeatures = [];

// DOM 載入完成後初始化地圖和控制項
document.addEventListener('DOMContentLoaded', () => {
    // 初始化地圖
    map = L.map('map', {
        attributionControl: true,
        zoomControl: false,
        maxZoom: 25,
        minZoom: 5
    }).setView([23.6, 120.9], 8);

    // 定義基本圖層
    const baseLayers = {
        'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
            attribution: 'Google Maps',
            maxZoom: 25,
            maxNativeZoom: 20
        }),
        'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
            attribution: 'Google Maps',
            maxZoom: 25,
            maxNativeZoom: 20
        }),
        'Google 地形圖': L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
            attribution: 'Google Maps',
            maxZoom: 25,
            maxNativeZoom: 20
        }),
        'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: 'c <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 25,
            maxNativeZoom: 20
        })
    };

    // 嘗試從 localStorage 取得上次選擇的圖層名稱
    const lastLayerName = localStorage.getItem('lastBaseLayer');
    if (lastLayerName && baseLayers[lastLayerName]) {
        baseLayers[lastLayerName].addTo(map);
        console.log(`已還原上次使用的圖層：${lastLayerName}`);
    } else {
        localStorage.removeItem('lastBaseLayer');
        console.warn(`找不到記憶圖層 "${lastLayerName}"，已清除記錄。`);
        baseLayers['Google 街道圖'].addTo(map);
    }

    // 將 markers, navButtons, geoJsonLayers 添加到地圖
    geoJsonLayers.addTo(map);
    markers.addTo(map);
    navButtons.addTo(map);

    // 調整圖層順序，確保 markers 和 navButtons 在最上層
    map.getPane('markerPane').style.zIndex = 600;
    map.getPane('overlayPane').style.zIndex = 500;

    // 將縮放控制添加到地圖的右上角
    L.control.zoom({ position: 'topright' }).addTo(map);

    // 自定義定位控制項
    const LocateMeControl = L.Control.extend({
        _userLocationMarker: null,
        _userLocationCircle: null,
        _watchId: null,
        _firstViewCentered: false,
        _button: null,
    
        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-locate-me');
            const button = L.DomUtil.create('a', '', container);
            button.href = "#";
            button.title = "顯示我的位置";
            button.setAttribute("role", "button");
            button.setAttribute("aria-label", "顯示我的位置");
            button.innerHTML = `<span class="material-symbols-outlined" style="font-size: 24px; line-height: 30px;">my_location</span>`;
    
            this._button = button;
            L.DomEvent.on(button, 'click', this._toggleLocate.bind(this));
            return container;
        },
    
        onRemove: function() {
            this._stopTracking();
        },
    
        _toggleLocate: function(e) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            if (this._watchId) {
                this._stopTracking();
            } else {
                this._startTracking();
            }
        },
    
        _startTracking: function() {
            if (!navigator.geolocation) {
                alert("您的裝置不支援定位功能");
                return;
            }
    
            this._firstViewCentered = false;
    
            // 顯示「定位中」訊息
            window.showMessageCustom({
                title: '定位中',
                message: '正在追蹤您的位置...',
                buttonText: '停止',
                autoClose: false,
                onConfirm: () => this._stopTracking()
            });
    
            this._watchId = navigator.geolocation.watchPosition(
                (pos) => {
                    const latlng = [pos.coords.latitude, pos.coords.longitude];
                    const accuracy = pos.coords.accuracy;
    
                    // ✅ 第一次定位時移動地圖視角，並關閉「定位中」訊息
                    if (!this._firstViewCentered) {
                        map.setView(latlng, 16);
                        this._firstViewCentered = true;
                        window.closeMessageCustom?.();
                    }
    
                    // ✅ 更新藍點（不會干擾地圖操作）
                    this._updateLocation(latlng, accuracy);
                },
                (err) => {
                    console.error("定位失敗:", err.message);
                    this._stopTracking();
                    window.showMessageCustom({
                        title: "定位失敗",
                        message: err.message,
                        buttonText: "確定"
                    });
                },
                {
                    enableHighAccuracy: true,
                    maximumAge: 0,
                    timeout: 10000
                }
            );
    
            this._setButtonActive(true);
        },
    
        _stopTracking: function() {
            if (this._watchId !== null) {
                navigator.geolocation.clearWatch(this._watchId);
                this._watchId = null;
            }
    
            this._clearLocationMarkers();
            this._setButtonActive(false);
            window.closeMessageCustom?.();
            window.showMessageCustom({
                title: '定位已停止',
                message: '位置追蹤已關閉。',
                buttonText: '確定',
                autoClose: true,
                autoCloseDelay: 2000
            });
        },
    
        _updateLocation: function(latlng, accuracy) {
            this._clearLocationMarkers();
    
            this._userLocationMarker = L.marker(latlng, {
                icon: L.divIcon({
                    className: 'user-location-dot',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                })
            }).addTo(map);
    
            this._userLocationCircle = L.circle(latlng, accuracy / 2, {
                color: '#1a73e8',
                fillColor: '#1a73e8',
                fillOpacity: 0.15,
                weight: 2
            }).addTo(map);
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
        },
    
        _setButtonActive: function(active) {
            if (this._button) {
                this._button.style.backgroundColor = active ? 'red' : '';
                this._button.style.color = active ? 'white' : '';
            }
        }
    });

    // 處理自定義訊息框
    window.showMessageCustom = function({
        title = '',
        message = '',
        buttonText = '確定',
        autoClose = false,
        autoCloseDelay = 3000,
        onClose = null
    }) {
        const overlay = document.querySelector('.message-box-overlay');
        if (overlay) overlay.classList.remove('visible');
        const content = overlay.querySelector('.message-box-content');
        const header = content.querySelector('h3');
        const paragraph = content.querySelector('p');
        const button = content.querySelector('button');

        header.textContent = title;
        paragraph.textContent = message;
        button.textContent = buttonText;
        overlay.classList.add('visible');

        button.onclick = () => {
            overlay.classList.remove('visible');
            if (typeof onClose === 'function') onClose();
        };

        if (autoClose) {
            setTimeout(() => {
                overlay.classList.remove('visible');
                if (typeof onClose === 'function') onClose();
            }, autoCloseDelay);
        }
    };
    
        window.closeMessageCustom = function() {
        const overlay = document.querySelector('.message-box-overlay');
        if (overlay) {
            overlay.classList.remove('visible');
        }
    };

    // 將自定義定位控制項添加到地圖的右上角
    new LocateMeControl({ position: 'topright' }).addTo(map);

    // 將基本圖層控制添加到地圖的右上角
    const layerControl = L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

    // 監聽基本圖層變更事件，並在變更後自動隱藏圖層控制面板
    map.on('baselayerchange', function(e) {
        console.log("基本圖層已變更:", e.name);
        localStorage.setItem('lastBaseLayer', e.name);
        const controlContainer = layerControl.getContainer();
        if (controlContainer && controlContainer.classList.contains('leaflet-control-layers-expanded')) {
            controlContainer.classList.remove('leaflet-control-layers-expanded');
            console.log("圖層控制面板已自動收起。");
        }
    });

    // 處理地圖點擊事件，隱藏搜尋結果和導航按鈕與取消標籤高亮
    map.on('click', () => {
        const searchResults = document.getElementById('searchResults');
        const searchContainer = document.getElementById('searchContainer');
        if (searchResults) {
            searchResults.style.display = 'none';
            searchContainer.classList.remove('search-active');
        }
        const searchBox = document.getElementById('searchBox');
        if (searchBox) {
            searchBox.value = '';
        }
        document.querySelectorAll('.marker-label span.label-active').forEach(el => {
            el.classList.remove('label-active');
        });
        navButtons.clearLayers();
    });
});

// 全域函數：添加 GeoJSON 圖層 (現在支援 Point, LineString, Polygon)
    // 處理 Point features

    pointFeatures.forEach(f => {

        if (f.geometry && f.geometry.coordinates) {

            const [lon, lat] = f.geometry.coordinates;

            const latlng = L.latLng(lat, lon);

            const name = f.properties ? (f.properties.name || '未命名') : '未命名';

            const featureId = ${lat.toFixed(6)},${lon.toFixed(6)};

            const labelId = label-${lat}-${lon}.replace(/\./g, '_');

    

            const dotIcon = L.divIcon({

                className: 'custom-dot-icon',

                iconSize: [16, 16],

                iconAnchor: [8, 8]

            });

    

            const dot = L.marker(latlng, {

                icon: dotIcon,

                interactive: true

            });

            

            if (!window.featureDotMap) window.featureDotMap = {};

            window.featureDotMap[featureId] = dot;

    

            const label = L.marker(latlng, {

                icon: L.divIcon({

                    className: 'marker-label',

                    html: <span id="${labelId}">${name}</span>,

                    iconSize: [null, null],

                    iconAnchor: [0, 0]

                }),

                interactive: false,

                zIndexOffset: 1000

            });

    

            dot.on('click', (e) => {

                L.DomEvent.stopPropagation(e);

    

                document.querySelectorAll('.marker-label span.label-active')

                  .forEach(el => el.classList.remove('label-active'));

    

                const target = document.getElementById(labelId);

                if (target) target.classList.add('label-active');

    

                if (typeof window.createNavButton === 'function') {

                    // ⚠️ 先不要傳第三個參數

                    window.createNavButton(latlng, name, featureId);

                }

            });

    

            markers.addLayer(dot);

            markers.addLayer(label);

        }

    });

    

    // ⚠️ 先拿掉 linePolygonFeatures，避免 ReferenceError

    console.log(已添加 ${geojsonFeatures.length} 個 GeoJSON features（${pointFeatures.length} 點）。);

    

    window.allKmlFeatures = geojsonFeatures;



// ===== v2.0：清查完成後，將紅點標記為灰色 =====

window.markFeatureInspectionDone = function (featureId) {

    if (!window.featureDotMap) return;



    const marker = window.featureDotMap[featureId];

    if (!marker) {

        console.warn('找不到對應紅點:', featureId);

        return;

    }



    const el = marker.getElement();

    if (el) {

        el.classList.add('inspection-done');

    }

};

/* ===== 紀錄 ===== */
console.log(
    `已添加 ${pointFeatures.length} 個 Point features（v2.0 清查版）`
);

window.allKmlFeatures = geojsonFeatures;


// 全域函數：創建導航按鈕（v2.0 修正版）
window.createNavButton = function(latlng, name) {
    if (!map) {
        console.error("地圖尚未初始化。");
        return;
    }

    navButtons.clearLayers();

    /* ===== 導航按鈕 ===== */
    const googleMapsUrl = `https://maps.google.com/?q=${latlng.lat},${latlng.lng}`;
    const buttonHtml = `
        <div class="nav-button-content">
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
        zIndexOffset: 2000,
        interactive: true
    }).addTo(navButtons);

    navMarker.on('click', function(e) {
        L.DomEvent.stopPropagation(e);
        window.open(googleMapsUrl, '_blank');
    });

    /* ===== v2.0 清查鉛筆（重點修正）===== */
    if (window.isInspectionMode && typeof window.showInspectionPencil === 'function') {
        // 直接用 name 當 featureId（穩定、一定存在）
        window.showInspectionPencil({
            latlng,
            name,
            featureId: name
        });
    }

    map.panTo(latlng, { duration: 0.5 });

    console.log(`已為 ${name} 在 ${latlng.lat}, ${latlng.lng} 創建導航按鈕。`);
};

// 輔助函式：計算多邊形的中心點
window.getPolygonCentroid = function(coords) {
    let centroid = [0, 0];
    let count = 0;
    coords.forEach(point => {
        centroid[0] += point[0];
        centroid[1] += point[1];
        count++;
    });
    if (count > 0) {
        centroid[0] /= count;
        centroid[1] /= count;
    }
    return centroid;
};

// 輔助函式：計算線段的中點
window.getLineStringMidpoint = function(coords) {
    const midIndex = Math.floor(coords.length / 2);
    return coords[midIndex];
};

// 全域函數：清除所有 KML 圖層、標記和導航按鈕
window.clearAllKmlLayers = function() {
    markers.clearLayers();
    navButtons.clearLayers();
    geoJsonLayers.clearLayers();
    window.allKmlFeatures = [];
    window.currentKmlLayerId = null;
    console.log('所有 KML 圖層和相關數據已清除。');
};

// 全域鎖（避免重複讀取）
window.isLoadingKml = false;

// 載入 KML 圖層
window.loadKmlLayerFromFirestore = async function(kmlId) {

    // 🔒【全域鎖定：避免重複讀取】
    if (window.isLoadingKml) {
        console.log("⏳ 已有讀取程序進行中，略過本次 loadKmlLayerFromFirestore()");
        return;
    }
    window.isLoadingKml = true;

    try {
        if (window.currentKmlLayerId === kmlId) {
            console.log(`✅ 已載入圖層 ${kmlId}，略過重複讀取`);
            window.isLoadingKml = false;  // <--- 記得解除鎖
            return;
        }

        if (!kmlId) {
            console.log("未提供 KML ID，不載入。");
            window.clearAllKmlLayers();
            window.isLoadingKml = false;  // <--- 記得解除鎖
            return;
        }

        window.clearAllKmlLayers();

        const docRef = db.collection('artifacts')
            .doc(appId).collection('public')
            .doc('data').collection('kmlLayers')
            .doc(kmlId);

        const doc = await docRef.get();

        if (!doc.exists) {
            console.error('KML 圖層文檔未找到 ID:', kmlId);
            window.showMessageCustom({
                title: '錯誤',
                message: '找不到指定的 KML 圖層資料。',
                buttonText: '確定'
            });
            window.isLoadingKml = false; // <--- 記得解除鎖
            return;
        }

        const kmlData = doc.data();

        let geojson = kmlData.geojson;
        if (typeof geojson === 'string') {
            geojson = JSON.parse(geojson);
        }

        const loadedFeatures = (geojson.features || []).filter(f =>
            f.geometry && f.geometry.coordinates && f.properties
        );

        window.allKmlFeatures = loadedFeatures;
        window.currentKmlLayerId = kmlId;

        window.addGeoJsonLayers(loadedFeatures);

        const allLayers = L.featureGroup([geoJsonLayers, markers]);
        const bounds = allLayers.getBounds();
        if (bounds && bounds.isValid()) {
            map.fitBounds(bounds, { padding: L.point(50, 50) });
        }

    } catch(error) {
        console.error("獲取 KML Features 時出錯:", error);
        window.showMessageCustom({
            title: '錯誤',
            message: `無法載入 KML 圖層: ${error.message}`,
            buttonText: '確定'
        });

    } finally {
        window.isLoadingKml = false; // ❗ 不管成功或失敗最後一定要解除鎖
    }
};