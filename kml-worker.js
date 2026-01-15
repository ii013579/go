// kml-worker.js
(function() {
    const fileInput = document.getElementById('hiddenKmlFileInput');
    const fileNameDisplay = document.getElementById('selectedKmlFileNameDashboard');

    // 1. 處理檔案選擇與檔名顯示
    fileInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (fileNameDisplay) {
            fileNameDisplay.textContent = file ? file.name : "尚未選擇";
        }
    });

    // 2. 上傳功能
    document.getElementById('uploadKmlSubmitBtnDashboard')?.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) return window.showMessage("提示", "請先選擇 KML 檔案");

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const kmlDoc = new DOMParser().parseFromString(e.target.result, 'text/xml');
                const geojson = toGeoJSON.kml(kmlDoc);

                await window.db.collection('artifacts').doc(window.appId)
                    .collection('public').doc('data').collection('kmlLayers').add({
                        name: file.name,
                        geojson: JSON.stringify(geojson),
                        uploadTime: firebase.firestore.FieldValue.serverTimestamp()
                    });

                window.showMessage("成功", "圖層已成功上傳");
                fileInput.value = "";
                if (fileNameDisplay) fileNameDisplay.textContent = "尚未選擇";
                if (window.updateKmlLayerSelects) window.updateKmlLayerSelects();
            } catch (err) {
                window.showMessage("錯誤", "解析或上傳失敗");
            }
        };
        reader.readAsText(file);
    });

    // 3. 刪除功能
    document.getElementById('deleteSelectedKmlBtn')?.addEventListener('click', async () => {
        const kmlId = document.getElementById('kmlLayerSelectDashboard').value;
        if (!kmlId) return window.showMessage("提示", "請選擇要刪除的圖層");

        if (confirm("確定刪除此圖層？此操作不可復原。")) {
            await window.db.collection('artifacts').doc(window.appId)
                .collection('public').doc('data').collection('kmlLayers').doc(kmlId).delete();
            
            window.showMessage("通知", "圖層已刪除");
            if (window.updateKmlLayerSelects) window.updateKmlLayerSelects();
        }
    });
})();