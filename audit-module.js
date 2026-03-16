/**
 * audit-module.js - 清查模組完整版
 * 負責：清查狀態同步、UI 彈窗、照片打包下載、資料清理
 */
(function() {
    'use strict';

    const db = firebase.firestore();
    const storage = firebase.storage();

    // 1. 全域清查狀態 (用於跨裝置同步)
    window.auditState = {
        activeLayers: new Set(), // 儲存已開啟清查的圖層名稱
        targetCount: 10          // 預設照片張數
    };

    // 監聽雲端同步狀態 (即時同步別的設備的變更)
    const syncDocRef = db.collection('artifacts').doc('audit_status');
    syncDocRef.onSnapshot((doc) => {
        const data = doc.data();
        if (data) {
            window.auditState.activeLayers = new Set(data.activeLayers || []);
            window.auditState.targetCount = data.targetCount || 10;
        }
    });

    // 2. 對話框渲染邏輯 (UI)
    window.renderAuditModal = function(layers) {
        let html = `
            <div style="text-align: left; margin-top: 10px;">
                <p>請勾選要進行清查的圖層：</p>
                <div id="auditLayerList" style="max-height: 250px; overflow-y: auto; border: 1px solid #ddd; padding: 10px;">`;
        
        layers.forEach(layer => {
            const isChecked = window.auditState.activeLayers.has(layer.name);
            html += `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                    <div>
                        <input type="checkbox" name="auditKml" value="${layer.name}" ${isChecked ? 'checked' : ''} 
                               onchange="toggleDownloadBtn(this, '${layer.name}')">
                        <span style="margin-left: 8px;">${layer.name}</span>
                    </div>
                    <button id="dlBtn_${layer.name}" class="action-buttons download-btn" 
                            style="display: ${isChecked ? 'block' : 'none'}; padding: 4px 8px; font-size: 12px;"
                            onclick="window.downloadAuditZip('${layer.name}')">下載</button>
                </div>`;
        });
        
        html += `</div>
                 <p style="margin-top: 15px;">預計清查照片張數：</p>
                 <input type="number" id="auditPhotoCountInput" value="${window.auditState.targetCount}" min="1" max="100" 
                        style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
            </div>`;
        return html;
    };

    window.toggleDownloadBtn = function(checkbox, kmlName) {
        const btn = document.getElementById(`dlBtn_${kmlName}`);
        if (btn) btn.style.display = checkbox.checked ? 'block' : 'none';
    };

    // 3. 核心功能 API
    window.openAuditInterface = async function(kmlNames, targetCount) {
        // 將狀態同步到雲端
        await syncDocRef.set({
            activeLayers: kmlNames,
            targetCount: parseInt(targetCount),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`[Audit] 模式已啟動: ${kmlNames.join(', ')}`);
        window.dispatchEvent(new CustomEvent('auditModeChanged', { detail: { active: true, layers: kmlNames } }));
    };

    window.setAuditMode = async function(isActive) {
        if (!isActive) {
            await syncDocRef.set({ activeLayers: [], targetCount: 10 });
        }
        window.dispatchEvent(new CustomEvent('auditModeChanged', { detail: { active: isActive } }));
    };

    // 4. 下載 ZIP (含 CSV 與照片)
    window.downloadAuditZip = async function(kmlName) {
        try {
            window.showMessage?.('系統', `正在處理「${kmlName}」的打包作業...`);
            const snap = await db.collection('auditRecords').where('kmlName', '==', kmlName).get();
            
            if (snap.empty) return window.showMessage?.('提示', '目前無清查資料。');

            const zip = new JSZip();
            const photoFolder = zip.folder("現場照片");
            let csvContent = "\ufeff編號,座標,備註,清查時間\n";

            for (const doc of snap.docs) {
                const d = doc.data();
                csvContent += `${d.pointId || ''},"${d.lat || 0},${d.lng || 0}",${d.note || ''},${d.timestamp?.toDate().toLocaleString() || ''}\n`;
                
                if (d.photoUrls && Array.isArray(d.photoUrls)) {
                    for (let i = 0; i < d.photoUrls.length; i++) {
                        const res = await fetch(d.photoUrls[i]);
                        photoFolder.file(`${d.pointId || '點位'}_${i+1}.jpg`, await res.blob());
                    }
                }
            }
            
            zip.file("清查紀錄表.csv", csvContent);
            saveAs(await zip.generateAsync({type: "blob"}), `${kmlName}_清查報告.zip`);
            window.showMessage?.('成功', '下載已開始！');
        } catch (e) {
            console.error(e);
            window.showMessage?.('錯誤', '下載失敗：' + e.message);
        }
    };

    // 5. 數據清理 (對接刪除圖層功能)
    window.cleanupAuditData = async function(kmlName) {
        const batch = db.batch();
        const snap = await db.collection('auditRecords').where('kmlName', '==', kmlName).get();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        const list = await storage.ref(`audit_photos/${kmlName}/`).listAll();
        await Promise.all(list.items.map(i => i.delete()));
    };

})();