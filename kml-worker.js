// kml-worker.js v1.9.6 - 處理 KML 檔案上傳與刪除邏輯
(function() {
    // 獲取與 HTML ID 一致的元件
    const fileInput = document.getElementById('hiddenKmlFileInput');
    const fileNameDisplay = document.getElementById('selectedKmlFileNameDashboard');
    const uploadBtn = document.getElementById('uploadKmlSubmitBtnDashboard');
    const deleteBtn = document.getElementById('deleteSelectedKmlBtn');
    const dashboardSelect = document.getElementById('kmlLayerSelectDashboard');

    /**
     * 1. 檔案選取監聽：更新顯示檔名區塊
     * 連結 CSS 中的 #selectedKmlFileNameDashboard 樣式
     */
    if (fileNameDisplay && fileInput) {
        // 點擊藍色框框觸發隱藏的檔案選擇器
        fileNameDisplay.onclick = () => {
            fileInput.click();
        };

        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                // 更新顯示文字為檔案名稱
                fileNameDisplay.textContent = file.name;
                // 變換邊框顏色以提示已選取檔案
                fileNameDisplay.style.borderColor = "#2193b0";
                fileNameDisplay.style.color = "#333";
            } else {
                fileNameDisplay.textContent = "尚未選擇";
                fileNameDisplay.style.borderColor = "#dcdcdc";
            }
        };
    }

    /**
     * 2. 上傳功能邏輯
     * 執行：KML 轉 GeoJSON、儲存至 Firestore
     */
    if (uploadBtn) {
        uploadBtn.onclick = async () => {
            const file = fileInput.files[0];
            if (!file) {
                if (window.showMessageCustom) {
                    window.showMessageCustom({ title: "提示", message: "請先選擇 KML 檔案" });
                } else {
                    alert("請先選擇 KML 檔案");
                }
                return;
            }

            // 鎖定按鈕防止重複點擊
            uploadBtn.disabled = true;
            uploadBtn.textContent = "上傳中...";

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    // 解析 KML 為 XML
                    const kmlText = e.target.result;
                    const parser = new DOMParser();
                    const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
                    
                    // 呼叫 toGeoJSON 庫進行轉換
                    const geojson = toGeoJSON.kml(kmlDoc);

                    if (!geojson || !geojson.features || geojson.features.length === 0) {
                        throw new Error("KML 檔案中沒有效的地理特徵點");
                    }

                    // 存入指定路徑：artifacts/{appId}/public/data/kmlLayers
                    await window.db.collection('artifacts').doc(window.appId)
                        .collection('public').doc('data')
                        .collection('kmlLayers').add({
                            name: file.name,
                            geojson: JSON.stringify(geojson),
                            uploadTime: firebase.firestore.FieldValue.serverTimestamp()
                        });

                    if (window.showMessageCustom) {
                        window.showMessageCustom({ title: "成功", message: `圖層「${file.name}」已同步至雲端` });
                    }

                    // 重置 UI
                    fileInput.value = "";
                    fileNameDisplay.textContent = "尚未選擇";
                    fileNameDisplay.style.borderColor = "#dcdcdc";

                    // 同步更新主畫面與後台的下拉選單
                    if (window.updateKmlLayerSelects) {
                        await window.updateKmlLayerSelects();
                    }

                } catch (err) {
                    console.error("上傳失敗:", err);
                    alert("上傳失敗: " + err.message);
                } finally {
                    uploadBtn.disabled = false;
                    uploadBtn.textContent = "上傳";
                }
            };

            reader.readAsText(file);
        };
    }

    /**
     * 3. 刪除圖層邏輯
     */
    if (deleteBtn) {
        deleteBtn.onclick = async () => {
            const selectedId = dashboardSelect.value;
            if (!selectedId) {
                alert("請從選單中選擇要刪除的圖層");
                return;
            }

            const confirmMsg = `確定要刪除此圖層嗎？\n這將導致地圖點位無法顯示。`;
            if (!confirm(confirmMsg)) return;

            deleteBtn.disabled = true;
            deleteBtn.textContent = "刪除中...";

            try {
                // 從 Firestore 移除檔案
                await window.db.collection('artifacts').doc(window.appId)
                    .collection('public').doc('data')
                    .collection('kmlLayers').doc(selectedId).delete();

                // 若當前地圖正顯示此圖層，則清空地圖
                if (window.currentKmlLayerId === selectedId && window.clearAllKmlLayers) {
                    window.clearAllKmlLayers();
                }

                alert("圖層已成功刪除");

                // 更新選單清單
                if (window.updateKmlLayerSelects) {
                    await window.updateKmlLayerSelects();
                }

            } catch (err) {
                console.error("刪除失敗:", err);
                alert("刪除失敗，請檢查權限");
            } finally {
                deleteBtn.disabled = false;
                deleteBtn.textContent = "刪除";
            }
        };
    }
})();