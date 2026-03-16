// audit-module.js v4.0 - 全功能整合版
(function() {
    'use strict';
    
    const db = firebase.firestore();
    const storage = firebase.storage();
    const currentAppId = (typeof appId !== 'undefined') ? appId : 'kmldata-d22fb';

    // --- 內部狀態變數 ---
    let isAuditMode = false;
    let auditPhotoCount = 2; 
    let currentKmlName = "";
    let auditDataCache = {}; // 存放點位清查狀態，避免重複讀取資料庫

    // ==========================================
    // 2. 狀態同步 (跨裝置即時同步)
    // ==========================================
    // 監聽 Firebase 上的同步標記，當其他裝置開啟清查時，本機自動同步
    db.collection('artifacts').doc(currentAppId).collection('public').doc('auditSync')
        .onSnapshot((doc) => {
            const data = doc.data();
            if (data && data.active !== undefined) {
                syncInternalState(data.active, data.kmlName, data.photoCount);
            }
        });

    async function syncInternalState(active, kmlName, photoCount) {
        isAuditMode = active;
        currentKmlName = kmlName;
        auditPhotoCount = photoCount;
        
        // 更新 UI 按鈕文字 (如果按鈕存在)
        const btn = document.getElementById('auditKmlBtn');
        const zipBtn = document.getElementById('downloadAuditZipBtn');
        if (btn) {
            btn.textContent = active ? "關閉清查" : "開啟清查";
            btn.style.backgroundColor = active ? "#6c757d" : "#fd7e14";
        }
        if (zipBtn) zipBtn.style.display = active ? 'block' : 'none';
        
        console.log(`[同步] 清查模式已${active ? '啟動' : '關閉'}: ${kmlName}`);
    }

    // ==========================================
    // 3. 地圖渲染攔截 (Hook)
    // ==========================================
    // 攔截 Leaflet 的 bindPopup 或 click 事件
    window.addEventListener('auditModeChanged', (e) => {
        // 當模式改變時，全台圖資標籤會根據 isAuditMode 決定彈窗內容
        // 此處 logic 通常由 map-engine.js 配合 e.detail.active 執行
    });

    // ==========================================
    // 4 & 5. 對話框邏輯、相機、Firebase 寫入
    // ==========================================
    window.handlePointAudit = async function(pointId, lat, lng) {
        if (!isAuditMode) return;

        // 建立浮動對話框 (簡易版實作)
        const note = prompt("請輸入備註 (選填):", "");
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.capture = 'environment'; // 直接啟動相機
        
        fileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            window.showMessage?.('系統', '正在上傳照片...');
            
            // 壓縮與上傳邏輯
            const storageRef = storage.ref(`audit_photos/${currentKmlName}/${pointId}_${Date.now()}.jpg`);
            await storageRef.put(file);
            const photoUrl = await storageRef.getDownloadURL();

            // 寫入 Firestore
            await db.collection('auditRecords').add({
                appId: currentAppId,
                kmlName: currentKmlName,
                pointId: pointId,
                lat: lat,
                lng: lng,
                photoUrls: [photoUrl],
                note: note,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            window.showMessage?.('成功', `點位 ${pointId} 清查完成`);
        };
        fileInput.click();
    };

    // ==========================================
    // 6. ZIP 封裝下載 (包含紀錄與照片)
    // ==========================================
    window.downloadAuditZip = async function(kmlName) {
        const targetKml = kmlName || currentKmlName;
        try {
            window.showMessage?.('系統', '打包中...');
            const snap = await db.collection('auditRecords').where('kmlName', '==', targetKml).get();
            if (snap.empty) return window.showMessage?.('提示', '尚無紀錄');

            const zip = new JSZip();
            const photoFolder = zip.folder("photos");
            let csvContent = "\ufeff編號,座標,備註,時間\n";

            for (const doc of snap.docs) {
                const d = doc.data();
                csvContent += `${d.pointId},"${d.lat},${d.lng}",${d.note},${d.timestamp?.toDate().toLocaleString()}\n`;
                if (d.photoUrls) {
                    const res = await fetch(d.photoUrls[0]);
                    const blob = await res.blob();
                    photoFolder.file(`${d.pointId}.jpg`, blob);
                }
            }
            zip.file("records.csv", csvContent);
            const content = await zip.generateAsync({type:"blob"});
            saveAs(content, `${targetKml}_清查.zip`);
        } catch (err) {
            console.error(err);
        }
    };

    // ==========================================
    // 7. 刪除與清理 API
    // ==========================================
    window.cleanupAuditData = async function(kmlName) {
        if (!confirm(`確定要刪除「${kmlName}」的所有清查照片與紀錄嗎？此動作不可逆。`)) return;
        
        try {
            const snap = await db.collection('auditRecords').where('kmlName', '==', kmlName).get();
            const batch = db.batch();
            snap.forEach(doc => batch.delete(doc.ref));
            await batch.commit();

            const folderRef = storage.ref(`audit_photos/${kmlName}/`);
            const list = await folderRef.listAll();
            await Promise.all(list.items.map(i => i.delete()));
            
            window.showMessage?.('成功', '清查資料已完整清理');
        } catch (err) {
            console.error(err);
        }
    };

    // ==========================================
    // 1. 公開接口掛載 (與管理按鈕對接)
    // ==========================================
// 1. 開啟清查
    window.openAuditInterface = function(kmlName, targetCount) {
        isAuditMode = true; 
        auditPhotoCount = parseInt(targetCount);
        window.currentAuditKmlName = kmlName; // 紀錄當前清查目標圖層
        
        console.log(`[Audit] 模式啟動: ${kmlName}, 目標: ${targetCount}張`);
        // 觸發地圖重新渲染點位邏輯 (如果有對應函式)
        if (typeof refreshMarkers === 'function') refreshMarkers();
    };

    // 2. 關閉清查
    window.setAuditMode = function(isActive) {
        isAuditMode = isActive;
        if (!isActive) window.currentAuditKmlName = null;
    };

    // 3. 打包下載 (對接綠色按鈕)
    window.downloadAuditZip = async function(kmlName) {
        if (!kmlName) {
            window.showMessage?.('錯誤', '未選擇圖層，無法下載。');
            return;
        }

        try {
            window.showMessage?.('系統', `正在打包「${kmlName}」的資料，請稍候...`);
            
            // 1. 從 Firestore 查詢該圖層的所有清查紀錄
            const snap = await db.collection('auditRecords')
                                 .where('kmlName', '==', kmlName)
                                 .get();
            
            if (snap.empty) {
                window.showMessage?.('提示', '該圖層目前沒有任何清查紀錄。');
                return;
            }

            // 2. 初始化 JSZip
            const zip = new JSZip();
            const photoFolder = zip.folder("現場照片");
            
            // 加入 BOM (Byte Order Mark) 確保 Excel 開啟 CSV 時不會有中文亂碼
            let csvContent = "\ufeff編號,座標,備註,清查時間\n";

            // 3. 遍歷每一筆紀錄
            const downloadTasks = snap.docs.map(async (doc) => {
                const data = doc.data();
                
                // 格式化 CSV 行
                const timestamp = data.timestamp ? data.timestamp.toDate().toLocaleString() : '';
                csvContent += `${data.pointId || '無編號'},"${data.lat || 0},${data.lng || 0}",${data.note || ''},${timestamp}\n`;
                
                // 如果有照片，下載並存入 ZIP
                if (data.photoUrls && Array.isArray(data.photoUrls)) {
                    for (let i = 0; i < data.photoUrls.length; i++) {
                        try {
                            const response = await fetch(data.photoUrls[i]);
                            const blob = await response.blob();
                            photoFolder.file(`${data.pointId || '點位'}_照片${i + 1}.jpg`, blob);
                        } catch (err) {
                            console.error(`圖片下載失敗: ${data.photoUrls[i]}`, err);
                        }
                    }
                }
            });

            // 等待所有圖片下載完成
            await Promise.all(downloadTasks);
            
            // 將 CSV 加入 ZIP
            zip.file("清查紀錄表.csv", csvContent);

            // 4. 生成 ZIP 並強制下載
            const content = await zip.generateAsync({ type: "blob" });
            saveAs(content, `${kmlName}_清查報告_${new Date().toISOString().slice(0, 10)}.zip`);
            
            window.showMessage?.('成功', '打包完成，下載已開始。');

        } catch (error) {
            console.error("[Audit] 下載 ZIP 失敗:", error);
            window.showMessage?.('錯誤', '下載過程發生錯誤: ' + error.message);
        }
    };
})();