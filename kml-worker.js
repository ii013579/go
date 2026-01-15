(function() {
    // 顯示選擇的檔名
    document.getElementById('hiddenKmlFileInput')?.addEventListener('change', (e) => {
        document.getElementById('selectedKmlFileNameDashboard').textContent = e.target.files[0]?.name || "尚未選擇";
    });

    // 上傳按鈕
    document.getElementById('uploadKmlSubmitBtnDashboard')?.addEventListener('click', async () => {
        const file = document.getElementById('hiddenKmlFileInput').files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const kmlDoc = new DOMParser().parseFromString(e.target.result, 'text/xml');
            const geojson = toGeoJSON.kml(kmlDoc);
            await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').add({
                name: file.name,
                geojson: JSON.stringify(geojson),
                uploadTime: firebase.firestore.FieldValue.serverTimestamp()
            });
            window.updateKmlLayerSelects();
            window.showMessage("成功", "圖層上傳完畢");
        };
        reader.readAsText(file);
    });

    // 刪除按鈕
    document.getElementById('deleteSelectedKmlBtn')?.addEventListener('click', async () => {
        const id = document.getElementById('kmlLayerSelectDashboard').value;
        if (!id || !confirm("確定刪除此圖層？")) return;
        await window.db.collection('artifacts').doc(window.appId).collection('public').doc('data').collection('kmlLayers').doc(id).delete();
        window.updateKmlLayerSelects();
    });
})();