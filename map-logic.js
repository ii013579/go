// map-logic.js v2.04 (整合極速標籤避讓與 v2.03 原版點位邏輯)

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
        isLoadingKml: false,
        _collisionRaf: null
    };
    window.mapNamespace = ns;

    // 預設樣式定義 (保持 v2.03 原版)
    const defaultStyle = {
        radius: 8,
        fillColor: "#e74c3c", // 預設紅色
        fillOpacity: 1,
        color: "#ffffff",     // 白色外框
        weight: 2,
        opacity: 1,
        interactive: true
    };

    // 輔助函式：還原所有圓點為原始樣式 (保持 v2.03 原版)
    const resetAllMarkerStyles = () => {
        ns.markers.eachLayer(layer => {
            if (layer instanceof L.CircleMarker && layer.feature) {
                const style = {
                    ...defaultStyle,
                    radius: layer.feature.properties?.radius || defaultStyle.radius,
                    fillColor: layer.feature.properties?.fillColor || defaultStyle.fillColor,
                    fillOpacity: layer.feature.properties?.fillOpacity || defaultStyle.fillOpacity,
                    color: layer.feature.properties?.color || defaultStyle.color,
                    weight: defaultStyle.weight
                };
                layer.setStyle(style);
            }
        });
    };

    // 🚀【極速版】：純數學像素投影標籤碰撞檢測（零 DOM 讀取，絕不卡頓）
    const updateLabelCollisions = () => {
        if (!ns.map) return;

        if (ns._collisionRaf) cancelAnimationFrame(ns._collisionRaf);

        ns._collisionRaf = requestAnimationFrame(() => {
            const map = ns.map;
            const mapBounds = map.getBounds();
            const mapSize = map.getSize();
            
            const visibleBoxes = [];
            const candidateLabels = [];

            // 1. 視窗初過濾 (Viewport Culling)：僅取畫面內的標籤
            ns.markers.eachLayer(layer => {
                if (layer instanceof L.Marker && layer.options?.icon?.options?.className === 'marker-label') {
                    const latlng = layer.getLatLng();
                    if (mapBounds.contains(latlng)) {
                        candidateLabels.push(layer);
                    } else {
                        const el = layer.getElement();
                        if (el) el.style.visibility = 'hidden';
                    }
                }
            });

            // 2. 權重排序：高亮選取中 (.label-active) 的標籤優先繪製
            candidateLabels.sort((a, b) => {
                const aActive = a.getElement()?.querySelector('.label-active') ? 1 : 0;
                const bActive = b.getElement()?.querySelector('.label-active') ? 1 : 0;
                return bActive - aActive;
            });

            // 3. ✨ 純數學碰撞計算（直接計算經緯度對應螢幕像素）
            candidateLabels.forEach(marker => {
                const el = marker.getElement();
                if (!el) return;

                const latlng = marker.getLatLng();
                const p = map.latLngToContainerPoint(latlng);

                const textSpan = el.querySelector('span');
                const text = textSpan ? textSpan.textContent : '';
                const isActive = textSpan?.classList.contains('label-active') || false;

                // 依字數估算像素寬高
                const fontSize = isActive ? 18 : 13;
                const charWidth = fontSize * 1.05; 
                const boxWidth = Math.max(text.length * charWidth + 10, 20);
                const boxHeight = fontSize + 8;

                // 計算 AABB 預估邊界
                const left = p.x + (isActive ? 20 : 10);
                const top = p.y - 12;
                const right = left + boxWidth;
                const bottom = top + boxHeight;

                // 畫面邊界檢查
                if (right < 0 || left > mapSize.x || bottom < 0 || top > mapSize.y) {
                    el.style.visibility = 'hidden';
                    return;
                }

                // 重疊檢測
                let isOverlap = false;
                for (let i = 0; i < visibleBoxes.length; i++) {
                    const box = visibleBoxes[i];
                    if (left < box.right && right > box.left && top < box.bottom && bottom > box.top) {
                        isOverlap = true;
                        break;
                    }
                }

                if (isOverlap && !isActive) {
                    el.style.visibility = 'hidden';
                } else {
                    el.style.visibility = 'visible';
                    visibleBoxes.push({ left, right, top, bottom });
                }
            });
        });
    };
    ns.updateLabelCollisions = updateLabelCollisions;

    // ---------- DOMContentLoaded: 初始化地圖與控制項 ----------
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof L === 'undefined') {
            console.error('Leaflet 未載入，無法初始化地圖。');
            return;
        }

        // 1. 初始化地圖
        ns.map = L.map('map', {
            preferCanvas: true,
            attributionControl: true,
            zoomControl: false,
            maxZoom: 25,
            minZoom: 5
        }).setView([23.6, 120.9], 8);
        
        // 2. 建立 Leaflet 缺失的 bottomcenter 容器
        if (ns.map._controlContainer && !ns.map._controlCorners['bottomcenter']) {
            ns.map._controlCorners['bottomcenter'] = L.DomUtil.create(
                'div', 
                'leaflet-bottomcenter', 
                ns.map._controlContainer
            );
        }
        
        // 3. 設定全域變數提供給 audit-module.js 使用
        window.map = ns.map;
        window.geoJsonLayers = ns.geoJsonLayers;
        window.markers = ns.markers;
        window.mapNamespace = ns;
        
        // 4. 啟動清查系統底部控制選單
        if (window.initBottomAuditControl) {
            window.initBottomAuditControl(ns.map);
        }

        // 基本圖層定義
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

        try {
            const lastLayerName = localStorage.getItem('lastBaseLayer');
            if (lastLayerName && baseLayers[lastLayerName]) {
                baseLayers[lastLayerName].addTo(ns.map);
                console.info(`已還原上次使用的圖層：${lastLayerName}`);
            } else {
                if (lastLayerName) {
                    localStorage.removeItem('lastBaseLayer');
                }
                baseLayers['Google 街道圖'].addTo(ns.map);
            }
        } catch (e) {
            baseLayers['Google 街道圖'].addTo(ns.map);
        }

        ns.geoJsonLayers.addTo(ns.map);
        ns.markers.addTo(ns.map);
        ns.navButtons.addTo(ns.map);

        // 清理 24 小時前的過期快取
        const cleanupOldCache = () => {
            const now = Date.now();
            const EXPIRE_LIMIT = 24 * 60 * 60 * 1000;
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
        
        try {
            ns.map.getPane('markerPane').style.zIndex = 600;
            ns.map.getPane('overlayPane').style.zIndex = 500;
        } catch (e) {}

        L.control.zoom({ position: 'topright' }).addTo(ns.map);

        // 自定義定位控制
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
                        const accuracy = pos.coords.accuracy || 0;

                        if (!this._firstViewCentered) {
                            ns.map.setView(latlng, 16);
                            this._firstViewCentered = true;
                            window.closeMessageCustom?.();
                        }

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

        new LocateMeControl({ position: 'topright' }).addTo(ns.map);

        // 訊息視窗 UI
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
            if (!overlay) return;
            const content = overlay.querySelector('.message-box-content');
            if (!content) return;

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
            if (overlay) overlay.classList.remove('visible');
        };

        const layerControl = L.control.layers(baseLayers, null, { position: 'topright' }).addTo(ns.map);
        ns.map.on('baselayerchange', function (e) {
            try {
                localStorage.setItem('lastBaseLayer', e.name);
            } catch (err) {}
            const controlContainer = layerControl.getContainer();
            if (controlContainer && controlContainer.classList.contains('leaflet-control-layers-expanded')) {
                controlContainer.classList.remove('leaflet-control-layers-expanded');
            }
        });

        // ✨ 地圖移動與縮放結束時執行標籤避讓計算
        ns.map.on('moveend zoomend', updateLabelCollisions);
    });

    // ---------- 公開方法：添加 GeoJSON 圖層 (完整維持 v2.03 原版邏輯) ----------
    window.addGeoJsonLayers = function (geojsonFeatures = []) {
        if (!ns.map) return;
    
        ns.geoJsonLayers.clearLayers();
        ns.markers.clearLayers();
        ns.navButtons.clearLayers();
    
        const kmlId = ns?.currentKmlLayerId;
        const records = (kmlId && window.auditLayersState) ? (window.auditLayersState[kmlId] || {}) : {};
    
        // 補全自訂點位
        Object.keys(records).forEach(pointKey => {
            const rec = records[pointKey];
            if (rec && rec.isCustomPoint && rec.lat && rec.lng) {
                const numLat = parseFloat(rec.lat);
                const numLng = parseFloat(rec.lng);
    
                const exists = geojsonFeatures.some(f => {
                    const name = f.properties?.name || f.properties?.title || f.properties?.auditPointKey;
                    return name === pointKey;
                });
    
                if (!exists) {
                    geojsonFeatures.push({
                        type: "Feature",
                        geometry: {
                            type: "Point",
                            coordinates: [numLng, numLat]
                        },
                        properties: {
                            name: pointKey,
                            title: pointKey,
                            kmlId: kmlId,
                            auditPointKey: pointKey,
                            isCustomPoint: true,
                            isAudited: true,
                            auditStatus: rec.deviceStatus || "新增",
                            auditNote: rec.note || "",
                            photos: rec.photos || [],
                            fillColor: "#FCD770",
                            color: "#ffffff",
                            radius: 8,
                            fillOpacity: 0.85
                        }
                    });
                }
            }
        });
    
        const canvasRenderer = L.canvas({ padding: 0.1 });
    
        geojsonFeatures.forEach(feature => {
            const type = feature?.geometry?.type;
            const coords = feature?.geometry?.coordinates;
            if (!type || !coords) return;
    
            if (type === 'Point') {
                const latlng = L.latLng(coords[1], coords[0]);
                const name = feature.properties?.name || '未命名';
                const labelId = `label-${String(coords[1])}-${String(coords[0])}`.replace(/\./g, '_');
    
                const featureStyle = {
                    ...defaultStyle,
                    radius: feature.properties?.radius || defaultStyle.radius,
                    fillColor: feature.properties?.fillColor || defaultStyle.fillColor,
                    fillOpacity: feature.properties?.fillOpacity || defaultStyle.fillOpacity,
                    color: feature.properties?.color || defaultStyle.color
                };
    
                const dot = L.circleMarker(latlng, {
                    renderer: canvasRenderer,
                    ...featureStyle
                });
    
                dot.feature = feature;
    
                // 點擊圓點事件 (v2.03 原版點擊風格)
                dot.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    
                    window.currentSelectedPoint = feature; 
    
                    // 重置所有點的顏色
                    resetAllMarkerStyles();
    
                    // 高亮當前點
                    dot.setStyle({ weight: 4, color: '#ffff00' });
    
                    document.querySelectorAll('.marker-label span').forEach(s => s.classList.remove('label-active'));
                    const targetSpan = document.getElementById(labelId);
                    if (targetSpan) targetSpan.classList.add('label-active');
    
                    if (typeof window.createNavButton === 'function') {
                        window.createNavButton(latlng, name);
                    }

                    // 觸發標籤重新比對 (確保選取的點位文字優先顯示)
                    ns.updateLabelCollisions?.();
                });
    
                ns.markers.addLayer(dot);
    
                // 標籤處理
                const label = L.marker(latlng, {
                    icon: L.divIcon({
                        className: 'marker-label',
                        html: `<span id="${labelId}">${name}</span>`,
                        iconSize: [null, null],
                        iconAnchor: [0, 0]
                    }),
                    interactive: false,
                    zIndexOffset: 500
                });
                ns.markers.addLayer(label);
            }
            else if (type === 'LineString' || type === 'Polygon') {
                const layer = L.geoJSON(feature, {
                    renderer: canvasRenderer,
                    style: { color: '#FF0000', weight: 3 }
                }).addTo(ns.geoJsonLayers);
    
                layer.on('click', function (e) {
                    L.DomEvent.stopPropagation(e);
                    window.currentSelectedPoint = feature;
                    let centerPoint = (type === 'Polygon') 
                        ? window.getPolygonCentroid(feature.geometry.coordinates[0])
                        : window.getLineStringMidpoint(feature.geometry.coordinates);
    
                    if (centerPoint && typeof window.createNavButton === 'function') {
                        window.createNavButton(L.latLng(centerPoint[1], centerPoint[0]), feature.properties?.name);
                    }
                });
            }
        });
    
        // 地圖空白處點擊重置 (維持 v2.03 原版 + 清除 UI)
        ns.map.off('click').on('click', () => {
            const searchResults = document.getElementById('searchResults');
            const searchContainer = document.getElementById('searchContainer');
            if (searchResults) searchResults.style.display = 'none';
            if (searchContainer) searchContainer.classList.remove('search-active');
            
            const searchBox = document.getElementById('searchBox');
            if (searchBox) searchBox.value = '';

            window.currentSelectedPoint = null;
            resetAllMarkerStyles();
            
            document.querySelectorAll('.marker-label span').forEach(s => s.classList.remove('label-active'));
            ns.navButtons.clearLayers();

            // 重新計算標籤隱藏
            ns.updateLabelCollisions?.();
        });
    
        ns.allKmlFeatures = geojsonFeatures;

        // 圖層繪製完成後執行第一次碰撞檢測
        setTimeout(() => ns.updateLabelCollisions?.(), 100);
    };
       
    // ---------- 公開方法：建立導航按鈕 (v2.03 原版) ----------
    window.createNavButton = function (latlng, name) {
        if (!ns.map) return;

        ns.navButtons.clearLayers();

        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latlng.lat},${latlng.lng}`;
        
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
            zIndexOffset: 5000,
            interactive: true
        }).addTo(ns.navButtons);

        navMarker.on('click', function (e) {
            L.DomEvent.stopPropagation(e);
            window.open(googleMapsUrl, '_blank');
        });

        try {
            ns.map.panTo(latlng, { animate: true, duration: 0.5 });
        } catch (e) {
            ns.map.setView(latlng);
        }
    };
    
    // ---------- 輔助函式：多邊形質心 (v2.03 原版) ----------
    window.getPolygonCentroid = function (coords) {
        if (!Array.isArray(coords) || coords.length === 0) return null;

        let area = 0, cx = 0, cy = 0;
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
            let sx = 0, sy = 0;
            coords.forEach(p => { sx += p[0]; sy += p[1]; });
            return [sx / n, sy / n];
        }

        area *= 0.5;
        cx = cx / (6 * area);
        cy = cy / (6 * area);
        return [cx, cy];
    };

    // ---------- 輔助函式：LineString 中點 (v2.03 原版) ----------
    window.getLineStringMidpoint = function (coords) {
        if (!Array.isArray(coords) || coords.length === 0) return null;
        if (coords.length === 1) return coords[0];

        const toRad = deg => deg * Math.PI / 180;
        const R = 6371000;
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
                const remain = half - acc;
                const ratio = segLengths[i] === 0 ? 0 : remain / segLengths[i];
                const a = coords[i], b = coords[i+1];
                const lon = a[0] + (b[0] - a[0]) * ratio;
                const lat = a[1] + (b[1] - a[1]) * ratio;
                return [lon, lat];
            }
            acc += segLengths[i];
        }

        const mid = Math.floor(coords.length / 2);
        return coords[mid];
    };

    // ---------- 清除所有 KML 圖層 ----------
    window.clearAllKmlLayers = function () {
        ns.markers.clearLayers();
        ns.navButtons.clearLayers();
        ns.geoJsonLayers.clearLayers();
        window.allKmlFeatures = [];
        ns.allKmlFeatures = [];
        ns.currentKmlLayerId = null;
    };

    // ---------- 從 Firestore 載入特定的 KML 圖層資料 ----------
    window.loadKmlLayerFromFirestore = async function(kmlId) {
        const ns = window.mapNamespace;
        const APP_ID = 'kmldata-d22fb';
        
        if (!kmlId) return;
        if (ns.isLoadingKml) return;
        ns.isLoadingKml = true;
    
        const CONTENT_CACHE_KEY = `kml_data_${kmlId}`;
    
        try {
            const cachedContent = localStorage.getItem(CONTENT_CACHE_KEY);
            if (cachedContent) {
                const kmlData = JSON.parse(cachedContent);
                if (typeof clearExistingLayers === 'function') clearExistingLayers(ns);
                if (typeof renderKmlData === 'function') renderKmlData(kmlData, kmlId);
                return;
            }
    
            const doc = await db.collection('artifacts').doc(APP_ID)
                                .collection('public').doc('data')
                                .collection('kmlLayers').doc(kmlId).get();
            
            if (!doc.exists) {
                throw new Error('資料庫中找不到該圖層，可能已被刪除。');
            }
    
            const kmlData = doc.data();
    
            try {
                localStorage.setItem(CONTENT_CACHE_KEY, JSON.stringify(kmlData));
            } catch (e) {}
    
            if (typeof clearExistingLayers === 'function') clearExistingLayers(ns);
            if (typeof renderKmlData === 'function') renderKmlData(kmlData, kmlId);
    
        } catch (error) {
            if (window.showMessageCustom) {
                window.showMessageCustom({ 
                    title: '載入失敗', 
                    message: error.message, 
                    buttonText: '確定' 
                });
            }
        } finally {
            ns.isLoadingKml = false;
        }
    };
    
    function clearExistingLayers(ns) {
        if (ns.geoJsonLayers) ns.geoJsonLayers.clearLayers();
        if (ns.markers) ns.markers.clearLayers();
    }

    function renderKmlData(kmlData, kmlId) {
        let geojson = kmlData.geojson;

        if (typeof geojson === 'string') {
            try {
                geojson = JSON.parse(geojson);
            } catch (e) {
                return;
            }
        }

        const loadedFeatures = (geojson?.features || []).filter(f =>
            f && f.geometry && f.geometry.coordinates && f.properties
        );

        ns.allKmlFeatures = loadedFeatures;
        window.allKmlFeatures = loadedFeatures;
        ns.currentKmlLayerId = kmlId;

        window.addGeoJsonLayers(loadedFeatures);

        const allLayers = L.featureGroup([ns.geoJsonLayers, ns.markers]);
        const bounds = allLayers.getBounds();
        if (bounds && bounds.isValid()) {
            ns.map.fitBounds(bounds, { padding: L.point(50, 50) });
        }
    }
    
    window.mapLogic = window.mapLogic || {};
    window.mapLogic._internal = ns;
})();