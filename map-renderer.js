// map-renderer.js v2.0
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
        if (!window.mapLayers) {
            console.error("地圖圖層未初始化 (window.mapLayers 不存在)");
            return;
        }
        
        const { markers, geoJsonLayers, navButtons, map } = window.mapLayers;
        
        // 清除舊圖層
        markers.clearLayers();
        geoJsonLayers.clearLayers();
        navButtons.clearLayers();

        features.forEach(f => {
            const name = f.properties.name || "未命名";
            
            if (f.geometry.type === 'Point') {
                const [lon, lat] = f.geometry.coordinates;
                const marker = L.marker([lat, lon], {
                    icon: L.divIcon({ 
                        className: 'custom-dot-icon', 
                        iconSize: [5, 5], 
                        iconAnchor: [2.5, 2.5] 
                    })
                });

                // 標籤
                marker.bindTooltip(`<span>${name}</span>`, { 
                        permanent: true, 
                        direction: 'right', 
                        className: 'marker-label',
                        offset: [5, -5],
                        opacity: 1
                    });
                
                    marker.on('click', () => window.createNavButton([lat, lon], name));
                }

                marker.addTo(markers); // 加入叢集圖層

            } else {
                // 多邊形或線段渲染
                const layer = L.geoJson(f, {
                    style: { color: '#2193b0', weight: 3, fillOpacity: 0.2, opacity: 0.8 }
                });

                layer.bindTooltip(name, { sticky: true, className: 'feature-label' });
                
                layer.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    let center = e.latlng;
                    if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
                        const cp = window.getPolygonCentroid(f.geometry.coordinates);
                        if (cp) center = [cp[1], cp[0]];
                    }
                    window.createNavButton(center, name);
                });

                layer.addTo(geoJsonLayers);
            }
        });

        // 自動縮放至圖層範圍
        const combinedGroup = L.featureGroup([markers, geoJsonLayers]);
        const bounds = combinedGroup.getBounds();
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
        }
    };

    /**
     * 建立導航按鈕 ??
     */
    window.createNavButton = function (latlng, name) {
        if (!window.mapLayers) return;
        window.mapLayers.navButtons.clearLayers();
        
        const lat = Array.isArray(latlng) ? latlng[0] : latlng.lat;
        const lng = Array.isArray(latlng) ? latlng[1] : latlng.lng;

        L.marker([lat, lng], {
            icon: L.divIcon({ 
                className: 'nav-button-icon', 
                html: '<div class="nav-button-content">??</div>', 
                iconSize: [44, 44], 
                iconAnchor: [22, 22] 
            })
        }).addTo(window.mapLayers.navButtons).on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
        });
        
        window.mapLayers.map.panTo([lat, lng]);
    };
})();