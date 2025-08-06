// map-logic.js v1.8

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

        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-locate-me');
            const button = L.DomUtil.create('a', '', container);
            button.href = "#";
            button.title = "顯示我的位置";
            button.setAttribute("role", "button");
            button.setAttribute("aria-label", "顯示我的位置");
            button.innerHTML = `<span class="material-symbols-outlined" style="font-size: 24px; line-height: 30px;">my_location</span>`;

            L.DomEvent.on(button, 'click', this._locateUser, this);

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
            map.locate({
                setView: true,
                maxZoom: 16,
                enableHighAccuracy: true,
                watch: false
            });
            window.showMessageCustom({
                title: '定位中',
                message: '正在獲取您的位置...',
                buttonText: '取消',
                autoClose: false
            });
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
            window.showMessageCustom({
                title: '定位成功',
                message: `您的位置已定位，誤差約 ${radius.toFixed(0)} 公尺。`,
                buttonText: '確定',
                autoClose: true,
                autoCloseDelay: 3000
            });
        },

        _onLocationError: function(e) {
            this._clearLocationMarkers();
            window.showMessageCustom({
                title: '定位失敗',
                message: `無法獲取您的位置: ${e.message}`,
                buttonText: '確定'
            });
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
window.addGeoJsonLayers = function(geojsonFeatures) {
    if (!map) {
        console.error("地圖尚未初始化。");
        return;
    }

    // 在載入新圖層前先清空
    geoJsonLayers.clearLayers();
    markers.clearLayers();
    navButtons.clearLayers();

    const linePolygonFeatures = [];
    const pointFeatures = [];

    geojsonFeatures.forEach(feature => {
        if (feature.geometry && feature.geometry.type === 'Point') {
            pointFeatures.push(feature);
        } else if (feature.geometry && (feature.geometry.type === 'LineString' || feature.geometry.type === 'Polygon')) {
            linePolygonFeatures.push(feature);
        }
    });

    // 處理 LineString 和 Polygon features
    if (linePolygonFeatures.length > 0) {
        L.geoJSON(linePolygonFeatures, {
            onEachFeature: function(feature, layer) {
                // 強制將多邊形圖層移到最底層
                layer.bringToBack();
                
                // 建立多邊形名稱標籤
                if (feature.geometry.type === 'Polygon' && feature.properties.name) {
                    const featureName = feature.properties.name;
                    const centerPoint = window.getPolygonCentroid(feature.geometry.coordinates[0]);
                    const centerLatLng = L.latLng(centerPoint[1], centerPoint[0]);
                    
                    const polygonLabelIcon = L.divIcon({
                        className: 'marker-label',
                        html: `<span>${featureName}</span>`,
                        iconSize: [null, null],
                        iconAnchor: [0, 0]
                    });

                    L.marker(centerLatLng, {
                        icon: polygonLabelIcon,
                        interactive: false,
                        zIndexOffset: 1000
                    }).addTo(geoJsonLayers);
                }
                
                // 點擊事件處理
                layer.on('click', function(e) {
                    L.DomEvent.stopPropagation(e);
                    const featureName = feature.properties.name || '未命名地圖要素';
                    
                    let centerPoint = null;
                    if (feature.geometry.type === 'Polygon') {
                        centerPoint = window.getPolygonCentroid(feature.geometry.coordinates[0]);
                    } else if (feature.geometry.type === 'LineString') {
                        centerPoint = window.getLineStringMidpoint(feature.geometry.coordinates);
                    }

                    if (centerPoint) {
                        const centerLatLng = L.latLng(centerPoint[1], centerPoint[0]);
                        window.createNavButton(centerLatLng, featureName);
                    }
                });
            },
            style: function(feature) {
                switch (feature.geometry.type) {
                    case 'LineString':
                        return { color: '#FF0000', weight: 3, opacity: 0.8 };
                    case 'Polygon':
                        return { color: '#0000FF', weight: 2, opacity: 0.6, fillOpacity: 0.3 };
                    default:
                        return {};
                }
            }
        }).addTo(geoJsonLayers);
    }

    // 處理 Point features
    pointFeatures.forEach(f => {
        if (f.geometry && f.geometry.coordinates) {
            const [lon, lat] = f.geometry.coordinates;
            const latlng = L.latLng(lat, lon);
            const name = f.properties ? (f.properties.name || '未命名') : '未命名';
            const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');

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
            
            markers.addLayer(dot);
            markers.addLayer(label);
        }
    });

    console.log(`已添加 ${geojsonFeatures.length} 個 GeoJSON features 到地圖 (${pointFeatures.length} 點, ${linePolygonFeatures.length} 線/多邊形)。`);
    window.allKmlFeatures = geojsonFeatures;
};

// 全域函數：創建導航按鈕
window.createNavButton = function(latlng, name) {
    if (!map) {
        console.error("地圖尚未初始化。");
        return;
    }

    navButtons.clearLayers();

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

    map.panTo(latlng, {
        duration: 0.5
    });

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

// 載入 KML 圖層 (請確認這個函式有被調用)
window.loadKmlLayerFromFirestore = async function(kmlId) {
    if (window.currentKmlLayerId === kmlId) {
        console.log(`✅ 已載入圖層 ${kmlId}，略過重複讀取`);
        if (geoJsonLayers.getLayers().length > 0 || markers.getLayers().length > 0) {
            const allLayers = L.featureGroup([geoJsonLayers, markers]);
            const bounds = allLayers.getBounds();
            if (bounds && bounds.isValid()) {
                map.fitBounds(bounds, { padding: L.point(50, 50) });
            }
        }
        return;
    }

    if (!kmlId) {
        console.log("未提供 KML ID，不載入。");
        window.clearAllKmlLayers();
        return;
    }

    window.clearAllKmlLayers();

    try {
        const docRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers').doc(kmlId);
        const doc = await docRef.get();

        if (!doc.exists) {
            console.error('KML 圖層文檔未找到 ID:', kmlId);
            window.showMessageCustom({
                title: '錯誤',
                message: '找不到指定的 KML 圖層資料。',
                buttonText: '確定'
            });
            return;
        }

        const kmlData = doc.data();
        console.log(`正在載入 KML Features，圖層名稱: ${kmlData.name || kmlId}`);

        let geojson = kmlData.geojsonContent;
        if (typeof geojson === 'string') {
            try {
                geojson = JSON.parse(geojson);
            } catch (parseError) {
                console.error("解析 geojsonContent 字串時發生錯誤:", parseError);
                window.showMessageCustom({
                    title: '載入錯誤',
                    message: `無法解析 KML 圖層 "${kmlData.name || kmlId}" 的地理資料。`,
                    buttonText: '確定'
                });
                return;
            }
        }

        if (!geojson || !geojson.features || geojson.features.length === 0) {
            console.warn(`KML 圖層 "${kmlData.name}" 沒有有效的 geojsonContent 或 features 為空。`);
            window.showMessageCustom({
                title: '載入警示',
                message: 'KML 圖層載入完成但未發現有效地圖元素。',
                buttonText: '確定'
            });
            window.allKmlFeatures = [];
            window.currentKmlLayerId = kmlId;
            return;
        }

        const loadedFeatures = geojson.features.filter(f =>
            f.geometry && f.geometry.coordinates && f.properties
        );

        if (loadedFeatures.length !== geojson.features.length) {
            console.warn(`從 KML 圖層 "${kmlData.name}" 中跳過了 ${geojson.features.length - loadedFeatures.length} 個無效 features。`);
        }

        window.allKmlFeatures = loadedFeatures;
        window.addGeoJsonLayers(window.allKmlFeatures);
        
        const allLayers = L.featureGroup([geoJsonLayers, markers]);
        if (allLayers.getLayers().length > 0) {
            const bounds = allLayers.getBounds();
            if (bounds && bounds.isValid()) {
                map.fitBounds(bounds, { padding: L.point(50, 50) });
            } else {
                console.warn("地理要素存在，但其邊界對於地圖視圖不適用。");
            }
        } else {
            console.warn("地圖上沒有圖層可適合。");
        }
        
        window.currentKmlLayerId = kmlId;
    } catch (error) {
        console.error("獲取 KML Features 或載入 KML 時出錯:", error);
        window.showMessageCustom({
            title: '錯誤',
            message: `無法載入 KML 圖層: ${error.message}。請確認 Firebase 安全規則已正確設定，允許讀取 /artifacts/{appId}/public/data/kmlLayers。`,
            buttonText: '確定'
        });
    }
};