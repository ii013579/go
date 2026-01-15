// kml-worker.js v2.0.0
(function() {
    // 檔案選擇監聽
    document.getElementById('hiddenKmlFileInput')?.addEventListener('change', (e) => {
        document.getElementById('selectedKmlFileNameDashboard').textContent = e.target.files[0]?.name || "未選擇";
    });

    // 上傳邏輯
    document.getElementById('uploadKmlSubmitBtnDashboard')?.addEventListener('click', async () => {
        const file = document.getElementById('hiddenKmlFileInput').files[0];
        if (!file) return window.showMessage("錯誤", "請選擇檔案");

        const reader = new FileReader();
        reader.onload = async (e) => {
            const kmlDoc = new DOMParser().parseFromString(e.target.result, 'text/xml');
            const geojson = toGeoJSON.kml(kmlDoc);
            await window.db.collection('artifacts').doc(window.appId)
                .collection('public').doc('data').collection('kmlLayers').add({
                    name: file.name,
                    geojson: JSON.stringify(geojson),
                    uploadTime: firebase.firestore.FieldValue.serverTimestamp()
                });
            window.showMessage("成功", "圖層已新增");
            window.updateKmlLayerSelects();
        };
        reader.readAsText(file);
    });

    // 下拉選單同步
    window.updateKmlLayerSelects = async function() {
        const snapshot = await window.db.collection('artifacts').doc(window.appId)
            .collection('public').doc('data').collection('kmlLayers').get();
        const s1 = document.getElementById('kmlLayerSelect');
        const s2 = document.getElementById('kmlLayerSelectDashboard');
        const html = snapshot.docs.map(doc => `<option value="${doc.id}">${doc.data().name}</option>`).join('');
        if(s1) s1.innerHTML = '<option value="">--選擇--</option>' + html;
        if(s2) s2.innerHTML = '<option value="">--選擇--</option>' + html;
    };
})();