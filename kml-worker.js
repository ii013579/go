// kml-worker.js v1.9.6 完整邏輯版

(function() {
    // 獲取管理面板相關元素
    const hiddenKmlFileInput = document.getElementById('hiddenKmlFileInput');
    const selectedKmlFileNameDashboard = document.getElementById('selectedKmlFileNameDashboard');
    const uploadBtn = document.getElementById('uploadKmlSubmitBtnDashboard');
    const deleteBtn = document.getElementById('deleteSelectedKmlBtn');
    const dashboardSelect = document.getElementById('kmlLayerSelectDashboard');

    /**
     * 1. 檔案選取監聽器
     * 配合 CSS：#selectedKmlFileNameDashboard (具有 padding, border, ellipsis 效果)
     */
    if (selectedKmlFileNameDashboard && hiddenKmlFileInput) {
        // 點擊顯示框也可觸發檔案選取
        selectedKmlFileNameDashboard.addEventListener('click', () => {
            hiddenKmlFileInput.click();
        });

        hiddenKmlFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                // 更新顯示框內容，CSS 會自動處理長檔名的省略號 (...)
                selectedKmlFileNameDashboard.textContent = file.name;
                selectedKmlFileNameDashboard.style.borderColor = "#4a90e2";
                selectedKmlFileNameDashboard.style.backgroundColor = "#fff";
            } else {
                selectedKmlFileNameDashboard.textContent = "尚未選擇";
                selectedKmlFileNameDashboard.style.borderColor = "#dcdcdc";
            }
        });
    }

    /**
     * 2. KML 上傳邏輯
     * 包含：KML 解析為 GeoJSON、存入 Firestore、自動更新下拉選單
     */
    if (uploadBtn) {
        uploadBtn.addEventListener('click', async () => {
            const file = hiddenKmlFileInput.files[0];
            if (!file) {
                window.showMessage('提示', '請先選取一個 KML 檔案。');
                return;
            }

            // 檢查副檔名
            if (!file.name.toLowerCase().endsWith('.kml')) {
                window.showMessage('錯誤', '僅支援 .kml 格式檔案。');
                return;
            }

            uploadBtn.disabled = true;
            uploadBtn.textContent = '上傳中...';

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const kmlContent = e.target.result;
                    const parser = new DOMParser();
                    const kmlDoc = parser.parseFromString(kmlContent, 'text/xml');
                    
                    // 使用 toGeoJSON 庫轉換 (請確保 index.html 已載入 toggojson.js)
                    const geojson = toGeoJSON.kml(kmlDoc);

                    if (!geojson || !geojson.features || geojson.features.length === 0) {
                        throw new Error("KML 內容不包含有效的地理資訊。");
                    }

                    // 儲存至 Firestore: artifacts/{appId}/public/data/kmlLayers
                    await window.db.collection('artifacts').doc(window.appId)
                        .collection('public').doc('data')
                        .collection('kmlLayers').add({
                            name: file.name,
                            geojson: JSON.stringify(geojson),
                            uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
                            fileSize: file.size
                        });

                    window.showMessage('成功', `圖層「${file.name}」上傳成功！`);
                    
                    // 重置 UI
                    hiddenKmlFileInput.value = "";
                    selectedKmlFileNameDashboard.textContent = "尚未選擇";
                    selectedKmlFileNameDashboard.style.borderColor = "#dcdcdc";

                    // 通知全域更新下拉選單 (auth-kml-management.js 中的函數)
                    if (window.updateKmlLayerSelects) {
                        await window.updateKmlLayerSelects();
                    }

                } catch (error) {
                    console.error("KML 上傳錯誤:", error);
                    window.showMessage('失敗', '解析 KML 失敗，請確認檔案內容正確。');
                } finally {
                    uploadBtn.disabled = false;
                    uploadBtn.textContent = '上傳圖層';
                }
            };
            
            reader.onerror = () => {
                window.showMessage('錯誤', '讀取檔案失敗。');
                uploadBtn.disabled = false;
            };

            reader.readAsText(file);
        });
    }

    /**
     * 3. 圖層刪除邏輯
     */
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            const kmlId = dashboardSelect.value;
            if (!kmlId) {
                window.showMessage('提示', '請先從選單中選擇要刪除的圖層。');
                return;
            }

            const confirmDelete = confirm("確定要永久刪除此圖層嗎？這將會導致地圖點位消失。");
            if (!confirmDelete) return;

            deleteBtn.disabled = true;
            deleteBtn.textContent = '刪除中...';

            try {
                // 從 Firestore 刪除
                await window.db.collection('artifacts').doc(window.appId)
                    .collection('public').doc('data')
                    .collection('kmlLayers').doc(kmlId).delete();

                window.showMessage('通知', '圖層已成功移除。');

                // 更新 UI 下拉選單
                if (window.updateKmlLayerSelects) {
                    await window.updateKmlLayerSelects();
                }
                
                // 如果目前地圖展示的是這個圖層，則清空地圖
                if (window.currentKmlLayerId === kmlId && window.addGeoJsonLayers) {
                    window.addGeoJsonLayers([]);
                    window.allKmlFeatures = [];
                    window.currentKmlLayerId = null;
                }

            } catch (error) {
                console.error("刪除圖層錯誤:", error);
                window.showMessage('錯誤', '刪除失敗，請檢查權限。');
            } finally {
                deleteBtn.disabled = false;
                deleteBtn.textContent = '刪除選擇圖層';
            }
        });
    }
})();