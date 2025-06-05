// js/map-app.js

// 假設 auth 和 db 已經在 firebase-init.js 中初始化並成為全域變數

const searchBox = document.getElementById('searchBox');
const searchResults = document.getElementById('searchResults');
const kmlInput = document.getElementById('kmlInput');
const importButton = document.getElementById('importButton');
const exportButton = document.getElementById('exportButton');
const map = L.map('map', {
  center: [23.6, 120.9], // 台灣中心點大概緯度
  zoom: 8,
  minZoom: 8,
  maxZoom: 18,
  maxBounds: [[-90, -180], [90, 180]] // 全球範圍
});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let kmlFeatures = L.featureGroup().addTo(map);
let allKmlData = []; // 儲存所有 KML 資料，以便搜尋

// 定位控制項
L.control.locate({
  setView: true,
  drawCircle: false,
  strings: {
    title: "顯示我的位置"
  }
}).addTo(map);

// 搜尋 KML 資料
searchBox.addEventListener('input', (event) => {
  const query = event.target.value.toLowerCase();
  searchResults.innerHTML = ''; // 清空先前的搜尋結果

  if (query.length > 0) {
    const results = allKmlData.filter(item =>
      item.name.toLowerCase().includes(query)
    );

    // 調整搜尋結果框的位置和大小
    const searchBoxRect = searchBox.getBoundingClientRect();
    searchResults.style.top = `${searchBoxRect.bottom}px`; // 緊貼搜尋框底部
    searchResults.style.left = `${searchBoxRect.left}px`;
    searchResults.style.width = `${searchBoxRect.width}px`; // 與搜尋框寬度一致

    searchResults.style.display = 'grid';
    console.log(`Found ${results.length} search results.`);

    results.forEach(f => {
      const name = f.name || '未命名';
      // 確保 f.geometry.coordinates 是有效的陣列且至少有兩個元素
      const [lon, lat] = f.geometry.coordinates;
      if (typeof lat === 'number' && typeof lon === 'number') {
          const item = document.createElement('div');
          item.className = 'result-item';
          item.textContent = name;
          item.title = name;
          item.addEventListener('click', () => {
            const originalLatLng = L.latLng(lat, lon);
            map.setView(originalLatLng, 16);
            createNavButton(originalLatLng, name);
            searchResults.style.display = 'none';
            searchBox.value = '';
            console.log(`Clicked search result: ${name}, zooming to map.`);
          });
          searchResults.appendChild(item);
      } else {
          console.warn(`Invalid coordinates for feature: ${name}`, f.geometry.coordinates);
      }
    });
  } else {
    searchResults.style.display = 'none';
  }
});

// 點擊搜尋結果框外部時隱藏搜尋結果
document.addEventListener('click', (event) => {
    if (!searchResults.contains(event.target) && event.target !== searchBox) {
        searchResults.style.display = 'none';
    }
});
// 監聽 ESC 鍵以隱藏搜尋結果
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        searchResults.style.display = 'none';
    }
});


// 導航按鈕創建邏輯
function createNavButton(latLng, name) {
    const container = document.querySelector('.nav-buttons-container');
    // 檢查是否已有相同目標的導航按鈕
    if (container.querySelector(`[data-lat="${latLng.lat}"][data-lng="${latLng.lng}"]`)) {
        console.log('導航按鈕已存在。');
        return;
    }

    const button = document.createElement('button');
    button.className = 'nav-button';
    button.dataset.lat = latLng.lat;
    button.dataset.lng = latLng.lng;
    button.innerHTML = `<span class="material-symbols-outlined">near_me</span> ${name} 導航`;
    button.addEventListener('click', () => {
        // 使用 Google Maps 導航 URL
        const url = `https://www.google.com/maps/dir/?api=1&destination=${latLng.lat},${latLng.lng}&travelmode=driving`;
        window.open(url, '_blank');
        console.log(`Navigating to: ${name} at ${latLng.lat}, ${latLng.lng}`);
    });

    const closeButton = document.createElement('span');
    closeButton.className = 'material-symbols-outlined';
    closeButton.textContent = 'close';
    closeButton.style.cursor = 'pointer';
    closeButton.style.marginLeft = '10px';
    closeButton.addEventListener('click', (event) => {
        event.stopPropagation(); // 防止點擊關閉按鈕觸發導航按鈕的點擊事件
        button.remove();
        console.log('導航按鈕已移除。');
    });
    button.appendChild(closeButton);

    container.appendChild(button);
    console.log(`Created navigation button for ${name}.`);
}


// KML 匯入匯出功能
importButton.addEventListener('click', () => kmlInput.click()); // 點擊按鈕觸發文件輸入

kmlInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const kmlString = e.target.result;
        // 檢查用戶權限：只有 editor 或 owner 可以匯入 KML
        const currentUser = auth.currentUser;
        if (!currentUser) {
            alert('請先登入才能匯入 KML。');
            return;
        }
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        if (!userDoc.exists || !['editor', 'owner'].includes(userDoc.data().role)) {
            alert('您沒有權限匯入 KML。');
            return;
        }

        const kmlId = db.collection('kml').doc().id; // 生成新的 KML 文檔 ID
        await db.collection('kml').doc(kmlId).set({
            kmlString: kmlString,
            uploadedBy: currentUser.uid,
            uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert('KML 檔案已成功匯入！');
        loadKMLFromFirestore(); // 重新載入以顯示新匯入的 KML
      } catch (error) {
        console.error('匯入 KML 失敗:', error);
        alert('匯入 KML 失敗：' + error.message);
      }
    };
    reader.readAsText(file);
  }
});

exportButton.addEventListener('click', async () => {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        alert('請先登入才能匯出 KML。');
        return;
    }
    const userDoc = await db.collection('users').doc(currentUser.uid).get();
    if (!userDoc.exists || !['editor', 'owner'].includes(userDoc.data().role)) {
        alert('您沒有權限匯出 KML。');
        return;
    }

    // 獲取所有 KML 文檔
    const snapshot = await db.collection('kml').get();
    let combinedKmlStrings = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>Exported KML Data</name>\n';

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.kmlString) {
        // 只添加 <Placemark> 內的內容，如果整個 KML 文件都被存儲
        // 這需要更精確的KML解析來提取Placemark
        // 簡單處理：假設每個 Firestore 文檔的 kmlString 都是一個完整的 KML 或包含 Placemark
        // 如果您的 KML 字串已經是完整的 KML 文件，您需要調整此處的合併邏輯
        combinedKmlStrings += data.kmlString.replace(/<\?xml[^>]*>/, '').replace(/<kml[^>]*>/, '').replace(/<\/kml>/, '').replace(/<Document[^>]*>/, '').replace(/<\/Document>/, '');
      }
    });

    combinedKmlStrings += '  </Document>\n</kml>';

    if (snapshot.size > 0) {
        const blob = new Blob([combinedKmlStrings], { type: 'application/vnd.google-earth.kml+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'exported_map_data.kml';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert('KML 檔案已成功匯出！');
    } else {
        alert('沒有可匯出的 KML 資料。');
    }
  } catch (error) {
    console.error('匯出 KML 失敗:', error);
    alert('匯出 KML 失敗：' + error.message);
  }
});


// KML 資料載入函數
async function loadKMLFromFirestore() {
    kmlFeatures.clearLayers(); // 清除現有地圖上的 KML 層
    allKmlData = []; // 清空搜尋資料

    try {
        // KML 集合的讀取權限在 rules 中設定為 'if request.auth != null'
        const snapshot = await db.collection('kml').get();
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.kmlString) {
                // 將 KML 字串添加到地圖
                const geojson = omnivore.kml.parse(data.kmlString);
                geojson.eachLayer(layer => {
                    kmlFeatures.addLayer(layer);
                    // 為搜尋儲存 KML 特徵的名稱和幾何資訊
                    if (layer.feature && layer.feature.properties && layer.feature.geometry) {
                        allKmlData.push({
                            name: layer.feature.properties.name || '未命名地標',
                            geometry: layer.feature.geometry
                        });
                    }
                });
            }
        });
        console.log('KML 資料從 Firestore 載入成功。');
    } catch (error) {
        console.error('從 Firestore 載入 KML 資料失敗:', error);
        alert('載入 KML 資料失敗：' + error.message);
    }
}

// 首次載入頁面時嘗試載入 KML (即使未登入，只讀取公開 KML)
// 但因為 rules 設定為 'if request.auth != null'，所以必須登入才能看到 KML
// 真正的 KML 載入會在地圖 v4.1.0 的 onAuthStateChanged 監聽器中觸發