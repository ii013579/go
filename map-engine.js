/**
 * map-engine.js
 * 權責：地圖初始化、四種底圖管理、紅點與導航按鈕渲染
 */

const MapEngine = (function () {
    'use strict';

    const ns = {
        map: null,
        markers: L.featureGroup(),
        geoJsonLayers: L.featureGroup(),
    };

    const init = () => {
        if (typeof L === 'undefined') return;

        // 1. 初始化地圖實例
        ns.map = L.map('map', {
            attributionControl: true,
            zoomControl: false,
            maxZoom: 25,
            minZoom: 5
        }).setView([23.6, 120.9], 8);

        // 2. 定義四種底圖 (完整保留)
        const baseLayers = {
            'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
                attribution: 'Google Maps'
            }),
            'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
                attribution: 'Google Maps'
            }),
            'Google 地形圖': L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
                attribution: 'Google Maps'
            }),
            'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: 'OpenStreetMap'
            })
        };

        // 3. 讀取上次選擇的底圖紀錄
        const savedLayerName = localStorage.getItem('selectedBaseLayer') || 'Google 街道圖';
        const initialLayer = baseLayers[savedLayerName] || baseLayers['Google 街道圖'];
        initialLayer.addTo(ns.map);

        // 4. 加入底圖切換控制項
        L.control.layers(baseLayers, null, { position: 'topright' }).addTo(ns.map);

        // 監聽底圖切換並儲存偏好
        ns.map.on('baselayerchange', (e) => {
            localStorage.setItem('selectedBaseLayer', e.name);
        });

        // 5. 將標記群組加入地圖
        ns.markers.addTo(ns.map);
        ns.geoJsonLayers.addTo(ns.map);

        _initLocateControl();
        
        // 為了相容 ui-interactions.js 的搜尋功能
        window.map = ns.map;
    };

    // 定位按鈕 (Locate Me)
    const _initLocateControl = () => {
        const LocateControl = L.Control.extend({
            options: { position: 'bottomright' },
            onAdd: function() {
                const btn = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
                btn.innerHTML = '<span class="material-symbols-outlined" style="line-height:30px;">my_location</span>';
                btn.onclick = () => ns.map.locate({ setView: true, maxZoom: 16 });
                return btn;
            }
        });
        ns.map.addControl(new LocateControl());
        
        ns.map.on('locationfound', (e) => {
            L.circle(e.latlng, e.accuracy / 2).addTo(ns.map);
            L.marker(e.latlng).addTo(ns.map).bindPopup("您的位置").openPopup();
        });
    };

    /**
     * 渲染圖徵：保留紅點 (marker-pin) 與導航按鈕 (nav-button)
     */
    const renderGeoJsonToMap = (features) => {
        ns.markers.clearLayers();
        ns.geoJsonLayers.clearLayers();

        features.forEach(feature => {
            if (feature.geometry && feature.geometry.type === 'Point') {
                const [lng, lat] = feature.geometry.coordinates;
                const props = feature.properties;
                const name = props.name || '未命名點位';

                // 紅點 + 文字標籤
                const customIcon = L.divIcon({
                    className: 'custom-div-icon',
                    html: `
                        <div class="marker-pin"></div>
                        <div class="marker-label">${name}</div>
                    `,
                    iconSize: [30, 42],
                    iconAnchor: [15, 42]
                });

                const marker = L.marker([lat, lng], { icon: customIcon });

                // Popup 內容與導航按鈕
                const popupContent = `
                    <div class="popup-content">
                        <div class="popup-title">${name}</div>
                        <div class="popup-info">座標: ${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
                        <div class="popup-actions">
                            <button class="nav-button" onclick="window.open('https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}', '_blank')">
                                <span class="material-symbols-outlined">directions</span>
                                導航
                            </button>
                        </div>
                    </div>
                `;
                
                marker.bindPopup(popupContent);
                ns.markers.addLayer(marker);
            }
        });

        // 自動縮放至點位範圍
        if (ns.markers.getLayers().length > 0) {
            const bounds = ns.markers.getBounds();
            if (bounds.isValid()) ns.map.fitBounds(bounds, { padding: [50, 50] });
        }
    };

    // --- 全域介面 (Bridge) ---
    window.renderGeoJsonToMap = (kmlData, kmlId) => {
        try {
            let geojson = kmlData.geojson;
            if (typeof geojson === 'string') geojson = JSON.parse(geojson);
            const features = (geojson?.features || []).filter(f => f?.geometry);

            window.allKmlFeatures = features; // 供搜尋使用
            renderGeoJsonToMap(features);
        } catch (e) {
            console.error("Map Rendering Error:", e);
        }
    };

    return { init };
})();

// 初始化
document.addEventListener('DOMContentLoaded', MapEngine.init);