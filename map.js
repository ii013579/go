// map.js v2.0
(function () {
    'use strict';

    /**
     * 質心計算演算法 (用於多邊形導航定位)
     */
    window.getPolygonCentroid = function(coords) {
        let area = 0, x = 0, y = 0;
        const pts = coords[0] || coords;
        for (let i = 0, len = pts.length; i < len; i++) {
            const p1 = pts[i], p2 = pts[(i + 1) % len];
            const f = p1[0] * p2[1] - p2[0] * p1[1];
            area += f; x += (p1[0] + p2[0]) * f; y += (p1[1] + p2[1]) * f;
        }
        area /= 2;
        if (area === 0) return pts[0]; // 防止除以零
        return [x / (6 * area), y / (6 * area)];
    };

    /**
     * 渲染 GeoJSON 圖層 (修正 marker is not defined 錯誤)
     */
    window.addGeoJsonLayers = function (features) {
        if (!window.mapLayers) return;
        const { markers, geoJsonLayers, navButtons, map } = window.mapLayers;
        
        markers.clearLayers();
        geoJsonLayers.clearLayers();
        navButtons.clearLayers();

        features.forEach(f => {
            const name = f.properties.name || "";
            if (f.geometry.type === 'Point') {
                const [lon, lat] = f.geometry.coordinates;
                // 建立紅色圓點 (對應 CSS .custom-dot-icon)
                const marker = L.marker([lat, lon], {
                    icon: L.divIcon({ 
                        className: 'custom-dot-icon', 
                        iconSize: [5, 5], 
                        iconAnchor: [2.5, 2.5] 
                    })
                }).addTo(markers);

                // 復原 v1.9.6 結構：必須包含 <span> 才能對齊 CSS [.marker-label span]
                marker.bindTooltip(`<span>${name}</span>`, {
                    permanent: true,
                    direction: 'right',
                    className: 'marker-label', 
                    offset: [10, -6],
                    opacity: 1
                });

                marker.on('click', () => window.createNavButton([lat, lon], name));
            } else {
                const layer = L.geoJSON(f, { 
                    style: { color: '#2193b0', weight: 3, fillOpacity: 0.2 } 
                }).addTo(geoJsonLayers);
                
                layer.bindTooltip(`<span>${name}</span>`, { 
                    sticky: true, 
                    className: 'marker-label' 
                });
                
                layer.on('click', (e) => window.createNavButton(e.latlng, name));
            }
        });

        const bounds = L.featureGroup([markers, geoJsonLayers]).getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
    };

    window.createNavButton = function (latlng, name) {
        if (!window.mapLayers) return;
        window.mapLayers.navButtons.clearLayers();
        const lat = Array.isArray(latlng) ? latlng[0] : latlng.lat;
        const lng = Array.isArray(latlng) ? latlng[1] : latlng.lng;

        L.marker([lat, lng], {
            icon: L.divIcon({ 
                className: 'nav-button-icon', 
                html: '<div class="nav-button-content">??</div>', 
                iconSize: [40, 40], 
                iconAnchor: [20, 20] 
            })
        }).addTo(window.mapLayers.navButtons).on('click', () => {
            window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');
        });
    };
})();