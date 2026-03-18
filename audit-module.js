/**
 * audit-module.js - 清查系統完整核心邏輯
 * 包含：狀態監聽、CSS 樣式判定、照片 800x600 處理、ZIP 下載、自定義對話框
 */
(function() {
    'use strict';

    const db = firebase.firestore();
    const storage = firebase.storage();
    
    // 全域狀態快取
    window.auditLayersState = {};
    const auditUnsubscribes = {};

    // --- [1. 狀態監聽：與 KML 資料夾同步] ---
    window.watchAuditStatus = function(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        // 路徑指向個別圖層資料夾
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
            
            // 更新管理列按鈕樣式
            const auditBtn = document.getElementById('auditKmlBtn');
            if (auditBtn) {
                const anyActive = Object.values(window.auditLayersState).some(s => s.enabled);
                anyActive ? auditBtn.classList.add('active') : auditBtn.classList.remove('active');
            }
        });
    };

    // --- [2. 地圖渲染：CSS 樣式判定] ---
    window.getAuditPointStyle = function(kmlId, hasRecord) {
        const style = {
            radius: 8, // 預設半徑
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
            // 清查模式：完成為粉紅 (#ff85c0)，未完成為藍色 (#3498db)
            style.fillColor = hasRecord ? "#ff85c0" : "#3498db"; 
        }
        return style;
    };

    // --- [3. 介面注入：導航欄編輯/修改按鈕] ---
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

    // --- [4. 對話框核心：修正 showAuditActionModal] ---
    window.showAuditActionModal = function(title, content) {
        return new Promise((resolve) => {
            if (typeof Swal === 'undefined') {
                console.error("SweetAlert2 未載入");
                return resolve(null);
            }
            Swal.fire({
                title: title,
                html: content,
                showCancelButton: true,
                showDenyButton: true,
                confirmButtonText: '開啟',
                denyButtonText: '關閉',
                cancelButtonText: '取消',
                confirmButtonColor: '#ff8533', // 清查橘
                denyButtonColor: '#4a90e2',    // 關閉藍
                reverseButtons: true
            }).then((result) => {
                if (result.isConfirmed) resolve('open');
                else if (result.isDenied) resolve('close');
                else resolve(null);
            });
        });
    };

    window.renderAuditModal = function(layers) {
        let html = `
            <div style="text-align: left; font-family: sans-serif;">
                <p style="margin-bottom: 10px; color: #555;">請從現存圖檔中勾選要操作的項目：</p>
                <div id="auditLayerList" style="max-height: 250px; overflow-y: auto; border: 1px solid #ddd; padding: 5px; border-radius: 8px; background: #fafafa;">`;
        
        layers.forEach(layer => {
            // 檢查該圖層目前的清查狀態 (從全域快取 window.auditLayersState 讀取)
            const isEnabled = window.auditLayersState[layer.id]?.enabled;
            const statusTag = isEnabled ? '<span style="color:#28a745; font-size:11px;">(清查中)</span>' : '';
    
            html += `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; border-bottom: 1px solid #eee; background: white; margin-bottom: 2px;">
                    <label style="display: flex; align-items: center; cursor: pointer; flex: 1;">
                        <input type="checkbox" name="auditKml" value="${layer.id}" ${isEnabled ? 'checked' : ''} 
                               onchange="window.toggleDownloadBtn(this, '${layer.id}')" style="width: 18px; height: 18px;">
                        <div style="margin-left: 10px;">
                            <div style="font-size: 15px; font-weight: 500;">${layer.name}</div>
                            ${statusTag}
                        </div>
                    </label>
                    <button id="dlBtn_${layer.id}" class="action-buttons" 
                            style="display: ${isEnabled ? 'block' : 'none'}; padding: 5px 12px; background: #28a745; color: white; border: none; border-radius: 4px; font-size: 12px;"
                            onclick="window.downloadAuditZip('${layer.id}', '${layer.name}')">下載</button>
                </div>`;
        });
        
        html += `</div>
                 <div style="margin-top: 15px; padding: 10px; background: #fffde7; border-radius: 6px; border: 1px solid #fff59d;">
                    <p style="margin: 0 0 5px 0; font-weight: bold; color: #856404;">設定：</p>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span>預計張數：</span>
                        <input type="number" id="auditPhotoCountInput" value="2" min="1" max="100" 
                               style="flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                    </div>
                 </div>
            </div>`;
        return html;
    };

    window.toggleDownloadBtn = function(checkbox, id) {
        const btn = document.getElementById(`dlBtn_${id}`);
        if (btn) btn.style.display = checkbox.checked ? 'block' : 'none';
    };

    // --- [5. 照片處理與儲存 (800x600)] ---
    window.tempPhotos = {}; 

    window.handleAuditPhoto = function(input, index, pointId) {
        if (!input.files?.[0]) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 800; canvas.height = 600;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 800, 600);
                canvas.toBlob((blob) => {
                    window.tempPhotos[index] = blob;
                    const preview = document.getElementById(`img_${index}`);
                    preview.src = URL.createObjectURL(blob);
                    preview.style.display = 'block';
                    document.getElementById(`label_${index}`).style.display = 'none';
                }, 'image/jpeg', 0.85);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    };

    window.saveAuditData = async function(pointId, kmlId) {
        const status = document.getElementById('auditStatus').value;
        const note = document.getElementById('auditNote').value;
        const path = `artifacts/kmldata-d22fb/public/data/kmlLayers/${kmlId}`;

        // 上傳照片
        const uploadTasks = Object.entries(window.tempPhotos).map(([idx, blob]) => {
            const ref = storage.ref(`${kmlId}/${pointId}-${parseInt(idx)+1}.jpg`);
            return ref.put(blob);
        });
        await Promise.all(uploadTasks);

        // 更新 Firestore nodes
        const doc = await db.doc(path).get();
        const nodes = doc.data().nodes || [];
        const updatedNodes = nodes.map(n => n.id === pointId ? { ...n, auditStatus: status, auditNote: note } : n);
        await db.doc(path).update({ nodes: updatedNodes });
    };

    // --- [6. 啟動/關閉 API] ---
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

    window.downloadAuditZip = async function(kmlId, kmlName) {
        const zip = new JSZip();
        const doc = await db.doc(`artifacts/kmldata-d22fb/public/data/kmlLayers/${kmlId}`).get();
        const nodes = doc.data().nodes || [];
        let csv = "\ufeff點名,狀況,備註\n";
        nodes.forEach(n => { if(n.auditStatus) csv += `${n.id},${n.auditStatus},${n.auditNote || ''}\n`; });
        zip.file("清查紀錄.csv", csv);
        const list = await storage.ref(kmlId).listAll();
        await Promise.all(list.items.map(async (item) => {
            const blob = await (await fetch(await item.getDownloadURL())).blob();
            zip.file(`現場照片/${item.name}`, blob);
        }));
        saveAs(await zip.generateAsync({type:"blob"}), `${kmlName}_清查報告.zip`);
    };

})();