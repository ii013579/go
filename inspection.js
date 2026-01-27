// inspection.js v2.0
// 專責：清查模式 UI 與彈窗（功能待擴充）

window.isInspectionMode = false;

/* ===== 清查模式切換 ===== */
function toggleInspectionMode() {
  const btn = document.getElementById('inspectionToggleBtn');

  window.isInspectionMode = !window.isInspectionMode;

  if (window.isInspectionMode) {
    btn.textContent = '關閉清查';
    btn.classList.remove('inspection-off');
    btn.classList.add('inspection-on');
  } else {
    btn.textContent = '開啟清查';
    btn.classList.remove('inspection-on');
    btn.classList.add('inspection-off');
  }

  // ⚠️ v2.0：這裡不做任何 map 操作
}

/* ===== 對外提供：開啟清查視窗 ===== */
window.openInspectionModal = function (featureId, labelText) {
  const modal = document.getElementById('inspectionModalOverlay');
  const title = document.getElementById('inspectionModalTitle');

  title.textContent = `點號：${labelText || featureId || ''}`;
  modal.classList.add('visible');
};

/* ===== 關閉視窗 ===== */
function closeInspectionModal() {
  document
    .getElementById('inspectionModalOverlay')
    .classList.remove('visible');
}

/* ===== 綁定事件 ===== */
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('inspectionToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleInspectionMode);
  }

  document
    .getElementById('inspectionCancelBtn')
    ?.addEventListener('click', closeInspectionModal);

  document
    .getElementById('inspectionSubmitBtn')
    ?.addEventListener('click', () => {
      // v2.0 先只關窗
      closeInspectionModal();
    });
});

