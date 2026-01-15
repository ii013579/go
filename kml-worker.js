// kml-worker.js v2.0.0 (修復上傳與刪除)
(function() {
    // 1. 檔案選取後顯示檔名
    const fileInput = document.getElementById('hiddenKmlFileInput');
    const fileNameDisplay = document.getElementById('selectedKmlFileNameDashboard');

    fileInput?.addEventListener('change', (e) => {
        fileNameDisplay.textContent = e.target.files[0]?.name || "尚未選擇";
    });

    // 2. 上傳功能
    const uploadBtn = document.getElementById('uploadKmlSubmitBtnDashboard');
    uploadBtn?.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) {
            window.showMessage("提示", "請先選擇 KML 檔案");
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                // 使用 toGeoJSON 將 XML 轉為 GeoJSON
                const kmlDoc = new DOMParser().parseFromString(e.target.result, 'text/xml');
                const geojson = toGeoJSON.kml(kmlDoc);

                await window.db.collection('artifacts').doc(window.appId)
                    .collection('public').doc('data').collection('kmlLayers').add({
                        name: file.name,
                        geojson: JSON.stringify(geojson),
                        uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
                        uploader: window.auth.currentUser?.email || 'unknown'
                    });

                window.showMessage("成功", "圖層上傳成功");
                if (window.updateKmlLayerSelects) window.updateKmlLayerSelects();
                fileInput.value = ""; // 清空選取
                fileNameDisplay.textContent = "尚未選擇";
            } catch (err) {
                window.showMessage("錯誤", "KML 解析或上傳失敗");
            }
        };
        reader.readAsText(file);
    });

    // 3. 刪除功能
    const deleteBtn = document.getElementById('deleteSelectedKmlBtn');
    deleteBtn?.addEventListener('click', async () => {
        const selectBox = document.getElementById('kmlLayerSelectDashboard');
        const kmlId = selectBox.value;

        if (!kmlId) {
            window.showMessage("提示", "請選擇要刪除的圖層");
            return;
        }

        if (confirm("警告：確定要刪除此圖層嗎？這將無法復原。")) {
            try {
                await window.db.collection('artifacts').doc(window.appId)
                    .collection('public').doc('data').collection('kmlLayers').doc(kmlId).delete();
                
                window.showMessage("通知", "圖層已成功刪除");
                if (window.updateKmlLayerSelects) window.updateKmlLayerSelects();
            } catch (err) {
                window.showMessage("錯誤", "刪除失敗");
            }
        }
    });
})();