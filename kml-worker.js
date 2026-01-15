// kml-worker.js
(function() {
    // 處理檔案選擇顯示
    document.getElementById('hiddenKmlFileInput')?.addEventListener('change', (e) => {
        const fileName = e.target.files[0]?.name || "尚未選擇檔案";
        document.getElementById('selectedKmlFileNameDashboard').textContent = fileName;
    });

    // 上傳功能 (恢復 v1.9.6 邏輯)
    document.getElementById('uploadKmlSubmitBtnDashboard')?.addEventListener('click', async () => {
        const file = document.getElementById('hiddenKmlFileInput').files[0];
        if (!file) return window.showMessage("提示", "請選擇檔案");

        const reader = new FileReader();
        reader.onload = async (e) => {
            const kmlDoc = new DOMParser().parseFromString(e.target.result, 'text/xml');
            const geojson = toGeoJSON.kml(kmlDoc);
            
            const kmlRef = window.db.collection('artifacts').doc(window.appId)
                .collection('public').doc('data').collection('kmlLayers');

            // 執行上傳
            await kmlRef.add({
                name: file.name,
                geojson: JSON.stringify(geojson),
                uploadedBy: window.auth.currentUser.email,
                uploadTime: firebase.firestore.FieldValue.serverTimestamp()
            });
            window.showMessage("成功", "KML 已上傳");
            window.updateKmlLayerSelects();
        };
        reader.readAsText(file);
    });

    // 刪除功能 (恢復 v1.9.6 邏輯)
    document.getElementById('deleteSelectedKmlBtn')?.addEventListener('click', async () => {
        const id = document.getElementById('kmlLayerSelectDashboard').value;
        if (!id) return;
        if (confirm("確定要刪除此圖層？")) {
            await window.db.collection('artifacts').doc(window.appId)
                .collection('public').doc('data').collection('kmlLayers').doc(id).delete();
            window.updateKmlLayerSelects();
        }
    });
})();