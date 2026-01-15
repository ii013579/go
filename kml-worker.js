// kml-worker.js
(function() {
    const fileInput = document.getElementById('hiddenKmlFileInput');
    const fileNameDisplay = document.getElementById('selectedKmlFileNameDashboard');

    // 選取檔案後更新顯示
    fileInput?.addEventListener('change', (e) => {
        fileNameDisplay.textContent = e.target.files[0]?.name || "尚未選擇";
    });

    // 上傳邏輯
    document.getElementById('uploadKmlSubmitBtnDashboard')?.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) return window.showMessage("提示", "請選擇 KML 檔案");

        const reader = new FileReader();
        reader.onload = async (e) => {
            const kmlDoc = new DOMParser().parseFromString(e.target.result, 'text/xml');
            const geojson = toGeoJSON.kml(kmlDoc);
            await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').add({
                name: file.name,
                geojson: JSON.stringify(geojson),
                uploadTime: firebase.firestore.FieldValue.serverTimestamp()
            });
            window.showMessage("成功", "圖層已上傳");
            if (window.updateKmlLayerSelects) window.updateKmlLayerSelects();
        };
        reader.readAsText(file);
    });

    // 刪除邏輯
    document.getElementById('deleteSelectedKmlBtn')?.addEventListener('click', async () => {
        const id = document.getElementById('kmlLayerSelectDashboard').value;
        if (!id || !confirm("確定刪除此圖層？")) return;
        await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').doc(id).delete();
        window.showMessage("通知", "圖層已移除");
        if (window.updateKmlLayerSelects) window.updateKmlLayerSelects();
    });
})();