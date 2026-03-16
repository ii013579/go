/**
 * audit-module.js - 清查系統核心
 * 職責：狀態持久化、UI 生成、打包下載、雲端清理
 */
(function() {
    'use strict';

    const db = firebase.firestore();
    const storage = firebase.storage();
    const syncDocRef = db.collection('artifacts').doc('audit_status');

    // 1. 初始化全域狀態
    window.auditState = {
        activeLayers: new Set(),
        targetCount: 10
    };

    // 2. 雲端同步監聽 (確保跨裝置狀態一致)
    syncDocRef.onSnapshot((doc) => {
        const data = doc.data();
        if (data) {
            window.auditState.activeLayers = new Set(data.activeLayers || []);
            window.auditState.targetCount = data.targetCount || 10;
        }
    });

    // 3. UI 彈窗生成 (對應您的勾選需求)
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

    // 輔助函式：切換下載按鈕顯示
    window.toggleDownloadBtn = function(checkbox, kmlName) {
        const btn = document.getElementById(`dlBtn_${kmlName}`);
        if (btn) btn.style.display = checkbox.checked ? 'block' : 'none';
    };

    // 4. API：開啟/關閉清查模式 (同步到 Firebase)
    window.openAuditInterface = async function(kmlNames, targetCount) {
        await syncDocRef.set({
            activeLayers: kmlNames,
            targetCount: parseInt(targetCount),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        window.dispatchEvent(new CustomEvent('auditModeChanged', { detail: { active: true, layers: kmlNames } }));
    };

    window.setAuditMode = async function(isActive) {
        if (!isActive) await syncDocRef.set({ activeLayers: [], targetCount: 10 });
        window.dispatchEvent(new CustomEvent('auditModeChanged', { detail: { active: isActive } }));
    };

    // 5. API：照片壓縮與打包下載
    window.downloadAuditZip = async function(kmlName) {
        try {
            window.showMessage?.('系統', `正在打包「${kmlName}」的資料...`);
            const snap = await db.collection('auditRecords').where('kmlName', '==', kmlName).get();
            
            if (snap.empty) return window.showMessage?.('提示', '該圖層無清查資料。');

            const zip = new JSZip();
            const photoFolder = zip.folder("現場照片");
            let csv = "\ufeff編號,座標,備註,時間\n";

            for (const doc of snap.docs) {
                const d = doc.data();
                csv += `${d.pointId || ''},"${d.lat || 0},${d.lng || 0}",${d.note || ''},${d.timestamp?.toDate().toLocaleString() || ''}\n`;
                if (d.photoUrls?.length > 0) {
                    const res = await fetch(d.photoUrls[0]);
                    photoFolder.file(`${d.pointId || '點位'}_照片.jpg`, await res.blob());
                }
            }
            zip.file("清查紀錄.csv", csv);
            saveAs(await zip.generateAsync({type: "blob"}), `${kmlName}_清查報告_${new Date().toISOString().slice(0, 10)}.zip`);
            window.showMessage?.('成功', '打包完成，下載已啟動。');
        } catch (e) {
            console.error(e);
            window.showMessage?.('錯誤', '下載失敗：' + e.message);
        }
    };

    // 6. API：資料清理 (對接圖層刪除事件)
    window.cleanupAuditData = async function(kmlName) {
        const batch = db.batch();
        const snap = await db.collection('auditRecords').where('kmlName', '==', kmlName).get();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        const list = await storage.ref(`audit_photos/${kmlName}/`).listAll();
        await Promise.all(list.items.map(i => i.delete()));
    };

})();