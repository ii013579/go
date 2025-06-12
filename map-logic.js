// map-logic.js

let map;
let baseLayers;
let currentLayer = null;
let currentLayerFeatures = []; // 儲存當前顯示圖層的 features

document.addEventListener('DOMContentLoaded', () => {
  // 初始化地圖
  map = L.map('map', {
    center: [23.5, 121], // 台灣中心點
    zoom: 8,
    maxZoom: 18, // 設定最大縮放級別
    minZoom: 7,  // 設定最小縮放級別
    zoomControl: false // 禁用預設的縮放控制
  });

  // 定義基本圖層
  baseLayers = {
    'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map), // 預設加入 OpenStreetMap
    'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      attribution: 'Google Maps'
    }),
    'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      attribution: 'Google Maps'
    })
  };

  // 將基本圖層控制添加到地圖
  L.control.layers(baseLayers).addTo(map);

  // 添加自定義縮放控制 (加號和減號按鈕)
  L.control.zoom({
    position: 'topleft' // 放置在左上角
  }).addTo(map);

  // 添加定位按鈕 (使用 Material Symbols Icon)
  L.Control.LocateMe = L.Control.extend({
    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-locate-me');
      container.innerHTML = '<a href="#" title="定位到我的位置" role="button"><span class="material-symbols-outlined">my_location</span></a>';

      L.DomEvent.on(container, 'click', function (e) {
        L.DomEvent.stopPropagation(e);
        map.locate({setView: true, maxZoom: 16}); // 定位並縮放到 16
      });
      return container;
    },
    onRemove: function(map) {
      // Nothing to do here
    }
  });
  L.control.locateMe = function(opts) {
    return new L.Control.LocateMe(opts);
  }
  L.control.locateMe({position: 'topleft'}).addTo(map); // 放置在左上角，在縮放控制下方

  // 處理定位成功事件
  map.on('locationfound', function(e) {
    L.marker(e.latlng).addTo(map)
      .bindPopup("你現在在這裡！").openPopup();
  });

  // 處理定位失敗事件
  map.on('locationerror', function(e) {
    showMessage('定位失敗', e.message);
  });

  // 自定義圖標創建函數
  const createCustomIcon = (iconUrl, iconSize = [48, 48], iconAnchor = [24, 48], popupAnchor = [0, -48]) => {
    return L.icon({
      iconUrl: iconUrl,
      iconSize: iconSize,
      iconAnchor: iconAnchor,
      popupAnchor: popupAnchor
    });
  };

  // 載入 KML 圖層的函式 (從 Firestore 獲取並顯示)
  window.loadKmlLayerFromFirestore = async (kmlId) => {
    if (currentLayer) {
      map.removeLayer(currentLayer);
      currentLayer = null;
      currentLayerFeatures = [];
      // 清除所有動態添加的導航按鈕和標籤
      map.eachLayer(function(layer) {
          if (layer.options && (layer.options.isNavButton || layer.options.isMarkerLabel)) {
              map.removeLayer(layer);
          }
      });
    }

    if (!kmlId) return;

    showMessage('載入中', '正在載入 KML 圖層...');
    try {
        const kmlLayerDocRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('kmlLayers').doc(kmlId);
        const featuresCollectionRef = kmlLayerDocRef.collection('features');
        const featuresSnapshot = await featuresCollectionRef.get();

        const geojsonFeatures = [];
        featuresSnapshot.forEach(doc => {
            const data = doc.data();
            geojsonFeatures.push({
                type: 'Feature',
                geometry: data.geometry,
                properties: data.properties
            });
        });

        if (geojsonFeatures.length === 0) {
            showMessage('載入完成', '此 KML 圖層中沒有可顯示的地理要素。');
            return;
        }

        const geojsonLayer = L.geoJSON(geojsonFeatures, {
            pointToLayer: function (feature, latlng) {
                // 如果有 customIconUrl 屬性，使用自定義圖標
                if (feature.properties.customIconUrl) {
                    return L.marker(latlng, { icon: createCustomIcon(feature.properties.customIconUrl) });
                } else if (feature.properties.styleUrl && feature.properties.styleUrl.includes('icon-')) {
                    // 檢查是否是 Google My Maps 的 icon- 樣式，並嘗試解析其顏色
                    const colorMatch = feature.properties.styleUrl.match(/icon-(\d+)-([0-9A-Fa-f]{6})/);
                    if (colorMatch) {
                        const hexColor = '#' + colorMatch[2];
                        const iconHtml = `<div class="custom-dot-icon" style="background-color: ${hexColor};"></div>`;
                        return L.marker(latlng, {
                            icon: L.divIcon({
                                className: 'custom-div-icon', // 可以用於額外的 CSS 樣式
                                html: iconHtml,
                                iconSize: [18, 18], // 圓點的尺寸
                                iconAnchor: [9, 9]   // 圓點的中心
                            })
                        });
                    }
                }
                // 預設返回 Marker
                return L.marker(latlng);
            },
            onEachFeature: function (feature, layer) {
                let popupContent = '';
                if (feature.properties) {
                    // 嘗試從 properties.name 或 description 中獲取名稱
                    let name = feature.properties.name || feature.properties.Name || '未命名點位';
                    if (feature.properties.description) {
                        // 從 description CDATA 內容中提取資訊
                        const descriptionHtml = feature.properties.description;
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(descriptionHtml, 'text/html');
                        // 移除所有 <br> 標籤
                        doc.querySelectorAll('br').forEach(br => br.remove());
                        popupContent = doc.body.textContent.trim(); // 提取純文字內容
                        // 將名稱放在第一行
                        popupContent = `<strong>名稱: ${name}</strong><br>${popupContent}`;
                    } else if (name) {
                        popupContent = `<strong>名稱: ${name}</strong>`;
                    }
                    
                    // 如果是點位，添加導航按鈕和標籤
                    if (feature.geometry.type === 'Point') {
                        // 創建導航按鈕 (圖片形式)
                        const navButtonIcon = L.divIcon({
                            className: 'nav-button-icon',
                            html: `<div class="nav-button-content"><img src="https://maps.google.com/mapfiles/kml/shapes/arrow.png" alt="導航" /></div>`,
                            iconSize: [50, 50],
                            iconAnchor: [25, 50] // 錨點在圖片底部中央
                        });
                        const navButton = L.marker(layer.getLatLng(), { icon: navButtonIcon, isNavButton: true }).addTo(map);
                        navButton.on('click', () => {
                            window.open(`https://www.google.com/maps/dir/?api=1&destination=${layer.getLatLng().lat},${layer.getLatLng().lng}`, '_blank');
                        });

                        // 創建文字標籤
                        const markerLabel = L.marker(layer.getLatLng(), {
                            icon: L.divIcon({
                                className: 'marker-label',
                                html: feature.properties.name || '', // 顯示名稱
                                iconSize: [200, 30], // 預設大小，可調整
                                iconAnchor: [100, -10] // 調整位置，讓文字顯示在圖標上方
                            }),
                            isMarkerLabel: true // 標記為自定義標籤
                        }).addTo(map);
                        // 綁定到圖層的事件，以便在地圖移動時更新標籤位置（如果需要）
                        layer.on('add', function() { markerLabel.addTo(map); });
                        layer.on('remove', function() { map.removeLayer(markerLabel); });
                    }
                }
                if (popupContent) {
                    layer.bindPopup(popupContent);
                }
            }
        });

        currentLayer = geojsonLayer.addTo(map);
        currentLayerFeatures = geojsonFeatures; // 將 features 儲存起來供搜尋使用

        // 調整地圖視圖以包含所有 features
        if (geojsonLayer.getBounds().isValid()) {
            map.fitBounds(geojsonLayer.getBounds());
        } else {
            console.warn("GeoJSON 層的邊界無效，無法自動調整地圖視圖。");
        }
        showMessage('載入成功', 'KML 圖層已成功載入。');
    } catch (error) {
        console.error("載入 KML 圖層失敗:", error);
        showMessage('載入失敗', `無法載入 KML 圖層: ${error.message}`);
    }
  };

  // 清除所有 KML 圖層和相關元素
  window.clearAllKmlLayers = () => {
    if (currentLayer) {
      map.removeLayer(currentLayer);
      currentLayer = null;
      currentLayerFeatures = [];
    }
    // 清除所有動態添加的導航按鈕和標籤
    map.eachLayer(function(layer) {
        if (layer.options && (layer.options.isNavButton || layer.options.isMarkerLabel)) {
            map.removeLayer(layer);
        }
    });
    console.log("所有 KML 圖層和相關元素已清除。");
  };

  // 搜尋功能
  const searchBox = document.getElementById('searchBox');
  const searchResults = document.getElementById('searchResults');
  const searchContainer = document.getElementById('searchContainer');

  searchBox.addEventListener('input', (e) => {
      const query = e.target.value.trim().toLowerCase();
      searchResults.innerHTML = ''; // 清空之前的結果
      
      if (!query) {
        searchResults.style.display = 'none';
        searchContainer.classList.remove('search-active');
        return;
      }

      console.log(`搜尋中: ${query}`);
      const results = currentLayerFeatures.filter(f => {
          const name = f.properties?.name?.toLowerCase();
          const description = f.properties?.description?.toLowerCase();
          return name?.includes(query) || description?.includes(query);
      });

      if (results.length === 0) {
        searchResults.style.display = 'none';
        searchContainer.classList.remove('search-active');
        console.log("未找到搜尋結果。");
        return;
      }

      searchResults.style.display = 'grid'; // 確保顯示為 grid
      searchContainer.classList.add('search-active'); // 添加活躍狀態類別
      console.log(`找到 ${results.length} 個搜尋結果。`);

      results.forEach(f => {
          // 確保 feature 是 Point 類型並且有座標
          if (f.geometry && f.geometry.type === 'Point' && f.geometry.coordinates && f.geometry.coordinates.length >= 2) {
              const name = f.properties?.name || '未命名';
              const [lon, lat] = f.geometry.coordinates; // 經度, 緯度

              const item = document.createElement('div');
              item.className = 'result-item';
              item.textContent = name;
              item.title = name; // 滑鼠懸停時顯示完整名稱
              item.addEventListener('click', () => {
                  const originalLatLng = L.latLng(lat, lon);
                  const currentZoom = map.getZoom();
                  const newZoom = Math.min(currentZoom + 2, map.getMaxZoom()); // 放大兩倍，不超過最大縮放級別
                  map.setView(originalLatLng, newZoom); // 縮放至新級別
                  // 如果有 createNavButton 函數，這裡可以呼叫它
                  // createNavButton(originalLatLng, name); // 如果有這個函數的話
                  searchResults.style.display = 'none';
                  searchContainer.classList.remove('search-active');
                  searchBox.value = ''; // 清空搜尋框
                  console.log(`點擊搜尋結果: ${name}，縮放至地圖，新縮放級別: ${newZoom}。`);
              });
              searchResults.appendChild(item);
          } else {
              console.warn("跳過非 Point 類型或無座標的 feature 進行搜尋:", f);
          }
      });
  });

  // 點擊搜尋結果框外部時隱藏搜尋結果
  document.addEventListener('click', (event) => {
      if (!searchResults.contains(event.target) && event.target !== searchBox && !searchContainer.contains(event.target)) {
          searchResults.style.display = 'none';
          searchContainer.classList.remove('search-active'); // 移除活躍狀態類別
      }
  });

  // 監聽 ESC 鍵以隱藏搜尋結果
  document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
          searchResults.style.display = 'none';
          searchContainer.classList.remove('search-active'); // 移除活躍狀態類別
          searchBox.blur(); // 讓搜尋框失去焦點
      }
  });

});
