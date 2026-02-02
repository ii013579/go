// ui.js
// 純 UI（panel / button / message / modal）
// 保持簡潔的 API 供其他模組呼叫（例如 showMessage, showMessageCustom, showInspectionModal）

(function () {
  'use strict';

  // 一般訊息（簡化版）
  window.showMessage = function (title, message) {
    alert(`${title || ''}\n\n${message || ''}`);
  };

  // 自訂顯示（用原專案的 showMessageCustom API）
  window.showMessageCustom = function ({ title = '', message = '', buttonText = '確定' } = {}) {
    // 若專案有自訂 modal DOM，可在此顯示；fallback 為 alert
    const elTitle = document.getElementById('confirmationModalTitle');
    const elMsg = document.getElementById('confirmationModalMessage');
    const overlay = document.getElementById('confirmationModalOverlay');

    if (elTitle && elMsg && overlay) {
      elTitle.textContent = title;
      elMsg.textContent = message;
      overlay.style.display = 'block';
      const yes = document.getElementById('confirmYesBtn');
      if (yes) {
        yes.textContent = buttonText;
        yes.onclick = () => {
          overlay.style.display = 'none';
        };
      }
    } else {
      alert(`${title}\n\n${message}`);
    }
  };

  // 檢查 modal（inspection 用）示意：開啟一個可填寫 notes 的視窗
  window.showInspectionModal = function (feature) {
    // 可以在此填入更完善的 modal UI
    const note = prompt('輸入此檢查點的備註（可空白）：', (feature.properties && feature.properties.note) || '');
    if (note !== null) {
      feature.properties = feature.properties || {};
      feature.properties.note = note;
      // 將更新的 feature 送給 buffer
      if (window.inspectionBuffer && typeof window.inspectionBuffer.addPoint === 'function') {
        window.inspectionBuffer.addPoint(feature);
      }
    }
  };

})();