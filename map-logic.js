// map-logic.js v1.9.6 - 優化版
// 重要：此檔案保留與原本介面相同的 window API（例如 window.addGeoJsonLayers、window.loadKmlLayerFromFirestore 等）
// 以避免破壞既有呼叫端程式。檔案內大幅重構以改善可讀性、錯誤處理、與效能（中文註解說明重要功能）。

(function () {
    'use strict';

    // 全域命名空間，以降低直接污染 window
    const ns = {
        map: null,
        markers: L.featureGroup(),
        navButtons: L.featureGroup(),
        geoJsonLayers: L.featureGroup(),
        allKmlFeatures: [],
        currentKmlLayerId: null,
        isLoadingKml: false
    };
    window.mapNamespace = ns;

    // ---------- DOMContentLoaded: 初始化地圖與控制項 ----------
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof L === 'undefined') {
            console.error('Leaflet 未載入，無法初始化地圖。');
            return;
        }

        // 初始化地圖
        ns.map = L.map('map', {
            attributionControl: true,
            zoomControl: false,
            maxZoom: 25,
            minZoom: 5
        }).setView([23.6, 120.9], 8);
        window.map = ns.map;

        // 基本圖層定義（使用常數）
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

        // 嘗試還原上次使用的圖層（若不合法則回到預設）
        try {
            const lastLayerName = localStorage.getItem('lastBaseLayer');
            if (lastLayerName && baseLayers[lastLayerName]) {
                baseLayers[lastLayerName].addTo(ns.map);
                console.info(`已還原上次使用的圖層：${lastLayerName}`);
            } else {
                if (lastLayerName) {
                    console.warn(`找不到記憶圖層 "${lastLayerName}"，已清除記錄。`);
                    localStorage.removeItem('lastBaseLayer');
                }
                baseLayers['Google 街道圖'].addTo(ns.map);
            }
        } catch (e) {
            console.warn('讀取 localStorage 時發生錯誤，使用預設圖層。', e);
            baseLayers['Google 街道圖'].addTo(ns.map);
        }

        // 將 feature groups 加到地圖（確保順序）
        ns.geoJsonLayers.addTo(ns.map);
        ns.markers.addTo(ns.map);
        ns.navButtons.addTo(ns.map);

        // --- 【新增】自動清理 24 小時前的過期快取 ---
        const cleanupOldCache = () => {
            const now = Date.now();
            const EXPIRE_LIMIT = 24 * 60 * 60 * 1000; // 24小時毫秒數
            let count = 0;
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('kml_time_')) {
                    const timestamp = parseInt(localStorage.getItem(key));
                    if (isNaN(timestamp) || (now - timestamp > EXPIRE_LIMIT)) {
                        const kmlId = key.replace('kml_time_', '');
                        localStorage.removeItem(`kml_data_${kmlId}`);
                        localStorage.removeItem(`kml_time_${kmlId}`);
                        count++;
                    }
                }
            });
            if(count > 0) console.log(`[系統] 已自動清理 ${count} 個過期的圖層快取。`);
        };
        cleanupOldCache();
        
        // 設定圖層/標記的 z-index（確保標記在上層）
        try {
            ns.map.getPane('markerPane').style.zIndex = 600;
            ns.map.getPane('overlayPane').style.zIndex = 500;
        } catch (e) {
            // 某些情況下 pane 可能不存在
            console.debug('設定 pane zIndex 時發生錯誤：', e);
        }

        // 縮放控制（右上）
        L.control.zoom({ position: 'topright' }).addTo(ns.map);

        // 自定義定位控制（包含顯示使用者位置的功能）
        const LocateMeControl = L.Control.extend({
            _userLocationMarker: null,
            _userLocationCircle: null,
            _watchId: null,
            _firstViewCentered: false,
            _button: null,

            onAdd: function (map) {
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

            onRemove: function () {
                this._stopTracking();
            },

            _toggleLocate: function (e) {
                L.DomEvent.stopPropagation(e);
                L.DomEvent.preventDefault(e);
                if (this._watchId) {
                    this._stopTracking();
                } else {
                    this._startTracking();
                }
            },

            _startTracking: function () {
                if (!navigator.geolocation) {
                    alert("您的裝置不支援定位功能");
                    return;
                }

                this._firstViewCentered = false;

                // 顯示「定位中」訊息（可被其他程式關閉）
                window.showMessageCustom({
                    title: '定位中',
                    message: '正在追蹤您的位置...',
                    buttonText: '停止',
                    autoClose: false,
                    onConfirm: () => this._stopTracking()
                });

                // 開始 watchPosition（高精度）
                this._watchId = navigator.geolocation.watchPosition(
                    (pos) => {
                        const latlng = [pos.coords.latitude, pos.coords.longitude];
                        const accuracy = pos.coords.accuracy || 0;

                        // 第一次定位時移動地圖視角，並關閉「定位中」訊息
                        if (!this._firstViewCentered) {
                            ns.map.setView(latlng, 16);
                            this._firstViewCentered = true;
                            window.closeMessageCustom?.();
                        }

                        // 更新藍點（不會干擾其他地圖操作）
                        this._updateLocation(latlng, accuracy);
                    },
                    (err) => {
                        console.error("定位失敗:", err && err.message ? err.message : err);
                        this._stopTracking();
                        window.showMessageCustom({
                            title: "定位失敗",
                            message: err && err.message ? err.message : '無法取得位置',
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

            _stopTracking: function () {
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

            _updateLocation: function (latlng, accuracy) {
                this._clearLocationMarkers();

                this._userLocationMarker = L.marker(latlng, {
                    icon: L.divIcon({
                        className: 'user-location-dot',
                        iconSize: [16, 16],
                        iconAnchor: [8, 8]
                    })
                }).addTo(ns.map);

                this._userLocationCircle = L.circle(latlng, Math.max(accuracy / 2, 10), {
                    color: '#1a73e8',
                    fillColor: '#1a73e8',
                    fillOpacity: 0.15,
                    weight: 2
                }).addTo(ns.map);
            },

            _clearLocationMarkers: function () {
                if (this._userLocationMarker) {
                    ns.map.removeLayer(this._userLocationMarker);
                    this._userLocationMarker = null;
                }
                if (this._userLocationCircle) {
                    ns.map.removeLayer(this._userLocationCircle);
                    this._userLocationCircle = null;
                }
            },

            _setButtonActive: function (active) {
                if (this._button) {
                    this._button.style.backgroundColor = active ? 'red' : '';
                    this._button.style.color = active ? 'white' : '';
                }
            }
        });

        // 註：將自訂定位控制項加入地圖（右上）
        new LocateMeControl({ position: 'topright' }).addTo(ns.map);

        // 顯示/關閉自訂訊息 UI 的輔助函式（容錯處理）
        window.showMessageCustom = function ({
            title = '',
            message = '',
            buttonText = '確定',
            autoClose = false,
            autoCloseDelay = 3000,
            onClose = null,
            onConfirm = null
        } = {}) {
            const overlay = document.querySelector('.message-box-overlay');
            if (!overlay) {
                console.warn('找不到 .message-box-overlay 元素，無法顯示訊息。', title, message);
                if (typeof onClose === 'function') onClose();
                return;
            }
            const content = overlay.querySelector('.message-box-content');
            if (!content) {
                console.warn('.message-box-content 不存在');
                if (typeof onClose === 'function') onClose();
                return;
            }
            const header = content.querySelector('h3');
            const paragraph = content.querySelector('p');
            const button = content.querySelector('button');

            if (header) header.textContent = title;
            if (paragraph) paragraph.textContent = message;
            if (button) {
                button.textContent = buttonText;
                button.onclick = () => {
                    overlay.classList.remove('visible');
                    if (typeof onConfirm === 'function') onConfirm();
                    if (typeof onClose === 'function') onClose();
                };
            }

            overlay.classList.add('visible');

            if (autoClose) {
                setTimeout(() => {
                    overlay.classList.remove('visible');
                    if (typeof onClose === 'function') onClose();
                }, autoCloseDelay);
            }
        };

        window.closeMessageCustom = function () {
            const overlay = document.querySelector('.message-box-overlay');
            if (overlay) {
                overlay.classList.remove('visible');
            }
        };

        // 圖層控制（右上），當切換圖層時會自動收合控制面板並記錄選擇
        const layerControl = L.control.layers(baseLayers, null, { position: 'topright' }).addTo(ns.map);
        ns.map.on('baselayerchange', function (e) {
            console.info("基本圖層已變更:", e.name);
            try {
                localStorage.setItem('lastBaseLayer', e.name);
            } catch (err) {
                console.warn('無法寫入 localStorage: ', err);
            }
            const controlContainer = layerControl.getContainer();
            if (controlContainer && controlContainer.classList.contains('leaflet-control-layers-expanded')) {
                controlContainer.classList.remove('leaflet-control-layers-expanded');
            }
        });

        // 地圖點擊時：隱藏搜尋結果、取消標籤高亮、清除導航按鈕
        ns.map.on('click', () => {
            const searchResults = document.getElementById('searchResults');
            const searchContainer = document.getElementById('searchContainer');
            if (searchResults) {
                searchResults.style.display = 'none';
                searchContainer?.classList.remove('search-active');
            }
            const searchBox = document.getElementById('searchBox');
            if (searchBox) {
                searchBox.value = '';
            }
            document.querySelectorAll('.marker-label span.label-active').forEach(el => {
                el.classList.remove('label-active');
            });
            ns.navButtons.clearLayers();
        });
    });

    // ---------- 公開方法：添加 GeoJSON 圖層（支援 Point, LineString, Polygon） ----------
    // 重要功能：會把新的 features 加入地圖，並以點、線、面分開處理以提升渲染控制與互動性
    window.addGeoJsonLayers = function (geojsonFeatures = []) {
        if (!ns.map) {
            console.error("地圖尚未初始化。");
            return;
        }

        // 清除舊圖層（確保畫面唯一）
        ns.geoJsonLayers.clearLayers();
        ns.markers.clearLayers();
        ns.navButtons.clearLayers();

        const linePolygonFeatures = [];
        const pointFeatures = [];

        geojsonFeatures.forEach(feature => {
            const type = feature?.geometry?.type;
            if (type === 'Point') {
                pointFeatures.push(feature);
            } else if (type === 'LineString' || type === 'Polygon') {
                linePolygonFeatures.push(feature);
            }
        });

        // 處理線與多邊形（單一 L.geoJSON 以加速）
        if (linePolygonFeatures.length > 0) {
            L.geoJSON(linePolygonFeatures, {
                onEachFeature: function (feature, layer) {
                    // 多邊形放底層顯示
                    try { layer.bringToBack(); } catch (e) { /* 忽略 */ }

                    // 若為 Polygon，新增 centroid 標籤（顯示名稱）
                    if (feature.geometry.type === 'Polygon' && feature.properties?.name) {
                        // 使用改良過的 centroid 計算（面積加權）
                        const outerRing = feature.geometry.coordinates[0] || [];
                        const centroidCoord = window.getPolygonCentroid(outerRing);
                        if (centroidCoord) {
                            const centerLatLng = L.latLng(centroidCoord[1], centroidCoord[0]);
                            const polygonLabelIcon = L.divIcon({
                                className: 'marker-label',
                                html: `<span>${feature.properties.name}</span>`,
                                iconSize: [null, null],
                                iconAnchor: [0, 0]
                            });
                            L.marker(centerLatLng, {
                                icon: polygonLabelIcon,
                                interactive: false,
                                zIndexOffset: 1000
                            }).addTo(ns.geoJsonLayers);
                        }
                    }

                    // 點擊後建立導航按鈕（LineString 以中點、Polygon 以中心）
                    layer.on('click', function (e) {
                        L.DomEvent.stopPropagation(e);
                        const featureName = feature.properties?.name || '未命名地圖要素';

                        let centerPoint = null;
                        if (feature.geometry.type === 'Polygon') {
                            const outer = feature.geometry.coordinates[0] || [];
                            centerPoint = window.getPolygonCentroid(outer);
                        } else if (feature.geometry.type === 'LineString') {
                            centerPoint = window.getLineStringMidpoint(feature.geometry.coordinates);
                        }

                        if (centerPoint) {
                            const centerLatLng = L.latLng(centerPoint[1], centerPoint[0]);
                            window.createNavButton(centerLatLng, featureName);
                        }
                    });
                },
                style: function (feature) {
                    if (!feature || !feature.geometry) return {};
                    if (feature.geometry.type === 'LineString') {
                        return { color: '#FF0000', weight: 3, opacity: 0.8 };
                    } else if (feature.geometry.type === 'Polygon') {
                        return { color: '#0000FF', weight: 2, opacity: 0.6, fillOpacity: 0.3 };
                    }
                    return {};
                }
            }).addTo(ns.geoJsonLayers);
        }

        // 處理點圖層（為每個點建立 dot + label）
        pointFeatures.forEach(f => {
            const coords = f?.geometry?.coordinates;
            if (!coords) return;
            const [lon, lat] = coords;
            const latlng = L.latLng(lat, lon);
            const name = f.properties ? (f.properties.name || '未命名') : '未命名';

            // 為了避免 id 衝突，組合與編碼產生 labelId
            const labelId = `label-${String(lat)}-${String(lon)}`.replace(/\./g, '_').replace(/\s+/g, '_');

            const dotIcon = L.divIcon({
                className: 'custom-dot-icon',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });

            const dot = L.marker(latlng, {
                icon: dotIcon,
                interactive: true
            });

            const label = L.marker(latlng, {
                icon: L.divIcon({
                    className: 'marker-label',
                    html: `<span id="${labelId}">${name}</span>`,
                    iconSize: [null, null],
                    iconAnchor: [0, 0]
                }),
                interactive: false,
                zIndexOffset: 1000
            });

            dot.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                // 取消其他標籤的高亮
                document.querySelectorAll('.marker-label span.label-active').forEach(el => {
                    el.classList.remove('label-active');
                });
                const target = document.getElementById(labelId);
                if (target) {
                    target.classList.add('label-active');
                }
                if (typeof window.createNavButton === 'function') {
                    window.createNavButton(latlng, name);
                }
            });

            ns.markers.addLayer(dot);
            ns.markers.addLayer(label);
        });

        console.info(`已添加 ${geojsonFeatures.length} 個 GeoJSON features 到地圖 (${pointFeatures.length} 點, ${linePolygonFeatures.length} 線/多邊形)。`);
        window.allKmlFeatures = geojsonFeatures;
        ns.allKmlFeatures = geojsonFeatures;
    };

    // ---------- 公開方法：建立導航按鈕（點擊後開啟 Google Maps） ----------
    window.createNavButton = function (latlng, name) {
        if (!ns.map) {
            console.error("地圖尚未初始化。");
            return;
        }

        // 清除現有的導航按鈕（單一導航目標）
        ns.navButtons.clearLayers();

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
        }).addTo(ns.navButtons);

        navMarker.on('click', function (e) {
            L.DomEvent.stopPropagation(e);
            window.open(googleMapsUrl, '_blank');
        });

        // 平滑移動地圖中心到目標（duration 可視 Leaflet 版本而有差異）
        try {
            ns.map.panTo(latlng, { duration: 0.5 });
        } catch (e) {
            ns.map.setView(latlng);
        }

        console.info(`已為 ${name} 在 ${latlng.lat}, ${latlng.lng} 創建導航按鈕。`);
    };

    // ---------- 輔助函式：多邊形質心（面積加權） ----------
    // 備註：輸入為 polygon 的外環點陣列（[ [lon,lat], ... ]），回傳 [lon, lat]
    // 若計算失敗則回傳座標平均值作為 fallback
    window.getPolygonCentroid = function (coords) {
        if (!Array.isArray(coords) || coords.length === 0) return null;

        // 使用面積加權質心公式（多邊形非自交）
        let area = 0;
        let cx = 0;
        let cy = 0;
        const n = coords.length;

        for (let i = 0; i < n; i++) {
            const [x0, y0] = coords[i];
            const [x1, y1] = coords[(i + 1) % n];
            const a = x0 * y1 - x1 * y0;
            area += a;
            cx += (x0 + x1) * a;
            cy += (y0 + y1) * a;
        }

        if (Math.abs(area) < 1e-12) {
            // 面積接近零 -> fallback 為平均值
            let sx = 0, sy = 0;
            coords.forEach(p => { sx += p[0]; sy += p[1]; });
            return [sx / n, sy / n];
        }

        area *= 0.5;
        cx = cx / (6 * area);
        cy = cy / (6 * area);
        return [cx, cy];
    };

    // ---------- 輔助函式：LineString 中點（依長度計算） ----------
    // 備註：輸入 coords 為 [ [lon,lat], ... ]，回傳 [lon,lat]（實作會沿線段找長度的一半位置）
    window.getLineStringMidpoint = function (coords) {
        if (!Array.isArray(coords) || coords.length === 0) return null;
        if (coords.length === 1) return coords[0];

        // 計算每段長度（Haversine 或簡單歐氏差距均可；此處採簡化的地面距離估算）
        const toRad = deg => deg * Math.PI / 180;
        const R = 6371000; // 地球半徑 (m)
        function dist(a, b) {
            const lat1 = toRad(a[1]), lon1 = toRad(a[0]);
            const lat2 = toRad(b[1]), lon2 = toRad(b[0]);
            const dlat = lat2 - lat1;
            const dlon = lon2 - lon1;
            const A = Math.sin(dlat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2;
            const C = 2 * Math.atan2(Math.sqrt(A), Math.sqrt(1-A));
            return R * C;
        }

        const segLengths = [];
        let total = 0;
        for (let i = 0; i < coords.length - 1; i++) {
            const d = dist(coords[i], coords[i+1]);
            segLengths.push(d);
            total += d;
        }

        const half = total / 2;
        let acc = 0;
        for (let i = 0; i < segLengths.length; i++) {
            if (acc + segLengths[i] >= half) {
                // mid point is on segment i, compute interpolation ratio
                const remain = half - acc;
                const ratio = segLengths[i] === 0 ? 0 : remain / segLengths[i];
                const a = coords[i], b = coords[i+1];
                const lon = a[0] + (b[0] - a[0]) * ratio;
                const lat = a[1] + (b[1] - a[1]) * ratio;
                return [lon, lat];
            }
            acc += segLengths[i];
        }

        // fallback: 回傳中間索引
        const mid = Math.floor(coords.length / 2);
        return coords[mid];
    };

    // ---------- 清除所有 KML/GeoJSON 圖層、標記、導航按鈕 ----------
    window.clearAllKmlLayers = function () {
        ns.markers.clearLayers();
        ns.navButtons.clearLayers();
        ns.geoJsonLayers.clearLayers();
        window.allKmlFeatures = [];
        ns.allKmlFeatures = [];
        ns.currentKmlLayerId = null;
        console.info('所有 KML 圖層和相關數據已清除。');
    };

// ---------- 載入 KML（其 GeoJSON）從 Firestore（具備 24h 快取優化） ----------
    window.loadKmlLayerFromFirestore = async function (kmlId) {
        // 1. 全域鎖：避免重複讀取
        if (ns.isLoadingKml) {
            console.info("⏳ 已有讀取程序進行中，略過本次 loadKmlLayerFromFirestore()");
            return;
        }

        // 2. 基本檢查
        if (!kmlId) {
            console.info("未提供 KML ID，不載入。");
            window.clearAllKmlLayers();
            return;
        }

        // 快取識別碼與 24 小時設定
        const CACHE_KEY = `kml_data_${kmlId}`;
        const CACHE_TIME_KEY = `kml_time_${kmlId}`;
        const EXPIRE_TIME = 24 * 60 * 60 * 1000; 

        ns.isLoadingKml = true;

        try {
            const now = Date.now();
            const cachedData = localStorage.getItem(CACHE_KEY);
            const cachedTime = localStorage.getItem(CACHE_TIME_KEY);

            // 3. 檢查本地快取是否存在且未過期
            if (cachedData && cachedTime && (now - parseInt(cachedTime) < EXPIRE_TIME)) {
                console.log(`%c[快取命中] 載入本地 24h 備份: ${kmlId}`, "color: #4CAF50; font-weight: bold;");
                
                // 若已經是當前圖層則不重複繪製（保留原邏輯）
                if (ns.currentKmlLayerId === kmlId) {
                    ns.isLoadingKml = false;
                    return;
                }

                window.clearAllKmlLayers();
                renderKmlData(JSON.parse(cachedData), kmlId);
                return; 
            }

            // 4. 若無快取或已過期，才從 Firestore 抓取
            console.log(`%c[網路請求] 從 Firebase 抓取最新資料: ${kmlId}`, "color: #2196F3; font-weight: bold;");
            
            if (typeof db === 'undefined' || typeof appId === 'undefined') {
                throw new Error('Firestore 或 appId 未定義，無法讀取 KML。');
            }

            window.clearAllKmlLayers();

            const docRef = db.collection('artifacts')
                .doc(appId).collection('public')
                .doc('data').collection('kmlLayers')
                .doc(kmlId);

            const doc = await docRef.get();

            if (!doc.exists) {
                throw new Error('找不到指定的 KML 圖層資料。');
            }

            const kmlData = doc.data();

            // 5. 存入本地快取（每個圖層獨立儲存）
            localStorage.setItem(CACHE_KEY, JSON.stringify(kmlData));
            localStorage.setItem(CACHE_TIME_KEY, now.toString());

            renderKmlData(kmlData, kmlId);

        } catch (error) {
            console.error("載入 KML 時出錯:", error);
            window.showMessageCustom({
                title: '錯誤',
                message: `無法載入 KML 圖層: ${error.message || error}`,
                buttonText: '確定'
            });
        } finally {
            ns.isLoadingKml = false; // 確保解除鎖
        }
    };

    // 抽離出的渲染邏輯（確保快取與網路共用同一套顯示流程）
    function renderKmlData(kmlData, kmlId) {
        let geojson = kmlData.geojson;

        if (typeof geojson === 'string') {
            try {
                geojson = JSON.parse(geojson);
            } catch (e) {
                console.error('解析 GeoJSON 失敗', e);
                return;
            }
        }

        const loadedFeatures = (geojson?.features || []).filter(f =>
            f && f.geometry && f.geometry.coordinates && f.properties
        );

        ns.allKmlFeatures = loadedFeatures;
        window.allKmlFeatures = loadedFeatures;
        ns.currentKmlLayerId = kmlId;

        // 繪製地圖
        window.addGeoJsonLayers(loadedFeatures);

        // 自動縮放至圖層範圍
        const allLayers = L.featureGroup([ns.geoJsonLayers, ns.markers]);
        const bounds = allLayers.getBounds();
        if (bounds && bounds.isValid()) {
            ns.map.fitBounds(bounds, { padding: L.point(50, 50) });
        }
    }
    
    // 如果需要外部存取命名空間，也可透過 window.mapLogic 取得（非必要）
    window.mapLogic = window.mapLogic || {};
    window.mapLogic._internal = ns;
})();