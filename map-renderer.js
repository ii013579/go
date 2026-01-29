// map-renderer.js v2.0
(function () {
    'use strict';

    // 質心計算法 (用於點擊多邊形時導航按鈕出現的位置)
    window.getPolygonCentroid = function(coords) {
        let area = 0, x = 0, y = 0;
        const pts = coords[0] || coords;
        for (let i = 0, len = pts.length; i < len; i++) {
            const p1 = pts[i], p2 = pts[(i + 1) % len];
            const f = p1[0] * p2[1] - p2[0] * p1[1];
            area += f; x += (p1[0] + p2[0]) * f; y += (p1[1] + p2[1]) * f;
        }
        area /= 2;
        return [x / (6 * area), y / (6 * area)];
    };

    window.addGeoJsonLayers = function (features) {
        if (!window.mapLayers) return;
        const { markers, geoJsonLayers, navButtons, map } = window.mapLayers;
        
        markers.clearLayers();
        geoJsonLayers.clearLayers();
        navButtons.clearLayers();

        features.forEach(f => {
            const name = f.properties.name || "未命名";
            
            if (f.geometry.type === 'Point') {
                const [lon, lat] = f.geometry.coordinates;
                // 1. 建立紅色圓點 (對應您的 CSS .custom-dot-icon)
                const marker = L.marker([lat, lon], {
                    icon: L.divIcon({ 
                        className: 'custom-dot-icon', 
                        iconSize: [10, 10], 
                        iconAnchor: [5, 5] 
                    })
                }).addTo(markers);
                
                // 2. 補回文字標籤 (對應截圖樣式)
                // 使用 permanent: true 讓它一直顯示，className 套用 CSS 樣式
                marker.bindTooltip(name, { 
                    permanent: true, 
                    direction: 'right', 
                    className: 'feature-label', // 若您的 CSS 是 .marker-label span，請改用該類別
                    offset: [10, 0],
                    opacity: 0.9
                });

                marker.on('click', () => window.createNavButton([lat, lon], name));

            } else {
                // 多邊形或線段
                const layer = L.geoJSON(f, {
                    style: { color: '#2193b0', weight: 3, fillOpacity: 0.2 }
                }).addTo(geoJsonLayers);
                
                // 多邊形標籤通常滑鼠移上去才顯示 (sticky: true)
                layer.bindTooltip(name, { 
                    sticky: true, 
                    className: 'feature-label' 
                });
                
                layer.on('click', (e) => {
                    // 若是多邊形則計算質心，否則取點擊處
                    let center = e.latlng;
                    if (f.geometry.type === 'Polygon') {
                        const cp = window.getPolygonCentroid(f.geometry.coordinates);
                        if (cp) center = [cp[1], cp[0]];
                    }
                    window.createNavButton(center, name);
                });
            }
        });

        const bounds = L.featureGroup([markers, geoJsonLayers]).getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
    };

    window.createNavButton = function (latlng, name) {
        window.mapLayers.navButtons.clearLayers();
        // 建立導航圖示 (對應您的 CSS .nav-button-icon)
        L.marker(latlng, {
            icon: L.divIcon({ 
                className: 'nav-button-icon', 
                html: '<div class="nav-button-content">??</div>', 
                iconSize: [40, 40], 
                iconAnchor: [20, 20] 
            })
        }).addTo(window.mapLayers.navButtons).on('click', () => {
            // 轉換為座標陣列確保格式正確
            const lat = Array.isArray(latlng) ? latlng[0] : latlng.lat;
            const lng = Array.isArray(latlng) ? latlng[1] : latlng.lng;
            window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
        });
    };
})();