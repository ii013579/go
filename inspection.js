// inspection.js v2.0

window.isInspectionMode = false;
window.inspectionStatusMap = {};

/* ===== 切換功能 (修復邏輯) ===== */
function toggleInspectionMode() {
    const btn = document.getElementById('inspectionToggleBtn');
    if (!btn) return;

    window.isInspectionMode = !window.isInspectionMode;
    const isOn = window.isInspectionMode;

    // 1. 更新文字
    btn.textContent = isOn ? '關閉清查' : '開啟清查';

    // 2. 切換 Class (使用 replace 確保不會重複)
    if (isOn) {
        btn.classList.remove('inspection-off');
        btn.classList.add('inspection-on');
    } else {
        btn.classList.remove('inspection-on');
        btn.classList.add('inspection-off');
    }
    
    console.log("清查模式已切換至:", isOn);
}

/* ===== 視窗控制 ===== */
window.openInspectionModal = function (featureId, labelText) {
    const modal = document.getElementById('inspectionModalOverlay');
    const title = document.getElementById('inspectionModalTitle');
    if (modal && title) {
        window.currentInspectionFeatureId = featureId;
        title.textContent = `點號：${labelText || featureId || ''}`;
        modal.classList.add('visible');
    }
};

function closeInspectionModal() {
    const modal = document.getElementById('inspectionModalOverlay');
    if (modal) modal.classList.remove('visible');
}

/* ===== 事件初始化 ===== */
document.addEventListener('DOMContentLoaded', () => {
    // 綁定切換按鈕
    const toggleBtn = document.getElementById('inspectionToggleBtn');
    if (toggleBtn) {
        // 確保初始 Class 存在
        if (!toggleBtn.classList.contains('inspection-on')) {
            toggleBtn.classList.add('inspection-off');
        }
        toggleBtn.addEventListener('click', toggleInspectionMode);
    }

    // 綁定提交按鈕
    const submitBtn = document.getElementById('inspectionSubmitBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', () => {
            const featureId = window.currentInspectionFeatureId;
            if (!featureId) return;
            window.inspectionStatusMap[featureId] = true;
            if (window.markFeatureInspectionDone) window.markFeatureInspectionDone(featureId);
            closeInspectionModal();
        });
    }
});

/* ===== 顯示鉛筆按鈕（提供 map-logic 呼叫） ===== */
window.showInspectionPencil = function({ latlng, name, featureId }) {
    if (!window.isInspectionMode) return;

    // 移除舊鉛筆
    const old = document.getElementById('inspectionPencilBtn');
    if (old) old.remove();

    const isDone = window.inspectionStatusMap[featureId] === true;
    const iconUrl = isDone
        ? 'https://cdn-icons-png.freepik.com/512/8280/8280538.png'
        : 'https://cdn-icons-png.freepik.com/512/8280/8280556.png';

    const btnHtml = `
        <div class="nav-button-content">
            <img src="${iconUrl}" alt="清查" />
        </div>
    `;

    const pencilIcon = L.divIcon({
        className: 'inspection-pencil-icon',
        html: btnHtml,
        iconSize: [50, 50],
        iconAnchor: [25, 25]
    });

    const pencilMarker = L.marker(latlng, {
        icon: pencilIcon,
        zIndexOffset: 1990,
        interactive: true
    }).addTo(navButtons);

    pencilMarker.on('click', function(e) {
        L.DomEvent.stopPropagation(e);
        window.openInspectionModal(featureId, name);
    });
};