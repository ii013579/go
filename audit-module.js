/**
 * audit-module.js - 清查系統完整核心邏輯 (精簡加固版)
 * 包含：狀態監聽、點位自動變色、照片 800x600 處理、ZIP 下載、對話框
 */
(function() {
    'use strict';

    const db = firebase.firestore();
    const storage = firebase.storage();
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    
    window.auditLayersState = {};
    const auditUnsubscribes = {};

    // --- [1. 狀態監聽：確保重開網頁能恢復顏色與按鈕] ---
    window.watchAuditStatus = function(kmlId) {
        // 防止重複監聽同一個圖層
        if (auditUnsubscribes[kmlId]) return;

        console.log(`[監聽啟動] 圖層: ${kmlId}`);
        const docRef = db.collection('artifacts').doc('kmldata-d22fb')
                         .collection('public').doc('data')
                         .collection('kmlLayers').doc(kmlId);

        auditUnsubscribes[kmlId] = docRef.onSnapshot((doc) => {
            if (!doc.exists) {
                console.warn(`[系統] 圖層 ${kmlId} 在資料庫中不存在`);
                return;
            }

            const data = doc.data();
            // 同步雲端狀態到全域快取
            if (data && data.auditStamp) {
                window.auditLayersState[kmlId] = data.auditStamp;
                console.log(`[狀態同步] ${kmlId} 狀態:`, data.auditStamp.enabled ? "開啟" : "關閉");
            } else {
                delete window.auditLayersState[kmlId];
            }
            
            // 觸發 UI 與地圖聯動 (變色與按鈕樣式)
            if (window.refreshMapLayers) window.refreshMapLayers(kmlId);
            
            // 更新按鈕樣式 (選配)
            const auditBtn = document.getElementById('auditKmlBtn');
            if (auditBtn) {
                const isAnyEnabled = Object.values(window.auditLayersState).some(s => s.enabled);
                auditBtn.classList.toggle('active', isAnyEnabled);
            }
        }, (error) => console.error(`[監聽失敗] ${kmlId}:`, error));
    };

    // --- [2. 地圖遍歷重繪：根據快取狀態變色] ---
    window.refreshMapLayers = function(targetKmlId = null) {
        if (typeof map === 'undefined') return;

        map.eachLayer(layer => {
            if (layer instanceof L.CircleMarker && layer.options && layer.options.kmlId) {
                const kmlId = layer.options.kmlId;
                if (targetKmlId && kmlId !== targetKmlId) return;

                const props = layer.feature.properties;
                const hasRecord = !!(props.auditStatus || props.auditPhotoCount);

                // A. 更新顏色
                layer.setStyle(window.getAuditPointStyle(kmlId, hasRecord));

                // B. 更新 Popup
                const baseContent = `<b>${props.name || "點位"}</b>`;
                layer.setPopupContent(baseContent + window.injectAuditTools(props, kmlId));
            }
        });
    };

    // --- [3. 樣式與工具注入 (帶圖示按鈕)] ---
    window.getAuditPointStyle = function(kmlId, hasRecord) {
        const config = window.auditLayersState[kmlId];
        let color = "#e74c3c"; // 預設紅色
        if (config && config.enabled) {
            color = hasRecord ? "#ff85c0" : "#3498db"; // 粉紅(已查) : 藍色(待查)
        }
        return { fillColor: color, fillOpacity: 1, color: "#ffffff", weight: 2, radius: 8 };
    };

    window.injectAuditTools = function(props, kmlId) {
        const config = window.auditLayersState[kmlId];
        if (!config || !config.enabled) return '';
    
        const isDone = !!props.auditStatus;
        const iconUrl = isDone 
            ? 'https://cdn-icons-png.freepik.com/512/8280/8280538.png' 
            : 'https://cdn-icons-png.freepik.com/512/8280/8280556.png';
    
        return `
            <div style="margin-top:10px; border-top:1px dashed #ccc; padding-top:10px;">
                <button onclick="window.openAuditEditor('${props.id}', '${kmlId}')" 
                        style="width:100%; padding:8px; border-radius:5px; border:1px solid #ddd; background:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px;">
                    <img src="${iconUrl}" style="width:16px; height:16px;">
                    <span style="font-weight:bold;">${isDone ? '修正清查' : '編輯清查'}</span>
                </button>
            </div>`;
    };

    // --- [4. 管理彈窗渲染] ---
    window.renderAuditModal = function(layers) {
        let html = `<div style="text-align: left;"><p style="font-size: 14px; color:#666;">勾選要清查的圖層：</p>
                    <div style="max-height: 250px; overflow-y: auto; border: 1px solid #ddd; border-radius: 8px;">`;
        layers.forEach(layer => {
            const isEnabled = window.auditLayersState[layer.id]?.enabled;
            html += `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; border-bottom: 1px solid #eee;">
                    <label style="display: flex; align-items: center; cursor: pointer; flex: 1; min-width: 0;">
                        <input type="checkbox" name="auditKml" value="${layer.id}" ${isEnabled ? 'checked' : ''} 
                               onchange="window.toggleDownloadBtn(this, '${layer.id}')" style="width: 18px; height: 18px;">
                        <span style="margin-left: 10px; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${layer.name}</span>
                    </label>
                    <button id="dlBtn_${layer.id}" style="display: ${isEnabled ? 'inline-block' : 'none'}; width: 70px; height: 30px; background: #28a745; color: white; border: none; border-radius: 6px; font-size: 12px; cursor: pointer;"
                            onclick="window.downloadAuditZip('${layer.id}', '${layer.name}')">下載</button>
                </div>`;
        });
        html += `</div><div style="margin-top: 15px;"><p style="font-weight: bold; margin-bottom: 5px;">目標清查張數：</p>
                 <input type="number" id="auditPhotoCountInput" value="10" min="2" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 5px; box-sizing: border-box;"></div></div>`;
        return html;
    };

    // --- [5. 開啟/關閉清查與資料寫入] ---
    window.openAuditInterface = async function(kmlId, count, isEnabled = true) {
        try {
            await db.doc(`${APP_PATH}/${kmlId}`).set({ 
                auditStamp: { 
                    enabled: isEnabled, 
                    targetCount: parseInt(count),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
                } 
            }, { merge: true });
        } catch (e) { console.error("狀態切換失敗", e); }
    };

    window.toggleDownloadBtn = function(checkbox, id) {
        const btn = document.getElementById(`dlBtn_${id}`);
        if (btn) btn.style.display = checkbox.checked ? 'inline-block' : 'none';
    };

    window.showAuditActionModal = function(title, content) {
        return new Promise((resolve) => {
            Swal.fire({
                title: title, html: content,
                showCancelButton: true, showDenyButton: true,
                confirmButtonText: '開啟', denyButtonText: '關閉', cancelButtonText: '取消',
                confirmButtonColor: '#ff8533', denyButtonColor: '#4a90e2'
            }).then((res) => {
                if (res.isConfirmed) resolve('open');
                else if (res.isDenied) resolve('close');
                else resolve(null);
            });
        });
    };

    // --- [6. 照片處理 (800x600) 與 下載] ---
    window.downloadAuditZip = async function(kmlId, kmlName) {
        const zip = new JSZip();
        try {
            const doc = await db.doc(`${APP_PATH}/${kmlId}`).get();
            const nodes = doc.data().nodes || [];
            let csv = "\ufeff點名,狀況,備註\n";
            nodes.forEach(n => { if(n.auditStatus) csv += `${n.id},${n.auditStatus},${n.auditNote || ''}\n`; });
            zip.file("清查紀錄表.csv", csv);
            
            const list = await storage.ref(kmlId).listAll();
            await Promise.all(list.items.map(async (item) => {
                const url = await item.getDownloadURL();
                const blob = await (await fetch(url)).blob();
                zip.file(`現場照片/${item.name}`, blob);
            }));
            const content = await zip.generateAsync({type:"blob"});
            saveAs(content, `${kmlName}_清查報告.zip`);
        } catch (e) { Swal.fire("下載失敗", "請確認該圖層是否有上傳照片", "error"); }
    };

})();