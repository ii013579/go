// map-logic.js (恢復 v1.9.6 繪製邏輯並修正初始化)

// 1. 初始化地圖
window.map = L.map('map').setView([25.06, 121.23], 13); // 預設位置
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(window.map);

window.allKmlFeatures = []; // 儲存所有點位供搜尋使用
window.currentKmlLayerId = null; 
let currentLayerInstance = null; // 記錄當前圖層以便更換時移除

// 2. 更新下拉選單函式
window.updateKmlLayerSelects = async function() {
    const kmlRef = window.db.collection('artifacts').doc(window.appId)
        .collection('public').doc('data').collection('kmlLayers');
    
    try {
        const snapshot = await kmlRef.get();
        const select = document.getElementById('kmlLayerSelect');
        const dashSelect = document.getElementById('kmlLayerSelectDashboard');
        
        const optionsHTML = ['<option value="">-- 請選擇 KML --</option>'];
        snapshot.forEach(doc => {
            optionsHTML.push(`<option value="${doc.id}">${doc.data().name}</option>`);
        });

        if (select) select.innerHTML = optionsHTML.join('');
        if (dashSelect) dashSelect.innerHTML = optionsHTML.join('');
        
        // 檢查是否有圖釘釘選的圖層
        const pinnedId = localStorage.getItem('pinnedKmlId');
        if (pinnedId && select) {
            select.value = pinnedId;
            window.loadKmlLayerFromFirestore(pinnedId);
        }
    } catch (error) {
        console.error("更新選單失敗:", error);
    }
};

// 3. 從 Firestore 載入 KML 並繪製
window.loadKmlLayerFromFirestore = async function(kmlId) {
    if (!kmlId) return;
    window.currentKmlLayerId = kmlId;
    
    window.showMessage("載入中", "正在從資料庫讀取點位...");

    try {
        const doc = await window.db.collection('artifacts').doc(window.appId)
            .collection('public').doc('data').collection('kmlLayers').doc(kmlId).get();
        
        if (!doc.exists) return;
        const data = doc.data();
        const geojson = JSON.parse(data.geojson);
        
        // 清除舊圖層
        if (currentLayerInstance) window.map.removeLayer(currentLayerInstance);
        window.allKmlFeatures = geojson.features; // 更新快取供搜尋用

        // 繪製新圖層
        currentLayerInstance = L.geoJSON(geojson, {
            pointToLayer: (feature, latlng) => {
                // 恢復 v1.9.6 的紅點樣式
                const marker = L.circleMarker(latlng, {
                    radius: 8,
                    fillColor: "#ff4d4d", // 較鮮豔的紅
                    color: "#fff",
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.9
                });
                
                // 綁定永久顯示的文字標籤
                marker.bindTooltip(feature.properties.name || "", {
                    permanent: true, 
                    direction: 'right',
                    offset: [10, 0],
                    className: 'marker-label-v196'
                });

                // 點擊觸發清查面板 (survey-logic.js)
                marker.on('click', () => {
                    if(window.openSurveyPanel) window.openSurveyPanel(feature, latlng);
                });

                return marker;
            }
        }).addTo(window.map);

        // 自動縮放至圖層範圍
        const bounds = currentLayerInstance.getBounds();
        if (bounds.isValid()) window.map.fitBounds(bounds);
        
        window.hideMessage(); // 關閉載入提示
    } catch (error) {
        window.showMessage("錯誤", "載入圖層失敗: " + error.message);
    }
};

// 4. 監聽選單切換事件
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('kmlLayerSelect')?.addEventListener('change', (e) => {
        window.loadKmlLayerFromFirestore(e.target.value);
    });
});