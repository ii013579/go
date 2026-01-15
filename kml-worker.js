(function() {
    // 檔案選取顯示
    document.getElementById('hiddenKmlFileInput')?.addEventListener('change', (e) => {
        document.getElementById('selectedKmlFileNameDashboard').textContent = e.target.files[0]?.name || "尚未選擇";
    });

    // 執行上傳
    document.getElementById('uploadKmlSubmitBtnDashboard')?.addEventListener('click', async () => {
        const file = document.getElementById('hiddenKmlFileInput').files[0];
        if (!file) return window.showMessage("提示", "請選擇 KML 檔案");

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
                window.showMessage("成功", "圖層已上傳");
            } catch (err) { window.showMessage("錯誤", "解析失敗"); }
        };
        reader.readAsText(file);
    });

    // 執行刪除
    document.getElementById('deleteSelectedKmlBtn')?.addEventListener('click', async () => {
        const id = document.getElementById('kmlLayerSelectDashboard').value;
        if (!id || !confirm("確定刪除此圖層？")) return;
        await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').doc(id).delete();
        window.updateKmlLayerSelects();
        window.showMessage("通知", "圖層已刪除");
    });
})();