// kml.js
window.updateKmlLayerSelects = async () => {
    const snapshot = await db.collection('kmls').get();
    const select = document.getElementById('kmlLayerSelect');
    const dashboardSelect = document.getElementById('kmlLayerSelectDashboard');
    
    let optionsHtml = '<option value="">-- 請選擇圖層 --</option>';
    snapshot.forEach(doc => {
        optionsHtml += `<option value="${doc.id}">${doc.data().name}</option>`;
    });
    
    if(select) select.innerHTML = optionsHtml;
    if(dashboardSelect) dashboardSelect.innerHTML = optionsHtml;
    
    // 檢查釘選
    const pinnedId = localStorage.getItem('pinnedKmlId');
    if (pinnedId && select) {
        select.value = pinnedId;
        window.loadKmlLayerFromFirestore(pinnedId);
    }
};

// 刪除 KML 邏輯
window.deleteSelectedKml = async () => {
    const id = document.getElementById('kmlLayerSelectDashboard').value;
    if (!id) return alert("請選擇要刪除的圖層");
    if (confirm("確定要刪除此圖層嗎？此動作無法復原。")) {
        await db.collection('kmls').doc(id).delete();
        window.updateKmlLayerSelects();
    }
};