// map-logic.js

let map;
let markers = L.featureGroup(); // 用於儲存所有標記以便管理
let navButtons = L.featureGroup(); // 用於儲存導航按鈕

// 新增一個全局變數，用於儲存所有地圖上 KML Point Features 的數據，供搜尋使用
window.allKmlFeatures = [];

document.addEventListener('DOMContentLoaded', () => {
    // 初始化地圖
    map = L.map('map', { zoomControl: false }).setView([23.6, 120.9], 8); // 台灣中心經緯度，禁用預設縮放控制

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
    new LocateMeControl({ position: 'topright' }).addTo(map);

    // 將基本圖層控制添加到地圖的右上角
    const layerControl = L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

    // 監聽基本圖層變更事件，並在變更後自動隱藏圖層控制面板
    map.on('baselayerchange', function (e) {
        console.log("基本圖層已變更:", e.name);
        const controlContainer = layerControl.getContainer();
        if (controlContainer && controlContainer.classList.contains('leaflet-control-layers-expanded')) {
            // 移除 'leaflet-control-layers-expanded' 類別來收起控制面板
            controlContainer.classList.remove('leaflet-control-layers-expanded');
            console.log("圖層控制面板已自動收起。");
        }
    });

    // 將 markers 和 navButtons 添加到地圖
    markers.addTo(map);
    navButtons.addTo(map);

    // 全局函數：添加標記到地圖 (現在支援 Point, LineString, Polygon)
    window.addMarkers = function(featuresToDisplay) {
        markers.clearLayers(); // 清除現有標記

        if (!featuresToDisplay || featuresToDisplay.length === 0) {
            console.log("沒有 features 可顯示。");
            window.showMessage('載入警示', 'KML 圖層載入完成但未發現有效地圖元素。');
            return;
        }
        console.log(`正在將 ${featuresToDisplay.length} 個 features 添加到地圖。`);
        featuresToDisplay.forEach(f => {
            const name = f.properties.name || '未命名';
            const coordinates = f.geometry.coordinates;
            let layer;

            if (!coordinates) {
                console.warn(`跳過缺少座標的 feature: ${name} (類型: ${f.geometry.type || '未知'})`);
                return;
            }

            if (f.geometry.type === 'Point') {
                const [lon, lat] = coordinates;
                const latlng = L.latLng(lat, lon);
                const labelLatLng = L.latLng(lat, lon + 0.00015);

                // 自定義圓點圖標
                const dotIcon = L.divIcon({
                    className: 'custom-dot-icon',
                    iconSize: [18, 18],
                    iconAnchor: [9, 9]
                });
                layer = L.marker(latlng, {
                    icon: dotIcon,
                    interactive: true
                });

                // 永久顯示的文字標籤
                const label = L.marker(labelLatLng, {
                    icon: L.divIcon({
                        className: 'marker-label',
                        html: `<span>${name}</span>`,
                        iconSize: [null, null],
                        iconAnchor: [0, 0],
                    }),
                    interactive: false
                });

                // 點擊圓點標記時創建導航按鈕
                layer.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    window.createNavButton(latlng, name);
                });

                markers.addLayer(layer);
                markers.addLayer(label); // 為點添加標籤
                console.log(`添加 Point: ${name} (Lat: ${latlng.lat}, Lng: ${latlng.lng})`);

            } else if (f.geometry.type === 'LineString') {
                // 將 [lon, lat] 陣列轉換為 L.LatLng 陣列以用於 LineString
                const latlngs = coordinates.map(coord => L.latLng(coord[1], coord[0]));
                layer = L.polyline(latlngs, {
                    color: '#1a73e8', // 藍色
                    weight: 4,
                    opacity: 0.7
                });
                layer.bindPopup(`<b>${name}</b>`); // 為線添加彈出視窗顯示名稱
                markers.addLayer(layer);
                console.log(`添加 LineString: ${name} (${coordinates.length} 點)`);

            } else if (f.geometry.type === 'Polygon') {
                // 對於 Polygon，座標是 [ [[lon,lat],[lon,lat],...]] 用於外環
                // 並且可能包含內環。L.polygon 期望一個 LatLng 陣列的陣列。
                const latlngs = coordinates[0].map(coord => L.latLng(coord[1], coord[0]));
                layer = L.polygon(latlngs, {
                    color: '#1a73e8', // 藍色邊框
                    fillColor: '#6dd5ed', // 淺藍色填充
                    fillOpacity: 0.3,
                    weight: 2
                });
                layer.bindPopup(`<b>${name}</b>`); // 為多邊形添加彈出視窗顯示名稱
                markers.addLayer(layer);
                console.log(`添加 Polygon: ${name} (${coordinates[0].length} 點)`);

            } else {
                console.warn(`跳過不支援的幾何類型: ${f.geometry.type} (名稱: ${name})`);
            }
        });

        // 調整地圖視角以包含所有添加的標記和幾何圖形
        if (markers.getLayers().length > 0 && markers.getBounds().isValid()) {
            map.fitBounds(markers.getBounds());
            console.log("地圖視圖已調整以包含所有載入的地理要素。");
        } else if (featuresToDisplay.length > 0) {
            // 如果有 features 但沒有一個被添加到地圖 (例如，所有都是不支援的類型)
            console.warn("KML features 已載入，但地圖上沒有可顯示的幾何類型。請檢查控制台日誌以獲取詳細資訊。");
        }
    };

    // 全局函數：從 Firestore 載入 KML 圖層 (保留原版 logic，僅為了讓 auth-kml-management.js 找到)
    // 實際的 KML features 處理會透過 window.addMarkers 完成
    window.loadKmlLayerFromFirestore = async function(kmlId) {
        if (!kmlId) {
            console.log("未提供 KML ID，不載入。");
            window.clearAllKmlLayers();
            return;
        }

        // 移除現有 KML 圖層和所有標記 (包括導航按鈕)
        window.clearAllKmlLayers();

        try {
            // 從 Firestore 獲取 KML 文件的元數據
            const doc = await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers').doc(kmlId).get();
            if (!doc.exists) {
                console.error('KML 圖層文檔未找到 ID:', kmlId);
                showMessage('錯誤', '找不到指定的 KML 圖層資料。');
                return;
            }
            const kmlData = doc.data();

            console.log(`正在載入 KML Features，圖層名稱: ${kmlData.name || kmlId}`);

            // 從 kmlLayers/{kmlId}/features 子集合中獲取所有 GeoJSON features
            const featuresSubCollectionRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers').doc(kmlId).collection('features');
            const querySnapshot = await featuresSubCollectionRef.get();

            const loadedFeatures = [];
            if (querySnapshot.empty) {
                console.log(`KML 圖層 "${kmlData.name}" 的 features 子集合為空。`);
            } else {
                querySnapshot.forEach(featureDoc => {
                    const feature = featureDoc.data();
                    // 確保 feature 包含 geometry 和 properties
                    if (feature.geometry && feature.geometry.coordinates && feature.properties) {
                        loadedFeatures.push(feature);
                    } else {
                        console.warn('正在跳過來自 Firestore 的無效 feature:', feature);
                    }
                });
            }

            window.allKmlFeatures = loadedFeatures; // 更新全局搜尋數據
            window.addMarkers(window.allKmlFeatures); // 將所有地理要素添加到地圖

            // 如果有地理要素，設定地圖視角以包含所有要素
            if (window.allKmlFeatures.length > 0 && markers.getLayers().length > 0 && markers.getBounds().isValid()) {
                 map.fitBounds(markers.getBounds());
            } else {
                 console.warn("地理要素存在，但其邊界對於地圖視圖不適用，或地圖上沒有圖層可適合。");
            }

        } catch (error) {
            console.error("獲取 KML Features 或載入 KML 時出錯:", error);
            // 為了幫助調試，這裡可以顯示更詳細的錯誤訊息，例如安全規則相關的錯誤
            showMessage('錯誤', `無法載入 KML 圖層: ${error.message}。請確認 Firebase 安全規則已正確設定，允許讀取 /artifacts/{appId}/public/data/kmlLayers。`);
        }
    };

    // 全局函數：清除所有 KML 圖層、標記和導航按鈕
    window.clearAllKmlLayers = function() {
        markers.clearLayers();
        navButtons.clearLayers();
        window.allKmlFeatures = [];
        console.log("所有 KML 圖層、標記和導航按鈕已清除。");
    };

    // 全局函數：創建導航按鈕
    window.createNavButton = function(latlng, name) {
        navButtons.clearLayers();

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
        }).addTo(navButtons);

        console.log(`已為 ${name} 在 ${latlng.lat}, ${latlng.lng} 創建導航按鈕。`);
    };

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
        navButtons.clearLayers();
    });
});
