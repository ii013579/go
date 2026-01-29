// map-renderer.js v2.0 (地圖渲染引擎)
(function () {
    'use strict';
    const layers = window.mapLayers; // 來自 map-core.js

    // --- 核心演算法：質心與中點 ---
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
        const { markers, geoJsonLayers, navButtons, map } = window.mapLayers;
        [markers, geoJsonLayers, navButtons].forEach(l => l.clearLayers());

        features.forEach(f => {
            if (f.geometry.type === 'Point') {
                const [lon, lat] = f.geometry.coordinates;
                const dot = L.marker([lat, lon], { icon: L.divIcon({ className: 'custom-dot-icon', iconSize:[16,16] }) }).addTo(markers);
                dot.on('click', () => window.createNavButton([lat, lon], f.properties.name));
            } else {
                const layer = L.geoJSON(f).addTo(geoJsonLayers);
                layer.on('click', () => {
                    const cp = f.geometry.type === 'Polygon' ? window.getPolygonCentroid(f.geometry.coordinates) : null;
                    if (cp) window.createNavButton([cp[1], cp[0]], f.properties.name);
                });
            }
        });
        map.fitBounds(L.featureGroup([markers, geoJsonLayers]).getBounds());
    };

    window.createNavButton = function (latlng, name) {
        window.mapLayers.navButtons.clearLayers();
        L.marker(latlng, {
            icon: L.divIcon({ className: 'nav-button-icon', html: `<div class="nav-button-content">??</div>`, iconSize: [50, 50] })
        }).addTo(window.mapLayers.navButtons).on('click', () => window.open(`https://www.google.com/maps/dir/?api=1&destination=${latlng[0]},${latlng[1]}`, '_blank'));
    };
})();