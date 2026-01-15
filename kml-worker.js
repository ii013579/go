(function() {
    // 選取檔案顯示名稱
    document.getElementById('hiddenKmlFileInput')?.addEventListener('change', (e) => {
        document.getElementById('selectedKmlFileNameDashboard').textContent = e.target.files[0]?.name || "未選擇檔案";
    });

    // 上傳邏輯
    document.getElementById('uploadKmlSubmitBtnDashboard')?.addEventListener('click', async () => {
        const file = document.getElementById('hiddenKmlFileInput').files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const kmlDoc = new DOMParser().parseFromString(e.target.result, 'text/xml');
                const geojson = toGeoJSON.kml(kmlDoc);
                await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').add({
                    name: file.name,
                    geojson: JSON.stringify(geojson),
                    uploadTime: firebase.firestore.FieldValue.serverTimestamp()
                });
                window.updateKmlLayerSelects();
                window.showMessage("成功", "圖層上傳成功");
            } catch (err) {
                window.showMessage("錯誤", "KML 解析失敗");
            }
        };
        reader.readAsText(file);
    });

    // 刪除邏輯
    document.getElementById('deleteSelectedKmlBtn')?.addEventListener('click', async () => {
        const id = document.getElementById('kmlLayerSelectDashboard').value;
        if (!id || !confirm("確定要刪除此圖層嗎？")) return;
        await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').doc(id).delete();
        window.updateKmlLayerSelects();
    });
})();