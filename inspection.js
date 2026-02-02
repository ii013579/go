// inspection.js
// 清查模式、鉛筆、modal（UI 事件與狀態），資料寫入委由 inspection-buffer.js 處理

(function () {
  'use strict';

  // 是否為清查模式
  let isInspectionMode = false;
  let pencilLayer = null;

  // 切換清查模式
  window.toggleInspectionMode = function (enable) {
    isInspectionMode = (typeof enable === 'boolean') ? enable : !isInspectionMode;
    document.body.classList.toggle('inspection-mode', isInspectionMode);
    document.dispatchEvent(new CustomEvent('inspection:mode-changed', { detail: { enabled: isInspectionMode } }));
  };

  // 啟動鉛筆/繪製點（示意）
  window.startPencil = function () {
    if (!isInspectionMode) {
      console.warn('需先啟用清查模式才能使用鉛筆。');
      return;
    }
    if (!window._mapModule || !window._mapModule.map) {
      console.warn('地圖尚未初始化。');
      return;
    }
    const map = window._mapModule.map;

    // 建立一個圖層來暫存繪圖點
    if (!pencilLayer) pencilLayer = L.featureGroup().addTo(map);

    const onClick = function (e) {
      const latlng = e.latlng;
      const feature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [latlng.lng, latlng.lat] },
        properties: { createdAt: Date.now() }
      };

      // 發送事件給 buffer 模組（若存在）
      if (window.inspectionBuffer && typeof window.inspectionBuffer.addPoint === 'function') {
        window.inspectionBuffer.addPoint(feature);
      }

      // 顯示在地圖上（臨時）
      const marker = L.circleMarker(latlng, { radius: 6, className: 'inspection-point' });
      marker.addTo(pencilLayer);

      // 可打開 modal 讓 user 輸入 notes（透過 ui.js ）
      window.showInspectionModal && window.showInspectionModal(feature);
    };

    map.on('click', onClick);

    // 暫存 handler 以便 later remove（簡化版）
    pencilLayer._clickHandler = onClick;
    document.dispatchEvent(new CustomEvent('inspection:started'));
  };

  // 停止鉛筆
  window.stopPencil = function () {
    if (!pencilLayer || !window._mapModule || !window._mapModule.map) return;
    const map = window._mapModule.map;
    if (pencilLayer._clickHandler) {
      map.off('click', pencilLayer._clickHandler);
      delete pencilLayer._clickHandler;
    }
    pencilLayer.clearLayers();
    document.dispatchEvent(new CustomEvent('inspection:stopped'));
  };

})();