// kml-worker.js v1.9.4
// 職責：搬運工 (處理 KML 轉換、Firestore 存取、圖釘記憶、選單更新)

(function() {
    // 內部 UI 元素引用 (對應 index.html 的 ID)
    const kmlLayerSelect = document.getElementById('kmlLayerSelect');
    const kmlLayerSelectDashboard = document.getElementById('kmlLayerSelectDashboard');
    const hiddenKmlFileInput = document.getElementById('hiddenKmlFileInput');
    const uploadKmlSubmitBtnDashboard = document.getElementById('uploadKmlSubmitBtnDashboard');
    const selectedKmlFileNameDashboard = document.getElementById('selectedKmlFileNameDashboard');
    const pinButton = document.getElementById('pinButton');

    /**
     * 1. 監聽守門員指令 (authReady)
     * 當使用者登入成功且權限確定後觸發
     */
    document.addEventListener('authReady', async (e) => {
        console.log("搬運工：權限已確認，開始同步清單...");
        const { email } = e.detail;

        await updateKmlLayerSelects();
        
        // 處理「圖釘功能」：檢查是否有預設要載入的圖層
        const pinnedKmlId = localStorage.getItem('pinnedKmlId');
        if (pinnedKmlId) {
            console.log(`搬運工：載入釘選圖層 -> ${pinnedKmlId}`);
            if (window.loadKmlLayerFromFirestore) {
                // 指揮官負責畫圖，搬運工負責下令
                window.loadKmlLayerFromFirestore(pinnedKmlId);
            }
        }
        
        updatePinButtonState();
    });

    /**
     * 2. 更新 KML 下拉選單
     * 依照您的 Firebase 規則路徑：artifacts/{appId}/public/data/kmlLayers
     */
    async function updateKmlLayerSelects() {
        if (!kmlLayerSelect && !kmlLayerSelectDashboard) return;

        try {
            const kmlLayersRef = window.db.collection('artifacts')
                .doc(window.appId).collection('public')
                .doc('data').collection('kmlLayers');

            const snapshot = await kmlLayersRef.orderBy('uploadTime', 'desc').get();

            let optionsHtml = '<option value="">-- 請選擇 KML 圖層 --</option>';
            snapshot.forEach(doc => {
                const data = doc.data();
                optionsHtml += `<option value="${doc.id}">${data.name || '未命名'}</option>`;
            });

            if (kmlLayerSelect) kmlLayerSelect.innerHTML = optionsHtml;
            if (kmlLayerSelectDashboard) kmlLayerSelectDashboard.innerHTML = optionsHtml;

            // 如果目前已有載入圖層，保持選單選取狀態
            if (window.currentKmlLayerId) {
                if (kmlLayerSelect) kmlLayerSelect.value = window.currentKmlLayerId;
                if (kmlLayerSelectDashboard) kmlLayerSelectDashboard.value = window.currentKmlLayerId;
            }
        } catch (error) {
            console.error("搬運工：更新選單失敗", error);
        }
    }

    /**
     * 3. 處理 KML 上傳 (符合 Firebase 規則檢查)
     */
    if (hiddenKmlFileInput) {
        hiddenKmlFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && selectedKmlFileNameDashboard) {
                selectedKmlFileNameDashboard.textContent = file.name;
            }
        });
    }

    if (uploadKmlSubmitBtnDashboard) {
        uploadKmlSubmitBtnDashboard.addEventListener('click', async () => {
            const file = hiddenKmlFileInput.files[0];
            if (!file) {
                window.showMessage('提示', '請先選擇 KML 檔案');
                return;
            }

            window.isLoadingKml = true; 
            uploadKmlSubmitBtnDashboard.disabled = true;
            const originalText = uploadKmlSubmitBtnDashboard.textContent;
            uploadKmlSubmitBtnDashboard.textContent = '處理中...';

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    // KML 轉 GeoJSON
                    const kmlDoc = new DOMParser().parseFromString(event.target.result, 'text/xml');
                    const geojson = toGeoJSON.kml(kmlDoc);

                    const kmlLayersRef = window.db.collection('artifacts').doc(window.appId)
                        .collection('public').doc('data').collection('kmlLayers');

                    // 檢查是否重複名圖層 (覆蓋邏輯)
                    const existing = await kmlLayersRef.where('name', '==', file.name).get();
                    let docRef = kmlLayersRef.doc();
                    
                    if (!existing.empty) {
                        const confirm = await window.showConfirmationModal('覆蓋確認', `資料庫已有「${file.name}」，確定要覆蓋嗎？`);
                        if (!confirm) throw new Error("使用者取消上傳");
                        docRef = existing.docs[0].ref;
                    }

                    // 寫入 Firestore (欄位必須對齊 Security Rules)
                    await docRef.set({
                        name: file.name,
                        uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
                        uploadedBy: window.auth.currentUser.email, // 關鍵：規則檢查此欄位
                        geojson: JSON.stringify(geojson)           // 整包儲存
                    }, { merge: true });

                    window.showMessage('成功', '檔案已成功上傳至資料庫');
                    await updateKmlLayerSelects();
                    
                } catch (err) {
                    console.error("上傳失敗:", err);
                    window.showMessage('上傳失敗', err.message);
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
    if (pinButton) {
        pinButton.addEventListener('click', () => {
            const currentId = kmlLayerSelect.value;
            if (!currentId) {
                window.showMessage('提示', '請先從選單選擇一個圖層再進行釘選');
                return;
            }

            const pinnedId = localStorage.getItem('pinnedKmlId');
            if (pinnedId === currentId) {
                localStorage.removeItem('pinnedKmlId');
                window.showMessageCustom({ title: '取消釘選', message: '已移除預設載入設定', autoClose: true });
            } else {
                localStorage.setItem('pinnedKmlId', currentId);
                window.showMessageCustom({ title: '釘選成功', message: '下次開啟將自動載入此圖層', autoClose: true });
            }
            updatePinButtonState();
        });
    }

    function updatePinButtonState() {
        if (!pinButton) return;
        const pinnedId = localStorage.getItem('pinnedKmlId');
        const currentId = kmlLayerSelect ? kmlLayerSelect.value : '';
        
        if (pinnedId && currentId === pinnedId) {
            pinButton.classList.add('active'); // CSS 應讓 active 狀態變色
            pinButton.style.backgroundColor = '#ffeeba'; 
        } else {
            pinButton.classList.remove('active');
            pinButton.style.backgroundColor = '';
        }
        
        // 啟用按鈕 (如果有選擇圖層的話)
        pinButton.disabled = !currentId;
    }

    // 選單切換時同步按鈕狀態
    if (kmlLayerSelect) {
        kmlLayerSelect.addEventListener('change', updatePinButtonState);
    }

    // 將更新方法暴露給全域
    window.updateKmlLayerSelects = updateKmlLayerSelects;

})();