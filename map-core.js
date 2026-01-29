// map-core.js v2.0 (地圖基礎)
(function () {
    'use strict';
    const ns = {
        map: null,
        markers: L.featureGroup(),
        geoJsonLayers: L.featureGroup(),
        navButtons: L.featureGroup()
    };

    window.MapCore = {
        init: function() {
            ns.map = L.map('map', { attributionControl: true, zoomControl: false, maxZoom: 25, minZoom: 5 }).setView([23.6, 120.9], 8);
            
            const baseLayers = {
                'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 25, maxNativeZoom: 20 }),
                'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 25, maxNativeZoom: 20 }),
                'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 25, maxNativeZoom: 20 })
            };

            const lastLayer = localStorage.getItem('lastBaseLayer') || 'Google 街道圖';
            (baseLayers[lastLayer] || baseLayers['Google 街道圖']).addTo(ns.map);

            ns.geoJsonLayers.addTo(ns.map); ns.markers.addTo(ns.map); ns.navButtons.addTo(ns.map);
            L.control.zoom({ position: 'topright' }).addTo(ns.map);
            L.control.layers(baseLayers, null, { position: 'topright' }).addTo(ns.map);

            ns.map.on('baselayerchange', e => localStorage.setItem('lastBaseLayer', e.name));
            
            // 地圖點擊全域事件：清空 UI 狀態
            ns.map.on('click', () => {
                document.getElementById('searchResults').style.display = 'none';
                document.querySelectorAll('.marker-label span.label-active').forEach(el => el.classList.remove('label-active'));
                ns.navButtons.clearLayers();
            });

            window.map = ns.map;
            window.mapLayers = ns;
        }
    };
    document.addEventListener('DOMContentLoaded', () => window.MapCore.init());
})();