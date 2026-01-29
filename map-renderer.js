//(地圖渲染引擎)
// map-renderer.js v2.0 
(function () {
    'use strict';

    // 質心計算
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

    // 渲染 GeoJSON
    window.addGeoJsonLayers = function (features) {
        if (!window.mapLayers) return;
        const { markers, geoJsonLayers, navButtons, map } = window.mapLayers;
        
        markers.clearLayers();
        geoJsonLayers.clearLayers();
        navButtons.clearLayers();

        features.forEach(f => {
            if (f.geometry.type === 'Point') {
                const [lon, lat] = f.geometry.coordinates;
                const dot = L.marker([lat, lon], {
                    icon: L.divIcon({ className: 'custom-dot-icon', iconSize: [16, 16], iconAnchor: [8, 8] })
                }).addTo(markers);
                
                marker.bindTooltip(name, { permanent: true, direction: 'top', className: 'feature-label', offset: [0, -10] });
                marker.on('click', () => window.createNavButton([lat, lon], name));

            } else {
                const layer = L.geoJSON(f, {
                    style: { color: '#2193b0', weight: 3, fillOpacity: 0.2 }
                }).addTo(geoJsonLayers);
                
                layer.bindTooltip(name, { sticky: true, className: 'feature-label' });
                
                layer.on('click', () => {
                    const cp = f.geometry.type === 'Polygon' ? window.getPolygonCentroid(f.geometry.coordinates) : null;
                    if (cp) window.createNavButton([cp[1], cp[0]], name);
                });
            }
        });

        const bounds = L.featureGroup([markers, geoJsonLayers]).getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
    };

    window.createNavButton = function (latlng, name) {
        window.mapLayers.navButtons.clearLayers();
        L.marker(latlng, {
            icon: L.divIcon({ className: 'nav-button-icon', html: '<div class="nav-button-content">??</div>', iconSize: [50, 50], iconAnchor: [25, 25] })
        }).addTo(window.mapLayers.navButtons).on('click', () => window.open(`https://www.google.com/maps?q=${latlng[0]},${latlng[1]}`, '_blank'));
        window.map.panTo(latlng);
    };
})();
