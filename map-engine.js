/**
 * map-engine.js - v1.9.6 視覺與排列對齊版
 */
const MapEngine = (function () {
    'use strict';
    const ns = { map: null, markers: L.featureGroup() };

    const init = () => {
        ns.map = L.map('map', { zoomControl: false, maxZoom: 25 }).setView([23.6, 120.9], 8);

        // 1. 縮放按鈕 (TopRight)
        L.control.zoom({ position: 'topright' }).addTo(ns.map);

        // 2. 定位按鈕 (TopRight)
        const LocateCtrl = L.Control.extend({
            options: { position: 'topright' },
            onAdd: function() {
                const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
                div.innerHTML = '<span class="material-symbols-outlined" style="line-height:30px; display:block; text-align:center;">my_location</span>';
                div.onclick = () => ns.map.locate({ setView: true, maxZoom: 16 });
                return div;
            }
        });
        ns.map.addControl(new LocateCtrl());

        // 3. 圖層控制 (TopRight)
        const baseLayers = {
            'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'),
            'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'),
            'Google 地形圖': L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}'),
            'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
        };
        baseLayers['Google 街道圖'].addTo(ns.map);
        L.control.layers(baseLayers, null, { position: 'topright' }).addTo(ns.map);

        ns.markers.addTo(ns.map);
        window.map = ns.map;
    };

    window.renderGeoJsonToMap = (data) => {
        ns.markers.clearLayers();
        const geo = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson;
        window.allKmlFeatures = geo.features;

        geo.features.forEach(f => {
            if (f.geometry.type === 'Point') {
                const [lng, lat] = f.geometry.coordinates;
                const name = f.properties.name || '未命名';
                
                // 嚴格對照 style.css: .marker-pin 與 .marker-label
                const marker = L.marker([lat, lng], {
                    icon: L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div class="marker-pin"></div><div class="marker-label">${name}</div>`,
                        iconSize: [30, 42], iconAnchor: [15, 42]
                    })
                });

                // 修正：導航按鈕樣式
                const popupHtml = `
                    <div class="popup-content">
                        <div class="popup-title">${name}</div>
                        <button class="nav-button" onclick="window.open('https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}', '_blank')">
                            <span class="material-symbols-outlined">directions</span>導航
                        </button>
                    </div>`;
                marker.bindPopup(popupHtml);
                ns.markers.addLayer(marker);
            }
        });
        if (ns.markers.getLayers().length > 0) ns.map.fitBounds(ns.markers.getBounds(), { padding: [50, 50] });
    };

    return { init };
})();
document.addEventListener('DOMContentLoaded', MapEngine.init);