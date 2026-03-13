// audit-module.js - 完整清查功能模組
(function() {
    'use strict';
    
    // 依賴注入與環境變數
    const ns = window.mapNamespace;
    const db = firebase.firestore();
    const storage = firebase.storage();
    const currentAppId = (typeof appId !== 'undefined') ? appId : 'kmldata-d22fb'; 
    
    // 狀態變數
    let isAuditMode = false;
    let auditPhotoCount = 2; // 預設需要照片張數
    let auditDataCache = {}; // 快取 Firestore 紀錄 (名稱錨定用)

    // ==========================================
    // 1. 建立 UI 元素 (按鈕與設定)
    // ==========================================
    const auditBtn = document.createElement('button');
    auditBtn.id = 'auditToggleBtn';
    auditBtn.className = 'action-buttons';
    auditBtn.textContent = '開啟清查模式';
    auditBtn.style.display = 'none'; 

    const downloadBtn = document.createElement('button');
    downloadBtn.id = 'downloadAuditBtn';
    downloadBtn.className = 'action-buttons';
    downloadBtn.textContent = '下載清查資料 (ZIP)';
    downloadBtn.style.display = 'none';

    const auditSettings = document.createElement('div');
    auditSettings.id = 'auditSettings';
    auditSettings.style.display = 'none';
    auditSettings.innerHTML = `
        <label>照片張數: </label>
        <input type="number" id="photoCountInput" min="2" max="5" value="2" style="width:40px;">
    `;

    document.addEventListener('DOMContentLoaded', () => {
        const dashboard = document.getElementById('loggedInDashboard');
        if (dashboard) {
            dashboard.appendChild(auditBtn);
            dashboard.appendChild(auditSettings);
            dashboard.appendChild(downloadBtn);
        }
    });

    // 權限檢查機制
    const checkAuditPermission = () => {
        const role = window.currentUserRole;
        const hasAccess = (role === 'owner' || role === 'editor');
        auditBtn.style.display = hasAccess ? 'block' : 'none';
        auditSettings.style.display = hasAccess ? 'block' : 'none';
        downloadBtn.style.display = hasAccess ? 'block' : 'none';
    };
    setInterval(checkAuditPermission, 2000);

    // ==========================================
    // 2. 狀態同步 (跨裝置即時同步清查開關)
    // ==========================================
    db.collection('artifacts').doc(currentAppId).collection('public').doc('auditStatus')
      .onSnapshot((doc) => {
          if (doc.exists) {
              const data = doc.data();
              isAuditMode = data.active;
              auditPhotoCount = data.photoCount || 2;
              if (document.getElementById('photoCountInput')) {
                  document.getElementById('photoCountInput').value = auditPhotoCount;
              }
              updateAuditUI();
          }
      });

    auditBtn.addEventListener('click', async () => {
        const newState = !isAuditMode;
        const count = parseInt(document.getElementById('photoCountInput').value) || 2;
        // 寫入 Firestore 觸發全域同步
        await db.collection('artifacts').doc(currentAppId).collection('public').doc('auditStatus').set({
            active: newState,
            photoCount: count,
            updatedBy: auth.currentUser?.email || 'unknown',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    function updateAuditUI() {
        const titleEl = document.querySelector('.search-title'); 
        if (titleEl) titleEl.textContent = isAuditMode ? "點位清查中" : "點位搜尋輔助";
        
        auditBtn.textContent = isAuditMode ? '關閉清查模式' : '開啟清查模式';
        auditBtn.style.backgroundColor = isAuditMode ? '#ff4d4d' : '';
        auditDataCache = {}; // 清除快取

        // 重新繪製地圖圖層
        if (typeof window.addGeoJsonLayers === 'function' && ns.allKmlFeatures) {
            window.addGeoJsonLayers(ns.allKmlFeatures);
        }
    }

    // ==========================================
    // 3. 地圖渲染攔截 (Hook) 與名稱錨定對應
    // ==========================================
    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = async function(features) {
        // 先執行原始渲染邏輯
        await originalAddLayers(features);
        if (!isAuditMode) return;

        // 取得當前 KML 檔名作為錨點
        const kmlSelect = document.getElementById('kmlLayerSelect');
        const kmlName = kmlSelect && kmlSelect.options.length > 0 ? kmlSelect.options[kmlSelect.selectedIndex].text : 'default_kml';

        // 撈取資料並快取 (名稱錨定)
        const snap = await db.collection('auditRecords').where('kmlName', '==', kmlName).get();
        auditDataCache = {};
        snap.forEach(doc => { auditDataCache[doc.data().featureName] = doc.data(); });

        ns.geoJsonLayers.eachLayer(layer => {
            if (!layer.feature) return;
            const feature = layer.feature;
            const featureName = feature.properties.name;
            const record = auditDataCache[featureName];

            // 狀態轉換：藍點 (未清查) 至粉紅點 (已清查)
            layer.setStyle({
                fillColor: record ? "pink" : "blue",
                fillOpacity: 0.8
            });

            // 綁定點擊事件，顯示自訂 Icon
            layer.off('click').on('click', (e) => {
                const iconUrl = record 
                    ? 'https://cdn-icons-png.freepik.com/512/8280/8280538.png' // 粉紅 Icon
                    : 'https://cdn-icons-png.freepik.com/512/8280/8280556.png'; // 藍色 Icon
                
                if (window.currentEditMarker) ns.map.removeLayer(window.currentEditMarker);
                
                window.currentEditMarker = L.marker(e.latlng, { 
                    icon: L.icon({iconUrl, iconSize: [30, 30], iconAnchor: [15, -10]}) 
                }).addTo(ns.map);
                
                window.currentEditMarker.on('click', () => showAuditModal(feature, record, kmlName));
            });
        });
    };

    // ==========================================
    // 4. 浮動對話框邏輯、相機壓縮、防呆
    // ==========================================
    function showAuditModal(feature, existingData, kmlName) {
        const featureName = feature.properties.name;
        const modal = document.createElement('div');
        modal.className = 'audit-modal';
        // 基本樣式防禦
        modal.style.cssText = "position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:white; padding:20px; z-index:9999; border-radius:8px; box-shadow:0 4px 6px rgba(0,0,0,0.3); max-width:90%; max-height:90vh; overflow-y:auto;";
        
        modal.innerHTML = `
            <h3 style="margin-top:0;">點位: ${featureName}</h3>
            <div style="margin-bottom:10px;">
                <label>狀態 (A): </label>
                <select id="aStatus">
                    <option value="" disabled ${!existingData ? 'selected' : ''}>請選擇</option>
                    <option value="存在" ${existingData?.status === '存在' ? 'selected' : ''}>存在</option>
                    <option value="破損" ${existingData?.status === '破損' ? 'selected' : ''}>破損</option>
                    <option value="遺失" ${existingData?.status === '遺失' ? 'selected' : ''}>遺失</option>
                </select>
            </div>
            <div style="margin-bottom:10px;">
                <label>備註 (B): </label>
                <textarea id="aNote" style="width:100%;" placeholder="輸入備註...">${existingData?.note || ''}</textarea>
            </div>
            <div style="margin-bottom:10px;">
                <label>照片 (C) - 需 ${auditPhotoCount} 張: </label>
                <input type="file" id="photoInput" accept="image/*" capture="camera">
                <div id="photoPreview" style="display:flex; gap:5px; flex-wrap:wrap; margin-top:5px;"></div>
            </div>
            <div style="text-align:right;">
                <button id="cancelBtn" style="margin-right:10px;">取消</button>
                <button id="confirmBtn" disabled>確定儲存</button>
            </div>
        `;
        document.body.appendChild(modal);

        let photoBlobs = []; // 暫存拍攝並壓縮後的照片

        // A選取 + C張數齊全，確定按鈕啟用判斷
        const checkValidation = () => {
            const status = document.getElementById('aStatus').value;
            const btn = document.getElementById('confirmBtn');
            // 若為修正模式 (已有資料)，可直接存。若為新增，需滿足照片張數
            const isValid = status !== "" && (existingData || photoBlobs.length >= auditPhotoCount);
            btn.disabled = !isValid;
            btn.style.backgroundColor = isValid ? '#4CAF50' : '';
            btn.style.color = isValid ? 'white' : '';
        };

        document.getElementById('aStatus').addEventListener('change', checkValidation);

        // 照片上傳與 Canvas 壓縮 (800x600)
        document.getElementById('photoInput').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 800; canvas.height = 600;
                    canvas.getContext('2d').drawImage(img, 0, 0, 800, 600);
                    
                    canvas.toBlob((blob) => {
                        photoBlobs.push(blob);
                        
                        // 顯示預覽圖
                        const previewImg = document.createElement('img');
                        previewImg.src = URL.createObjectURL(blob);
                        previewImg.style.width = '60px';
                        previewImg.style.height = '45px';
                        previewImg.style.objectFit = 'cover';
                        document.getElementById('photoPreview').appendChild(previewImg);
                        
                        // 清理記憶體
                        canvas.width = 0; canvas.height = 0; img.src = '';
                        checkValidation();
                    }, 'image/jpeg', 0.85);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });

        // ==========================================
        // 5. Firebase Storage 上傳與 Firestore 寫入
        // ==========================================
        document.getElementById('confirmBtn').onclick = async () => {
            document.getElementById('confirmBtn').textContent = '上傳中...';
            document.getElementById('confirmBtn').disabled = true;

            try {
                const photoUrls = existingData?.photoUrls || [];
                
                // 上傳新照片至 Storage (儲存路徑與命名規範)
                for (let i = 0; i < photoBlobs.length; i++) {
                    const idx = photoUrls.length + 1;
                    const path = `audit_photos/${kmlName}/${featureName}-${idx}.jpg`;
                    const fileRef = storage.ref(path);
                    await fileRef.put(photoBlobs[i]);
                    const url = await fileRef.getDownloadURL();
                    photoUrls.push(url);
                }

                // 準備寫入資料
                const data = {
                    kmlName: kmlName,
                    featureName: featureName,
                    status: document.getElementById('aStatus').value,
                    note: document.getElementById('aNote').value,
                    photoUrls: photoUrls,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    auditedBy: auth.currentUser?.email || 'unknown'
                };

                // 調整寫入邏輯：錨定點名 (使用 kmlName_featureName)
                const docId = `${kmlName}_${featureName}`;
                await db.collection('auditRecords').doc(docId).set(data, { merge: true });

                modal.remove();
                if (window.currentEditMarker) ns.map.removeLayer(window.currentEditMarker);
                window.addGeoJsonLayers(ns.allKmlFeatures); // 觸發重繪 (變粉紅點)
                window.showMessage?.('成功', '清查資料儲存完成。');

            } catch (error) {
                console.error("儲存失敗", error);
                window.showMessage?.('錯誤', '資料儲存失敗: ' + error.message);
                document.getElementById('confirmBtn').textContent = '確定儲存';
                document.getElementById('confirmBtn').disabled = false;
            }
        };

        document.getElementById('cancelBtn').onclick = () => modal.remove();
    }

    // ==========================================
    // 6. ZIP 封裝下載 (包含 JSON 紀錄與照片)
    // ==========================================
    downloadBtn.addEventListener('click', async () => {
        const kmlSelect = document.getElementById('kmlLayerSelect');
        const kmlName = kmlSelect && kmlSelect.options.length > 0 ? kmlSelect.options[kmlSelect.selectedIndex].text : null;
        
        if (!kmlName) {
            window.showMessage?.('提示', '請先選擇一個圖層以進行下載。');
            return;
        }

        try {
            downloadBtn.textContent = '打包中...';
            downloadBtn.disabled = true;

            const zip = new JSZip();
            const photoFolder = zip.folder(`${kmlName}_照片`); // 下載 ZIP 時保留檔名資料夾
            
            // 撈取 Firestore 資料
            const snap = await db.collection('auditRecords').where('kmlName', '==', kmlName).get();
            const exportData = [];
            const fetchPromises = [];

            snap.forEach(doc => {
                const data = doc.data();
                exportData.push(data);

                // 抓取圖片轉為 Blob 塞入 ZIP
                if (data.photoUrls && data.photoUrls.length > 0) {
                    data.photoUrls.forEach((url, idx) => {
                        const fileName = `${data.featureName}-${idx + 1}.jpg`;
                        const p = fetch(url)
                            .then(res => res.blob())
                            .then(blob => photoFolder.file(fileName, blob))
                            .catch(err => console.warn(`無法下載圖片 ${fileName}`, err));
                        fetchPromises.push(p);
                    });
                }
            });

            await Promise.all(fetchPromises); // 等待所有照片下載完成
            
            // 寫入 JSON 報表
            zip.file(`${kmlName}_清查紀錄表.json`, JSON.stringify(exportData, null, 2));

            // 產生並下載 ZIP
            const content = await zip.generateAsync({ type: "blob" });
            saveAs(content, `${kmlName}_清查總檔.zip`);

        } catch (error) {
            console.error("下載失敗", error);
            window.showMessage?.('錯誤', '下載 ZIP 失敗: ' + error.message);
        } finally {
            downloadBtn.textContent = '下載清查資料 (ZIP)';
            downloadBtn.disabled = false;
        }
    });

    // ==========================================
    // 7. 刪除圖層時的清理邏輯 (公開 API 給外部呼叫)
    // ==========================================
    // 請在 auth-kml-management.js 的 deleteSelectedKmlBtn 成功刪除後，呼叫 window.cleanupAuditData(kmlName);
    window.cleanupAuditData = async function(kmlName) {
        try {
            // 1. 刪除 Firestore 紀錄
            const snap = await db.collection('auditRecords').where('kmlName', '==', kmlName).get();
            const batch = db.batch();
            snap.forEach(doc => batch.delete(doc.ref));
            await batch.commit();

            // 2. 刪除 Storage 照片 (需遍歷目錄)
            const folderRef = storage.ref(`audit_photos/${kmlName}/`);
            const listRes = await folderRef.listAll();
            const deletePromises = listRes.items.map(itemRef => itemRef.delete());
            await Promise.all(deletePromises);
            
            console.log(`[清理] 圖層 ${kmlName} 的清查紀錄與照片已徹底刪除。`);
        } catch (error) {
            console.error(`清理圖層 ${kmlName} 的清查資料時發生錯誤:`, error);
        }
    };

})();