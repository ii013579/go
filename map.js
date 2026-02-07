// map.js
(function () {
  'use strict';

  const ns = {
    map: null,
    baseLayers: {},
    geoLayer: null,
    markerLayer: null,
    navLayer: null,
    locateControl: null
  };

  /* =========================
     初始化（只做一次）
  ========================= */

  function initMap() {
    if (ns.map) return;

    ns.map = L.map('map', {
      zoomControl: false,
      maxZoom: 25,
      minZoom: 5
    }).setView([23.7, 120.9], 8);

    initBaseLayers();
    initLayers();
    initControls();
    initLocateControl();
  }

  /* =========================
     底圖
  ========================= */

  function initBaseLayers() {
    ns.baseLayers = {
      'Google 街道圖': L.tileLayer(
        'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        { maxZoom: 25, maxNativeZoom: 20 }
      ),
      'Google 衛星圖': L.tileLayer(
        'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        { maxZoom: 25, maxNativeZoom: 20 }
      ),
      'OpenStreetMap': L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 25 }
      )
    };

    const last = localStorage.getItem('lastBaseLayer');
    (ns.baseLayers[last] || ns.baseLayers['Google 街道圖'])
      .addTo(ns.map);

    const ctrl = L.control.layers(ns.baseLayers, null, {
      position: 'topright'
    }).addTo(ns.map);

    ns.map.on('baselayerchange', e => {
      localStorage.setItem('lastBaseLayer', e.name);
      ctrl.getContainer()?.classList.remove('leaflet-control-layers-expanded');
    });
  }

  /* =========================
     圖層
  ========================= */

  function initLayers() {
    ns.geoLayer = L.featureGroup().addTo(ns.map);
    ns.markerLayer = L.featureGroup().addTo(ns.map);
    ns.navLayer = L.featureGroup().addTo(ns.map);
  }

  /* =========================
     控制項
  ========================= */

  function initControls() {
    L.control.zoom({ position: 'topright' }).addTo(ns.map);
  }

  /* =========================
     使用者定位（??）
  ========================= */

  function initLocateControl() {
    const Locate = L.Control.extend({
      onAdd() {
        const btn = L.DomUtil.create('a', 'leaflet-bar');
        btn.innerHTML = '??';
        btn.href = '#';

        L.DomEvent.on(btn, 'click', e => {
          L.DomEvent.stop(e);
          locateUser();
        });

        return btn;
      }
    });

    ns.locateControl = new Locate({ position: 'topright' });
    ns.locateControl.addTo(ns.map);
  }

  function locateUser() {
    if (!navigator.geolocation) {
      alert('瀏覽器不支援定位');
      return;
    }

    navigator.geolocation.getCurrentPosition(pos => {
      const latlng = [pos.coords.latitude, pos.coords.longitude];
      ns.map.setView(latlng, 16);

      L.circle(latlng, {
        radius: pos.coords.accuracy / 2,
        color: '#4285f4',
        fillOpacity: 0.2
      }).addTo(ns.map);
    }, err => {
      alert(err.message);
    }, { enableHighAccuracy: true });
  }

  /* =========================
     GeoJSON Render（核心）
  ========================= */

  function render(features = []) {
    clear();

    features.forEach(f => {
      const type = f.geometry?.type;

      if (type === 'Point') drawPoint(f);
      else drawShape(f);
    });

    try {
      const bounds = ns.geoLayer.getBounds();
      if (bounds.isValid()) ns.map.fitBounds(bounds);
    } catch {}
  }

  function drawPoint(feature) {
    const [lng, lat] = feature.geometry.coordinates;
    const name = feature.properties?.name || '';

    const marker = L.marker([lat, lng]).addTo(ns.markerLayer);

    if (name) {
      L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'marker-label',
          html: `<span>${name}</span>`
        }),
        interactive: false
      }).addTo(ns.markerLayer);
    }

    marker.on('click', () => createNav([lat, lng], name));
  }

  function drawShape(feature) {
    const layer = L.geoJSON(feature, {
      style: f =>
        f.geometry.type === 'Polygon'
          ? { color: '#0057ff', weight: 2, fillOpacity: 0.3 }
          : { color: '#ff0000', weight: 3 }
    }).addTo(ns.geoLayer);

    layer.on('click', e => {
      const center = getCenter(feature);
      if (center) createNav(center, feature.properties?.name);
      e.originalEvent.stopPropagation();
    });

    // Polygon label
    if (feature.geometry.type === 'Polygon' && feature.properties?.name) {
      const c = getCenter(feature);
      if (c) {
        L.marker(c, {
          icon: L.divIcon({
            className: 'marker-label',
            html: `<span>${feature.properties.name}</span>`
          }),
          interactive: false
        }).addTo(ns.geoLayer);
      }
    }
  }

  /* =========================
     導航
  ========================= */

  function createNav(latlng, name = '') {
    ns.navLayer.clearLayers();

    const url = `https://maps.google.com/?q=${latlng[0]},${latlng[1]}`;
    const btn = L.marker(latlng, {
      icon: L.divIcon({
        className: 'nav-button-icon',
        html: '??',
        iconSize: [36, 36]
      })
    }).addTo(ns.navLayer);

    btn.on('click', () => window.open(url, '_blank'));
    ns.map.panTo(latlng);
  }

  /* =========================
     幾何工具
  ========================= */

  function getCenter(feature) {
    const g = feature.geometry;
    if (g.type === 'Polygon') return centroid(g.coordinates[0]);
    if (g.type === 'LineString') return midpoint(g.coordinates);
    return null;
  }

  function centroid(coords) {
    let area = 0, x = 0, y = 0;
    for (let i = 0; i < coords.length; i++) {
      const [x0, y0] = coords[i];
      const [x1, y1] = coords[(i + 1) % coords.length];
      const a = x0 * y1 - x1 * y0;
      area += a;
      x += (x0 + x1) * a;
      y += (y0 + y1) * a;
    }
    area *= 0.5;
    return area ? [y / (6 * area), x / (6 * area)] : null;
  }

  function midpoint(coords) {
    const m = Math.floor(coords.length / 2);
    return [coords[m][1], coords[m][0]];
  }

  /* =========================
     清除
  ========================= */

  function clear() {
    ns.geoLayer.clearLayers();
    ns.markerLayer.clearLayers();
    ns.navLayer.clearLayers();
  }

  /* =========================
     對外 API
  ========================= */

  window.MAP = {
    render,
    clear
  };

  document.addEventListener('DOMContentLoaded', initMap);

})();
