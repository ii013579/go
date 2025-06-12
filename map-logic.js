// map-logic.js v1.2.3

let map;
let baseLayers;
let currentLayer = null;
let currentLayerFeatures = []; // 儲存當前顯示圖層的 features
let markerLabelsGroup = L.featureGroup(); // 用於儲存點擊時顯示的標籤
let navButtonsGroup = L.featureGroup(); // 用於儲存點擊時顯示的導航按鈕

document.addEventListener('DOMContentLoaded', () => {
  // 初始化地圖
  map = L.map('map', {
    center: [23.5, 121], // 台灣中心點
    zoom: 8,
    maxZoom: 18, // 設定最大縮放級別
    minZoom: 7,  // 設定最小縮放級別
    zoomControl: false // 禁用預設的縮放控制
  });

  // 將 markerLabelsGroup 和 navButtonsGroup 添加到地圖
  markerLabelsGroup.addTo(map);
  navButtonsGroup.addTo(map);

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
    }),
    'Google 地形圖': L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', { // 新增地形圖
      attribution: 'Google Maps'
    })
  };

  // 添加自定義縮放控制 (加號和減號按鈕，放置在右上角)
  L.control.zoom({
    position: 'topright' // 放置在右上角
  }).addTo(map);

  // 添加定位按鈕 (使用 Material Symbols Icon，放置在右上角)
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
  L.control.locateMe({position: 'topright'}).addTo(map); // 放置在右上角

  // 將基本圖層控制添加到地圖 (放置在定位按鈕下方，右上角)
  L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

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
    // 清除所有現有的圖層和相關元素
    window.clearAllKmlLayers();

    if (!kmlId) return;

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
            return; // 不顯示訊息
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
                // 預設返回帶有紅色圓點的 Marker
                const defaultDotIcon = L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div class="custom-dot-icon" style="background-color: #e74c3c;"></div>`, // 預設紅色
                    iconSize: [18, 18],
                    iconAnchor: [9, 9]
                });
                return L.marker(latlng, { icon: defaultDotIcon });
            },
            onEachFeature: function (feature, layer) {
                let popupContent = '';
                if (feature.properties) {
                    let name = feature.properties.name || feature.properties.Name || '未命名點位';
                    if (feature.properties.description) {
                        const descriptionHtml = feature.properties.description;
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(descriptionHtml, 'text/html');
                        doc.querySelectorAll('br').forEach(br => br.remove());
                        popupContent = doc.body.textContent.trim();
                        popupContent = `<strong>名稱: ${name}</strong><br>${popupContent}`;
                    } else if (name) {
                        popupContent = `<strong>名稱: ${name}</strong>`;
                    }
                    
                    if (feature.geometry.type === 'Point') {
                        const latlng = layer.getLatLng();

                        // 創建文字標籤 (黑色文字), 立即顯示
                        // 偏移量以避免與圓點重疊，並使其位於圓點上方
                        const labelOffsetLat = latlng.lat;
                        const labelOffsetLon = latlng.lng + 0.00015; // 輕微向右偏移，如舊版所示
                        const labelLatLng = L.latLng(labelOffsetLat, labelOffsetLon);

                        const markerLabel = L.marker(labelLatLng, {
                            icon: L.divIcon({
                                className: 'marker-label',
                                html: `<span>${name}</span>`,
                                iconSize: [null, null], // 讓尺寸根據內容自動調整
                                iconAnchor: [0, 0] // 相對於左上角，需要配合 CSS 調整位置
                            }),
                            interactive: false // 標籤不可互動
                        }).addTo(markerLabelsGroup);

                        // 在點擊時才顯示導航按鈕
                        layer.on('click', (e) => {
                            L.DomEvent.stopPropagation(e); // 阻止事件冒泡到地圖，避免關閉按鈕
                            
                            // 清除所有舊的導航按鈕 (標籤不會被清除，因為它們一直存在於 markerLabelsGroup 中)
                            navButtonsGroup.clearLayers();

                            const clickedLatLng = layer.getLatLng(); // 獲取點擊點的經緯度
                            
                            // 創建導航按鈕 (使用舊版程式碼的圖片和 anchor)
                            const googleMapsUrl = `http://maps.google.com/maps?q=${clickedLatLng.lat},${clickedLatLng.lng}`;
                            const buttonHtml = `
                                <div class="nav-button-content" onclick="window.open('${googleMapsUrl}', '_blank'); event.stopPropagation();">
                                    <img src="https://i0.wp.com/canadasafetycouncil.org/wp-content/uploads/2018/08/offroad.png" alt="導航" />
                                </div>
                            `;
                            const navButtonIcon = L.divIcon({
                                className: 'nav-button-icon',
                                html: buttonHtml,
                                iconSize: [50, 50],
                                iconAnchor: [25, 25] // 錨點在圖片中心，如舊版程式碼所示
                            });
                            const navButton = L.marker(clickedLatLng, {
                                icon: navButtonIcon,
                                interactive: true
                            }).addTo(navButtonsGroup);
                            
                            map.setView(clickedLatLng, 16); // 縮放至點位
                            console.log(`點擊點位: ${name}，顯示導航按鈕，縮放至地圖，級別: 16。`);
                        });
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
    navButtonsGroup.clearLayers(); // 清除導航按鈕
    markerLabelsGroup.clearLayers(); // 清除文字標籤
    console.log("所有 KML 圖層、標記、導航按鈕和標籤已清除。");
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
        const noResult = document.createElement('div');
        noResult.className = 'result-item';
        noResult.textContent = '沒有找到結果';
        noResult.style.gridColumn = 'span 3'; // 讓「沒有找到結果」訊息橫跨三欄
        searchResults.appendChild(noResult);
        searchResults.style.display = 'grid'; // 仍然顯示結果框，只是內容為「沒有找到結果」
        searchContainer.classList.add('search-active');
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
                  // 點擊搜尋結果時，模擬點擊該點位，觸發導航按鈕和標籤顯示
                  map.eachLayer(function(layer) {
                      if (layer instanceof L.Marker && layer.getLatLng().equals(originalLatLng)) {
                          layer.fire('click'); // 觸發 Leaflet Marker 的 click 事件
                          return;
                      }
                  });
                  searchResults.style.display = 'none';
                  searchContainer.classList.remove('search-active');
                  searchBox.value = ''; // 清空搜尋框
                  console.log(`點擊搜尋結果: ${name}，觸發點位點擊。`);
              });
              searchResults.appendChild(item);
          } else {
              console.warn("跳過非 Point 類型或無座標的 feature 進行搜尋:", f);
          }
      });
  });

  // 處理地圖點擊事件，隱藏搜尋結果和導航按鈕
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
      navButtonsGroup.clearLayers(); // 清除導航按鈕
      // 不清除 markerLabelsGroup，因為它們應該一直顯示
  });
});
