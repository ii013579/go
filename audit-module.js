/**
 * audit-module.js - 清查系統完整核心邏輯
 * 職責：各別圖層戳記管理、CSS 點位渲染、照片處理、ZIP 打包下載
 */
(function() {
    'use strict';

    const db = firebase.firestore();
    const storage = firebase.storage();
    
    // 本地快取：存放各圖層的清查狀態 { kmlId: { enabled: true, targetCount: 10 } }
    window.auditLayersState = {};
    const auditUnsubscribes = {};

    // --- [1. 狀態監聽：監聽個別圖層資料夾下的戳記] ---
    window.watchAuditStatus = function(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        const path = `artifacts/kmldata-d22fb/public/data/kmlLayers/${kmlId}`;
        
        auditUnsubscribes[kmlId] = db.doc(path).onSnapshot((doc) => {
            const data = doc.data();
            // 讀取該圖層資料夾下的 auditStamp
            if (data && data.auditStamp) {
                window.auditLayersState[kmlId] = data.auditStamp;
            } else {
                delete window.auditLayersState[kmlId];
            }
            
            // 狀態變更時，觸發地圖重新渲染
            if (window.refreshMapLayers) window.refreshMapLayers();
            
            // 更新管理按鈕顏色
            const auditBtn = document.getElementById('auditKmlBtn');
            if (auditBtn) {
                const anyActive = Object.values(window.auditLayersState).some(s => s.enabled);
                anyActive ? auditBtn.classList.add('active') : auditBtn.classList.remove('active');
            }
        });
    };

    // --- [2. 地圖渲染：CircleMarker 樣式判定] ---
    window.getAuditPointStyle = function(kmlId, hasRecord) {
        const style = {
            radius: 8, // 保持與紅點一致的半徑
            fillOpacity: 1,
            color: "#ffffff", // 白色外框
            weight: 2,
            opacity: 1,
            interactive: true
        };

        const config = window.auditLayersState[kmlId];
        if (!config || !config.enabled) {
            style.fillColor = "#e74c3c"; // 一般模式：紅點
        } else {
            // 清查模式：完成為粉紅(#ff85c0)，未完成為藍色(#3498db)
            style.fillColor = hasRecord ? "#ff85c0" : "#3498db"; 
        }
        return style;
    };

    // --- [3. 導航欄 UI 注入：編輯/修改按鈕與圖示] ---
    window.injectAuditTools = function(point, kmlId) {
        if (!window.auditLayersState[kmlId]?.enabled) return '';

        const isDone = !!point.auditStatus; 
        const iconUrl = isDone 
            ? 'https://cdn-icons-png.freepik.com/512/8280/8280538.png' // 修改圖示
            : 'https://cdn-icons-png.freepik.com/512/8280/8280556.png'; // 編輯圖示
        
        return `
            <div class="audit-tool-panel" style="margin-top: 10px; border-top: 1px dashed #ddd; padding-top: 10px;">
                <button onclick="window.openAuditEditor('${point.id}', '${kmlId}', ${JSON.stringify(point).replace(/"/g, '&quot;')})" 
                        style="width: 100%; background: white; border: 1px solid #ccc; padding: 10px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <img src="${iconUrl}" style="width: 20px; height: 20px;">
                    <span style="font-weight: bold; color: #333;">${isDone ? '修改清查紀錄' : '編輯清查紀錄'}</span>
                </button>
            </div>`;
    };

    // --- [4. 編輯器彈窗與照片處理 (800x600)] ---
    window.tempPhotos = {}; 

    window.openAuditEditor = function(pointId, kmlId, pointData) {
        window.tempPhotos = {}; 
        let html = `
            <div id="auditEditor" style="text-align: left;">
                <p><strong>標題：</strong> ${pointId}</p>
                <div style="margin-bottom:10px;">
                    <strong>狀況：</strong>
                    <select id="auditStatus" style="width: 100%; padding: 8px;">
                        <option value="存在" ${pointData.auditStatus === '存在' ? 'selected' : ''}>存在</option>
                        <option value="破損" ${pointData.auditStatus === '破損' ? 'selected' : ''}>破損</option>
                        <option value="遺失" ${pointData.auditStatus === '遺失' ? 'selected' : ''}>遺失</option>
                    </select>
                </div>
                <div style="margin-bottom:10px;">
                    <strong>備註：</strong>
                    <textarea id="auditNote" style="width: 100%; height: 60px; padding: 8px;">${pointData.auditNote || ''}</textarea>
                </div>
                <p><strong>照片 (2~8 張)：</strong></p>
                <div id="photoGrid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
                    ${Array.from({length: 8}, (_, i) => `
                        <div onclick="document.getElementById('file_${i}').click()" 
                             style="width: 100%; aspect-ratio: 1; border: 1px dashed #aaa; display: flex; align-items: center; justify-content: center; cursor: pointer; position: relative; background: #fafafa;">
                            <span id="label_${i}">${i + 1}</span>
                            <img id="img_${i}" style="display: none; width: 100%; height: 100%; object-fit: cover;">
                            <input type="file" id="file_${i}" accept="image/*" capture="camera" style="display: none;" onchange="window.handleAuditPhoto(this, ${i}, '${pointId}')">
                        </div>
                    `).join('')}
                </div>
            </div>`;

        window.showConfirmationModal(`點位清查 - ${pointId}`, html, async () => {
            await window.saveAuditData(pointId, kmlId);
        });
    };

    window.handleAuditPhoto = function(input, index, pointId) {
        if (!input.files?.[0]) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 800; canvas.height = 600; // 強制轉成 800x600尺寸
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 800, 600);
                canvas.toBlob((blob) => {
                    window.tempPhotos[index] = blob;
                    const preview = document.getElementById(`img_${index}`);
                    preview.src = URL.createObjectURL(blob);
                    preview.style.display = 'block';
                    document.getElementById(`label_${index}`).style.display = 'none';
                }, 'image/jpeg', 0.8);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    };

    // --- [5. 儲存與下載邏輯 (路徑解耦)] ---
    window.saveAuditData = async function(pointId, kmlId) {
        const status = document.getElementById('auditStatus').value;
        const note = document.getElementById('auditNote').value;
        const path = `artifacts/kmldata-d22fb/public/data/kmlLayers/${kmlId}`;

        // 1. 上傳至 Storage (檔名：點位-序號)
        const uploadTasks = Object.entries(window.tempPhotos).map(([idx, blob]) => {
            const ref = storage.ref(`${kmlId}/${pointId}-${parseInt(idx)+1}.jpg`);
            return ref.put(blob);
        });
        await Promise.all(uploadTasks);

        // 2. 寫入狀況與備註到圖層 Doc
        const doc = await db.doc(path).get();
        const nodes = doc.data().nodes || [];
        const updatedNodes = nodes.map(n => n.id === pointId ? { ...n, auditStatus: status, auditNote: note } : n);
        await db.doc(path).update({ nodes: updatedNodes });
    };

    window.downloadAuditZip = async function(kmlId, kmlName) {
        const zip = new JSZip();
        const doc = await db.doc(`artifacts/kmldata-d22fb/public/data/kmlLayers/${kmlId}`).get();
        const nodes = doc.data().nodes || [];

        // 製作 CSV
        let csv = "\ufeff點名,狀況,備註\n";
        nodes.forEach(n => { if(n.auditStatus) csv += `${n.id},${n.auditStatus},${n.auditNote || ''}\n`; });
        zip.file("清查紀錄.csv", csv);

        // 打包照片
        const photoFolder = zip.folder("照片檔案");
        const list = await storage.ref(kmlId).listAll();
        await Promise.all(list.items.map(async (item) => {
            const blob = await (await fetch(await item.getDownloadURL())).blob();
            photoFolder.file(item.name, blob);
        }));

        const content = await zip.generateAsync({type:"blob"});
        saveAs(content, `${kmlName}_清查報告.zip`);
    };

    // --- [6. UI 彈窗渲染與操作介面] ---
    window.renderAuditModal = function(layers) {
        let html = `
            <div style="text-align: left; margin-top: 10px;">
                <p>請勾選清查圖層：</p>
                <div id="auditLayerList" style="max-height: 250px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; border-radius: 8px;">`;
        
        layers.forEach(layer => {
            const isEnabled = window.auditLayersState[layer.id]?.enabled;
            html += `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee;">
                    <div>
                        <input type="checkbox" name="auditKml" value="${layer.id}" ${isEnabled ? 'checked' : ''} onchange="window.toggleDownloadBtn(this, '${layer.id}')">
                        <span style="margin-left: 8px;">${layer.name}</span>
                    </div>
                    <button id="dlBtn_${layer.id}" class="action-buttons" 
                            style="display: ${isEnabled ? 'block' : 'none'}; padding: 4px 12px; background: #28a745; color: white; border: none; border-radius: 4px;"
                            onclick="window.downloadAuditZip('${layer.id}', '${layer.name}')">下載</button>
                </div>`;
        });
        
        html += `</div>
                 <p style="margin-top: 15px;">預計清查照片張數：</p>
                 <input type="number" id="auditPhotoCountInput" value="10" min="1" max="100" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px;">
            </div>`;
        return html;
    };

    window.toggleDownloadBtn = function(checkbox, id) {
        const btn = document.getElementById(`dlBtn_${id}`);
        if (btn) btn.style.display = checkbox.checked ? 'block' : 'none';
    };

    // --- [7. 啟動/關閉 API] ---
    window.openAuditInterface = async function(kmlId, count, isEnabled = true) {
        const path = `artifacts/kmldata-d22fb/public/data/kmlLayers/${kmlId}`;
        await db.doc(path).set({ 
            auditStamp: { 
                enabled: isEnabled, 
                targetCount: parseInt(count),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
            } 
        }, { merge: true });
    };

})();