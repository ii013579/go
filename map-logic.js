// map-logic.js (恢復 v1.9.6 繪製邏輯)
window.loadKmlLayerFromFirestore = async function(kmlId) {
    // ... 讀取資料邏輯 ...
    const geojson = JSON.parse(data.geojson);
    
    L.geoJSON(geojson, {
        pointToLayer: (feature, latlng) => {
            // 恢復 v1.9.6 的紅點 + 標籤樣式
            const marker = L.circleMarker(latlng, {
                radius: 8,
                fillColor: "#ff7800",
                color: "#000",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });
            
            // 綁定名稱標籤
            marker.bindTooltip(feature.properties.name || "", {
                permanent: true, 
                direction: 'right',
                className: 'marker-label-v196'
            });

            // 點擊觸發 survey-logic
            marker.on('click', () => {
                if(window.openSurveyPanel) window.openSurveyPanel(feature, latlng);
            });

            return marker;
        }
    }).addTo(window.map);
};