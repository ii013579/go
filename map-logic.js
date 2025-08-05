// map-logic.js

let map;
let markers = L.featureGroup(); // 用於儲存所有自定義點標記 (圓點和文字標籤)
let navButtons = L.featureGroup(); // 用於儲存導航按鈕
let geoJsonLayers = L.featureGroup(); // 用於儲存所有 GeoJSON 圖層 (線、多邊形、點)

// 新增一個全局變數，用於儲存所有地圖上 KML Point Features 的數據，供搜尋使用
window.allKmlFeatures = [];

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
       
         // ? 預設載入 Google 街道圖
         baseLayers['Google 街道圖'].addTo(map);
       }

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
    
      // 移除舊的 onclick
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
    map.on('baselayerchange', function (e) {
        console.log("基本圖層已變更:", e.name);
        localStorage.setItem('lastBaseLayer', e.name);
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
    geoJsonLayers.addTo(map);

// 全局函數：添加標記到地圖 (現在支援 Point, LineString, Polygon)
window.addGeoJsonLayers = function(geojsonFeatures) {
    if (!map) {
        console.error("地圖尚未初始化。");
        return;
    }

    // 每次添加新圖層前，先清除舊的 GeoJSON 圖層和自定義點標記
    if (geoJsonLayers) {
        geoJsonLayers.clearLayers();
    } else {
        geoJsonLayers = L.featureGroup().addTo(map);
    }
    
    if (markers) {
        markers.clearLayers(); // 清除所有為點位創建的自定義圓點和文字標籤
    } else {
        markers = L.featureGroup().addTo(map);
    }
    
    const linePolygonFeatures = [];
    const pointFeatures = [];

    // 將 features 分類
    geojsonFeatures.forEach(feature => {
        if (feature.geometry && feature.geometry.type === 'Point') {
            pointFeatures.push(feature);
        } else if (feature.geometry && (feature.geometry.type === 'LineString' || feature.geometry.type === 'Polygon')) {
            linePolygonFeatures.push(feature);
        }
        // 其他未知的幾何類型將被忽略
    });

    // 處理 LineString 和 Polygon features
    if (linePolygonFeatures.length > 0) {
        L.geoJSON(linePolygonFeatures, {
            // **修正點**: 在 onEachFeature 中加入點擊事件處理邏輯
            onEachFeature: function(feature, layer) {
                layer.on('click', function(e) {
                    // **偵錯點 1**: 確認點擊事件有被觸發
                    console.log('點擊了地圖要素:', feature.properties.name);
            
                    const featureName = feature.properties.name || '未命名地圖要素';
            
                    let centerPoint = null;
                    if (feature.geometry.type === 'Polygon') {
                        centerPoint = window.getPolygonCentroid(feature.geometry.coordinates[0]);
                    } else if (feature.geometry.type === 'LineString') {
                        centerPoint = window.getLineStringMidpoint(feature.geometry.coordinates);
                    }
            
                    // **偵錯點 2**: 檢查計算出的中心點座標是否有效
                    console.log('計算出的中心點座標:', centerPoint);
            
                    if (centerPoint) {
                        const centerLatLng = L.latLng(centerPoint[1], centerPoint[0]);
                        window.createNavButton(centerLatLng, featureName);
                    }
                });
            },
            // 自定義 LineString 和 Polygon 樣式
            style: function(feature) {
                switch (feature.geometry.type) {
                    case 'LineString':
                        return { color: '#FF0000', weight: 3, opacity: 0.8 }; // 紅色線
                    case 'Polygon':
                        return { color: '#0000FF', weight: 2, opacity: 0.6, fillOpacity: 0.3 }; // 藍色多邊形
                    default:
                        return {}; // 默認樣式
                }
            }
        }).addTo(geoJsonLayers); // 將線和多邊形添加到 geoJsonLayers
    }

    // 處理 Point features (使用您原有的自定義樣式和行為)
    pointFeatures.forEach(f => {
        if (f.geometry && f.geometry.coordinates) {
            const [lon, lat] = f.geometry.coordinates;
            const latlng = L.latLng(lat, lon);
            const name = f.properties ? (f.properties.name || '未命名') : '未命名';
            const labelId = `label-${lat}-${lon}`.replace(/\./g, '_'); // 確保唯一 ID

            // 自定義圓點圖標
            const dotIcon = L.divIcon({
                className: 'custom-dot-icon',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });

            // 圓點標記
            const dot = L.marker(latlng, {
                icon: dotIcon,
                interactive: true
            });

            // 文字標籤標記
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

            // 為圓點標記綁定點擊事件
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
                } else {
                    console.warn('createNavButton 函式未定義或不可用。');
                }
            });
            
            markers.addLayer(dot);
            markers.addLayer(label);
            console.log(`添加 Point: ${name} (Lat: ${latlng.lat}, Lng: ${latlng.lng})`);
        }
    });

    console.log(`已添加 ${geojsonFeatures.length} 個 GeoJSON features 到地圖 (${pointFeatures.length} 點, ${linePolygonFeatures.length} 線/多邊形)。`);
};

// **新增輔助函式**: 計算多邊形的中心點
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

// **新增輔助函式**: 計算線段的中點
window.getLineStringMidpoint = function(coords) {
    const midIndex = Math.floor(coords.length / 2);
    return coords[midIndex];
};

    // ✅ 最後設定目前已載入的圖層 ID（避免下次重複載入）
    window.currentKmlLayerId = null;
    
// 載入 KML 圖層
window.loadKmlLayerFromFirestore = async function(kmlId) {
    // 避免重複載入相同的 KML 圖層
    if (window.currentKmlLayerId === kmlId) {
        console.log(`✅ 已載入圖層 ${kmlId}，略過重複讀取`);
        // 確保在有圖層的情況下，也能重新執行縮放邏輯
        if (geoJsonLayers && geoJsonLayers.getLayers().length > 0 || markers && markers.getLayers().length > 0) {
            const allLayers = L.featureGroup([geoJsonLayers, markers]);
            const bounds = allLayers.getBounds();
            if (bounds && bounds.isValid()) {
                map.fitBounds(bounds, { padding: L.point(50, 50) });
            }
        }
        return;
    }

    // 如果沒有提供 KML ID，則清除地圖上的所有 KML 圖層
    if (!kmlId) {
        console.log("未提供 KML ID，不載入。");
        window.clearAllKmlLayers(); // 清除地圖上的 KML 圖層
        return;
    }

    // 在載入新圖層之前，先清除地圖上已有的所有 KML 圖層
    window.clearAllKmlLayers();

    try {
        const docRef = db
            .collection('artifacts')
            .doc(appId)
            .collection('public')
            .doc('data')
            .collection('kmlLayers')
            .doc(kmlId);

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

        // **修正點 1**: 檢查並解析 GeoJSON 字串
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

        // 過濾掉沒有有效 geometry 或 properties 的 features
        const loadedFeatures = geojson.features.filter(f =>
            f.geometry && f.geometry.coordinates && f.properties
        );

        if (loadedFeatures.length !== geojson.features.length) {
            console.warn(`從 KML 圖層 "${kmlData.name}" 中跳過了 ${geojson.features.length - loadedFeatures.length} 個無效 features。`);
        }

        // 3️⃣ 更新全域變數並顯示圖層
        window.allKmlFeatures = loadedFeatures;
        window.addGeoJsonLayers(window.allKmlFeatures);

        // **修正點 2**: 重新調整自動縮放邏輯，讓它同時考慮所有 GeoJSON 圖層和點標記
        // 將所有圖層合併到一個臨時的 FeatureGroup 中，然後計算邊界
        const allLayers = L.featureGroup([geoJsonLayers, markers]);
        
        if (allLayers.getLayers().length > 0) {
            const bounds = allLayers.getBounds();
            if (bounds && bounds.isValid()) {
                map.fitBounds(bounds, {
                    padding: L.point(50, 50) // 添加一些邊距，讓圖層不會貼近邊緣
                });
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

    // 全局函數：清除所有 KML 圖層、標記和導航按鈕
    window.clearAllKmlLayers = function() {
        if (markers) {
            markers.clearLayers(); // 清除所有自定義點標記 (圓點和文字標籤)
        }
        if (navButtons) {
            navButtons.clearLayers(); // 清除所有導航按鈕
        }
        if (geoJsonLayers) {
            geoJsonLayers.clearLayers(); // 清除所有 GeoJSON 圖層 (線、多邊形)
        }

        window.allKmlFeatures = []; // 清空緩存的 KML features 數據
        window.currentKmlLayerId = null; // 清除當前載入的 KML ID

        console.log('所有 KML 圖層和相關數據已清除。');
    };
    
    
    // 全局函數：創建導航按鈕
    window.createNavButton = function(latlng, name) {
        navButtons.clearLayers();

        // 使用通用的 Google Maps 查詢 URL，現代手機會自動識別並提供開啟地圖應用的選項。
        const googleMapsUrl = `http://maps.google.com/maps?q=${latlng.lat},${latlng.lng}`;


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
           zIndexOffset: 2000, // **修正點 1**: 將 zIndexOffset 提高到 2000，確保按鈕永遠在最上層
           interactive: true
       }).addTo(navButtons);
   
       // **修正點 2**: 在建立按鈕後，平移地圖中心到按鈕的位置，確保用戶能看到
       map.panTo(latlng, {
           duration: 0.5 // 平移動畫時間
       });


        console.log(`已為 ${name} 在 ${latlng.lat}, ${latlng.lng} 創建導航按鈕。`);
    };

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
    
      // 取消所有藍色高亮標籤
      document.querySelectorAll('.marker-label span.label-active').forEach(el => {
        el.classList.remove('label-active');
      });
    
      // 清除導航按鈕
      navButtons.clearLayers();
    });
});