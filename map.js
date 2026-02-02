// map.js
// 地圖初始化、紅點/灰點、導航、addGeoJsonLayers、clearAllKmlLayers
// 來源改寫自 map-logic.js

(function () {
  'use strict';

  // 命名空間（內部狀態）
  const ns = {
    map: null,
    markers: L.featureGroup(),
    navButtons: L.featureGroup(),
    geoJsonLayers: L.featureGroup()
  };

  // 初始化地圖（在 DOMContentLoaded 時執行）
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof L === 'undefined') {
      console.error('Leaflet 未載入，無法初始化地圖。');
      return;
    }

    ns.map = L.map('map', {
      attributionControl: true,
      zoomControl: false,
      maxZoom: 25,
      minZoom: 5
    }).setView([23.6, 120.9], 8);

    // 範例 baseLayers（可依需求擴充）
    const baseLayers = {
      'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        attribution: 'Google Maps',
        maxZoom: 25,
        maxNativeZoom: 20
      })
    };

    baseLayers['Google 街道圖'].addTo(ns.map);

    // 加入控制圖層 group
    ns.geoJsonLayers.addTo(ns.map);
    ns.markers.addTo(ns.map);
  });

  // 在地圖上加入 GeoJSON features（features 是 GeoJSON Feature 陣列）
  window.addGeoJsonLayers = function (features) {
    if (!Array.isArray(features) || features.length === 0) {
      console.info('addGeoJsonLayers: 沒有 features 可加入。');
      return;
    }

    // 清除先前的 geoJsonLayers
    ns.geoJsonLayers.clearLayers();

    features.forEach((f) => {
      try {
        const g = L.geoJSON(f, {
          onEachFeature: function (feature, layer) {
            // 若 feature.properties 有 popup 內容可在此處處理
            if (feature.properties && feature.properties.popup) {
              layer.bindPopup(feature.properties.popup);
            }
          },
          pointToLayer: function (feature, latlng) {
            // 依照 properties 判定紅點/灰點或其他樣式
            const isMarked = feature.properties && feature.properties._isMarked;
            const className = isMarked ? 'red-marker' : 'gray-marker';
            return L.circleMarker(latlng, { radius: 6, className });
          }
        });
        ns.geoJsonLayers.addLayer(g);
      } catch (err) {
        console.warn('處理 feature 時發生錯誤：', err, feature);
      }
    });

    // 自動 fit bounds（若 map 有範圍）
    try {
      const allLayers = L.featureGroup([ns.geoJsonLayers, ns.markers]);
      const bounds = allLayers.getBounds();
      if (bounds && bounds.isValid && bounds.isValid()) {
        ns.map.fitBounds(bounds, { padding: L.point(50, 50) });
      }
    } catch (err) {
      // ignore
    }
  };

  // 清除所有 KML/GeoJSON 圖層與 marker
  window.clearAllKmlLayers = function () {
    if (ns.geoJsonLayers) ns.geoJsonLayers.clearLayers();
    if (ns.markers) ns.markers.clearLayers();
    console.info('所有 KML 圖層和相關數據已清除。');
  };

  // 導航按鈕示意（可擴充）
  window.addNavButton = function (label, onClick) {
    // 建立一個簡單的 DOM 按鈕並加入到地圖 container
    const btn = L.control({ position: 'topright' });
    btn.onAdd = function () {
      const el = L.DomUtil.create('button', 'map-nav-button');
      el.textContent = label;
      el.onclick = onClick;
      return el;
    };
    btn.addTo(ns.map);
    ns.navButtons.addLayer(btn);
    return btn;
  };

  // 對外暴露內部（debug）
  window._mapModule = ns;
})();