// map.js
(function () {
  'use strict';

  const ns = {
    map: null,
    baseLayers: {},
    geoJsonLayers: L.featureGroup(),
    markers: L.featureGroup(),
    navButtons: L.featureGroup(),
    allFeatures: []
  };

  /* ---------------- 初始化地圖 ---------------- */

  function initMap() {
    ns.map = L.map('map', {
      zoomControl: false,
      maxZoom: 25,
      minZoom: 5
    }).setView([23.6, 120.9], 8);

    ns.baseLayers = {
      'Google 街道圖': L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 25, maxNativeZoom: 20
      }),
      'Google 衛星圖': L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        maxZoom: 25, maxNativeZoom: 20
      }),
      'Google 地形圖': L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
        maxZoom: 25, maxNativeZoom: 20
      }),
      'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 25, maxNativeZoom: 20
      })
    };

    const lastLayer = localStorage.getItem('lastBaseLayer');
    (ns.baseLayers[lastLayer] || ns.baseLayers['Google 街道圖']).addTo(ns.map);

    ns.geoJsonLayers.addTo(ns.map);
    ns.markers.addTo(ns.map);
    ns.navButtons.addTo(ns.map);

    L.control.zoom({ position: 'topright' }).addTo(ns.map);

    const layerCtrl = L.control.layers(ns.baseLayers, null, { position: 'topright' }).addTo(ns.map);
    ns.map.on('baselayerchange', e => {
      localStorage.setItem('lastBaseLayer', e.name);
      layerCtrl.getContainer()?.classList.remove('leaflet-control-layers-expanded');
    });

    initLocateControl();
  }

  /* ---------------- 使用者定位 ---------------- */

  function initLocateControl() {
    const Locate = L.Control.extend({
      _watchId: null,
      _marker: null,
      _circle: null,
      _active: false,

      onAdd() {
        const btn = L.DomUtil.create('a', 'leaflet-bar');
        btn.innerHTML = '??';
        btn.href = '#';
        btn.onclick = e => {
          e.preventDefault();
          this._active ? this.stop() : this.start();
        };
        return btn;
      },

      start() {
        if (!navigator.geolocation) return alert('不支援定位');
        this._active = true;

        this._watchId = navigator.geolocation.watchPosition(pos => {
          const latlng = [pos.coords.latitude, pos.coords.longitude];
          const acc = pos.coords.accuracy;

          if (!this._marker) {
            ns.map.setView(latlng, 16);
          }

          this._clear();
          this._marker = L.marker(latlng).addTo(ns.map);
          this._circle = L.circle(latlng, acc / 2).addTo(ns.map);
        }, err => {
          alert(err.message);
          this.stop();
        }, { enableHighAccuracy: true });
      },

      stop() {
        navigator.geolocation.clearWatch(this._watchId);
        this._watchId = null;
        this._active = false;
        this._clear();
      },

      _clear() {
        if (this._marker) ns.map.removeLayer(this._marker);
        if (this._circle) ns.map.removeLayer(this._circle);
        this._marker = this._circle = null;
      }
    });

    new Locate({ position: 'topright' }).addTo(ns.map);
  }

  /* ---------------- GeoJSON 渲染 ---------------- */

  function render(features) {
    clear();

    const points = [];
    const linesPolygons = [];

    features.forEach(f => {
      if (f.geometry?.type === 'Point') points.push(f);
      else linesPolygons.push(f);
    });

    if (linesPolygons.length) {
      L.geoJSON(linesPolygons, {
        style: f =>
          f.geometry.type === 'Polygon'
            ? { color: '#0044cc', weight: 2, fillOpacity: 0.3 }
            : { color: '#ff0000', weight: 3 },
        onEachFeature: onFeature
      }).addTo(ns.geoJsonLayers);
    }

    points.forEach(drawPoint);

    ns.allFeatures = features;
    window.allKmlFeatures = features;

    try {
      const bounds = ns.geoJsonLayers.getBounds();
      if (bounds.isValid()) ns.map.fitBounds(bounds);
    } catch {}
  }

  function onFeature(feature, layer) {
    layer.on('click', e => {
      e.originalEvent.stopPropagation();
      const name = feature.properties?.name || '未命名';

      let center = null;
      if (feature.geometry.type === 'Polygon') {
        center = centroid(feature.geometry.coordinates[0]);
      } else if (feature.geometry.type === 'LineString') {
        center = midpoint(feature.geometry.coordinates);
      }

      if (center) createNavButton([center[1], center[0]], name);
    });

    if (feature.geometry.type === 'Polygon' && feature.properties?.name) {
      const c = centroid(feature.geometry.coordinates[0]);
      if (c) {
        L.marker([c[1], c[0]], {
          icon: L.divIcon({
            className: 'marker-label',
            html: `<span>${feature.properties.name}</span>`
          }),
          interactive: false
        }).addTo(ns.geoJsonLayers);
      }
    }
  }

  function drawPoint(f) {
    const [lon, lat] = f.geometry.coordinates;
    const name = f.properties?.name || '未命名';
    const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');

    const dot = L.marker([lat, lon]).addTo(ns.markers);
    const label = L.marker([lat, lon], {
      icon: L.divIcon({
        className: 'marker-label',
        html: `<span id="${labelId}">${name}</span>`
      }),
      interactive: false
    }).addTo(ns.markers);

    dot.on('click', e => {
      e.originalEvent.stopPropagation();
      document.querySelectorAll('.marker-label span').forEach(el => el.classList.remove('label-active'));
      document.getElementById(labelId)?.classList.add('label-active');
      createNavButton([lat, lon], name);
    });
  }

  /* ---------------- 導航 ---------------- */

  function createNavButton(latlng, name) {
    ns.navButtons.clearLayers();
    const url = `https://maps.google.com/?q=${latlng[0]},${latlng[1]}`;

    const btn = L.marker(latlng, {
      icon: L.divIcon({
        className: 'nav-button-icon',
        html: '??',
        iconSize: [40, 40]
      })
    }).addTo(ns.navButtons);

    btn.on('click', () => window.open(url, '_blank'));
    ns.map.panTo(latlng);
  }

  /* ---------------- 輔助數學 ---------------- */

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
    return area ? [x / (6 * area), y / (6 * area)] : null;
  }

  function midpoint(coords) {
    const mid = Math.floor(coords.length / 2);
    return coords[mid];
  }

  function clear() {
    ns.geoJsonLayers.clearLayers();
    ns.markers.clearLayers();
    ns.navButtons.clearLayers();
    ns.allFeatures = [];
    window.allKmlFeatures = [];
  }

  /* ---------------- 對外 API ---------------- */

  window.MAP = {
    init: initMap,
    render,
    clear
  };

  document.addEventListener('DOMContentLoaded', initMap);
})();
