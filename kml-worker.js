// kml-worker.js v2.0.0
// 職責：搬運工 (處理 KML 轉換、Firestore 存取、圖釘記憶、選單更新)

(function() {
    // 內部的 UI 元素引用
    const kmlLayerSelect = document.getElementById('kmlLayerSelect');
    const kmlLayerSelectDashboard = document.getElementById('kmlLayerSelectDashboard');
    const hiddenKmlFileInput = document.getElementById('hiddenKmlFileInput');
    const uploadKmlSubmitBtnDashboard = document.getElementById('uploadKmlSubmitBtnDashboard');
    const selectedKmlFileNameDashboard = document.getElementById('selectedKmlFileNameDashboard');
    const pinKmlLayerBtn = document.getElementById('pinKmlLayerBtn');

    /**
     * 1. 監聽守門員指令 (authReady)
     */
    document.addEventListener('authReady', async (e) => {
        console.log("搬運工：收到指令，開始初始化資料...");
        await updateKmlLayerSelects();
        
        // 處理「圖釘功能」：檢查是否有預設要載入的圖層
        const pinnedKmlId = localStorage.getItem('pinnedKmlId');
        if (pinnedKmlId) {
            console.log(`搬運工：發現圖釘圖層 ${pinnedKmlId}，通知指揮官載入...`);
            if (window.loadKmlLayerFromFirestore) {
                window.loadKmlLayerFromFirestore(pinnedKmlId);
            }
        }
        
        updatePinButtonState();
    });

    /**
     * 2. 更新 KML 下拉選單 (快取機制)
     */
    async function updateKmlLayerSelects() {
        if (!kmlLayerSelect && !kmlLayerSelectDashboard) return;

        try {
            // 從 Firestore 抓取圖層清單 (僅抓取名稱與 ID，不抓取龐大的 geojson 欄位以節省流量)
            const snapshot = await window.db.collection('artifacts')
                .doc(window.appId).collection('public')
                .doc('data').collection('kmlLayers')
                .orderBy('uploadTime', 'desc').get();

            const optionsHtml = ['<option value="">-- 選擇 KML 圖層 --</option>'];
            snapshot.forEach(doc => {
                const data = doc.data();
                optionsHtml.push(`<option value="${doc.id}">${data.name || '未命名圖層'}</option>`);
            });

            const finalHtml = optionsHtml.join('');
            if (kmlLayerSelect) kmlLayerSelect.innerHTML = finalHtml;
            if (kmlLayerSelectDashboard) kmlLayerSelectDashboard.innerHTML = finalHtml;

            // 保持選單狀態與目前載入的圖層一致
            if (window.currentKmlLayerId) {
                if (kmlLayerSelect) kmlLayerSelect.value = window.currentKmlLayerId;
                if (kmlLayerSelectDashboard) kmlLayerSelectDashboard.value = window.currentKmlLayerId;
            }
        } catch (error) {
            console.error("更新選單失敗:", error);
        }
    }

    /**
     * 3. 處理 KML 上傳與轉換 (整包儲存)
     */
    if (uploadKmlSubmitBtnDashboard) {
        uploadKmlSubmitBtnDashboard.addEventListener('click', async () => {
            const file = hiddenKmlFileInput.files[0];
            if (!file) return;

            // 鎖定狀態，防止重複讀取/寫入
            window.isLoadingKml = true; 
            uploadKmlSubmitBtnDashboard.disabled = true;
            const originalText = uploadKmlSubmitBtnDashboard.textContent;
            uploadKmlSubmitBtnDashboard.textContent = '搬運中...';

            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const kmlDoc = new DOMParser().parseFromString(reader.result, 'text/xml');
                    const geojson = toGeoJSON.kml(kmlDoc); // 執行搬運工的轉換任務

                    const kmlLayersRef = window.db.collection('artifacts').doc(window.appId)
                        .collection('public').doc('data').collection('kmlLayers');

                    // 檢查重複 (覆蓋邏輯)
                    const existing = await kmlLayersRef.where('name', '==', file.name).get();
                    let docRef = kmlLayersRef.doc();
                    
                    if (!existing.empty) {
                        const confirm = await window.showConfirmationModal('覆蓋提示', `已存在 "${file.name}"，是否覆蓋？`);
                        if (!confirm) throw new Error("使用者取消上傳");
                        docRef = existing.docs[0].ref;
                    }

                    // 整包 JSON 儲存 (v1.9.3)
                    await docRef.set({
                        name: file.name,
                        uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
                        uploadedBy: window.currentUserEmail,
                        geojson: JSON.stringify(geojson) // 轉成字串，省去子集合讀取次數
                    }, { merge: true });

                    window.showMessage('成功', 'KML 搬運完成並已存入資料庫。');
                    await updateKmlLayerSelects();
                } catch (err) {
                    window.showMessage('錯誤', err.message);
                } finally {
                    window.isLoadingKml = false;
                    uploadKmlSubmitBtnDashboard.disabled = false;
                    uploadKmlSubmitBtnDashboard.textContent = originalText;
                    hiddenKmlFileInput.value = '';
                    if (selectedKmlFileNameDashboard) selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
                }
            };
            reader.readAsText(file);
        });
    }

    /**
     * 4. 圖釘按鈕邏輯 (LocalStorage)
     */
    if (pinKmlLayerBtn) {
        pinKmlLayerBtn.addEventListener('click', () => {
            const currentId = kmlLayerSelect.value;
            if (!currentId) {
                window.showMessage('提示', '請先選擇一個圖層再進行釘選。');
                return;
            }

            const pinnedId = localStorage.getItem('pinnedKmlId');
            if (pinnedId === currentId) {
                localStorage.removeItem('pinnedKmlId');
                window.showMessageCustom({ title: '取消釘選', message: '已移除預設載入圖層', autoClose: true });
            } else {
                localStorage.setItem('pinnedKmlId', currentId);
                window.showMessageCustom({ title: '釘選成功', message: '下次開啟將自動載入此圖層', autoClose: true });
            }
            updatePinButtonState();
        });
    }

    function updatePinButtonState() {
        if (!pinKmlLayerBtn) return;
        const pinnedId = localStorage.getItem('pinnedKmlId');
        const currentId = kmlLayerSelect ? kmlLayerSelect.value : '';
        
        if (pinnedId && currentId === pinnedId) {
            pinKmlLayerBtn.classList.add('is-pinned');
            pinKmlLayerBtn.title = "取消預設載入";
        } else {
            pinKmlLayerBtn.classList.remove('is-pinned');
            pinKmlLayerBtn.title = "設為預設載入圖層";
        }
    }

    // 當選單切換時，連動更新圖釘按鈕外觀
    if (kmlLayerSelect) {
        kmlLayerSelect.addEventListener('change', updatePinButtonState);
    }

    // 暴露給全域的輔助方法
    window.updateKmlLayerSelects = updateKmlLayerSelects;

})();