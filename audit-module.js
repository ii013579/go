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
        // 1. 防止重複監聽
        if (!window.auditUnsubscribes) window.auditUnsubscribes = {};
        if (window.auditUnsubscribes[kmlId]) return;
    
        const db = firebase.firestore();
        // 確切的嵌套路徑：artifacts -> kmldata-d22fb -> public -> data -> kmlLayers -> {id}
        const docRef = db.collection('artifacts').doc('kmldata-d22fb')
                         .collection('public').doc('data')
                         .collection('kmlLayers').doc(kmlId);
    
        console.log(`[監聽啟動] 開始監聽圖層狀態: ${kmlId}`);
        	
        auditUnsubscribes[kmlId] = docRef.onSnapshot((doc) => {
            const data = doc.data();
            if (data && data.auditStamp) {
                window.auditLayersState[kmlId] = data.auditStamp;
            } else {
                delete window.auditLayersState[kmlId];
            }
            
            // ✨ 核心功能：當 Firebase 狀態改變，主動要求地圖重繪該圖層點位
            window.refreshMapLayers(kmlId);
        });
    };
    
        // 2. 建立即時監聽 (onSnapshot)
        window.auditUnsubscribes[kmlId] = docRef.onSnapshot((doc) => {
            if (!doc.exists) {
                console.warn(`圖層 ${kmlId} 在資料庫中不存在`);
                return;
            }
    
            const data = doc.data();
            
            // 3. 更新全域快取
            // 即使重新整理網頁，這裡也會觸發第一次讀取，將雲端的 auditStamp 存入記憶體
            if (data && data.auditStamp) {
                window.auditLayersState[kmlId] = data.auditStamp;
                console.log(`[狀態同步] ${kmlId} 目前清查狀態:`, data.auditStamp);
            } else {
                // 如果資料庫中沒有戳記，確保快取是清空的
                delete window.auditLayersState[kmlId];
            }
    
            // 4. 觸發 UI 與地圖聯動
            // 當雲端狀態為 enabled 時，通知地圖重新繪製點位顏色
            if (window.refreshMapLayers) {
                window.refreshMapLayers();
            }
    
            // 5. 更新側邊欄或按鈕的樣式 (選配)
            const auditBtn = document.getElementById('auditKmlBtn');
            if (auditBtn) {
                const isAnyLayerEnabled = Object.values(window.auditLayersState).some(s => s.enabled);
                isAnyLayerEnabled ? auditBtn.classList.add('active') : auditBtn.classList.remove('active');
            }
        }, (error) => {
            console.error(`[監聽失敗] 圖層 ${kmlId}:`, error);
        });
    };

    // --- [2. 地圖遍歷重繪函式] ---
    window.refreshMapLayers = function(targetKmlId = null) {
        if (typeof map === 'undefined') return;

        map.eachLayer(layer => {
            // 僅處理帶有 kmlId 的 CircleMarker
            if (layer instanceof L.CircleMarker && layer.options && layer.options.kmlId) {
                const kmlId = layer.options.kmlId;
                
                // 如果指定了圖層 ID，則只更新該圖層；否則全部更新
                if (targetKmlId && kmlId !== targetKmlId) return;

                const props = layer.feature.properties;
                const hasRecord = !!(props.auditStatus || props.auditPhotoCount);

                // A. 更新樣式 (變色)
                const newStyle = window.getAuditPointStyle(kmlId, hasRecord);
                layer.setStyle(newStyle);

                // B. 更新 Popup (注入工具按鈕)
                const baseContent = props.name || "未命名點位";
                const toolsHTML = window.injectAuditTools(props, kmlId);
                layer.setPopupContent(baseContent + toolsHTML);
            }
        });
    };

    // --- [3. 樣式判定邏輯] ---
    window.getAuditPointStyle = function(kmlId, hasRecord) {
        const config = window.auditLayersState[kmlId];
        let color = "#e74c3c"; // 預設紅色

        if (config && config.enabled) {
            // 藍色 = 待清查, 粉紅 = 已清查
            color = hasRecord ? "#ff85c0" : "#3498db";
        }

        return {
            fillColor: color,
            fillOpacity: 1,
            color: "#ffffff",
            weight: 2,
            radius: 8
        };
    };
    
    // --- [4. Popup 工具注入] ---
    window.injectAuditTools = function(pointProperties, kmlId) {
        const config = window.auditLayersState[kmlId];
        
        // 如果圖層未開啟清查，不回傳任何按鈕
        if (!config || !config.enabled) return '';
    
        const isDone = !!pointProperties.auditStatus;
        const btnText = isDone ? '修正清查紀錄' : '編輯清查紀錄';
        const iconUrl = isDone 
            ? 'https://cdn-icons-png.freepik.com/512/8280/8280538.png' 
            : 'https://cdn-icons-png.freepik.com/512/8280/8280556.png';
    
        // 回傳按鈕 HTML (點擊後開啟編輯器)
        return `
            <div class="audit-tool-panel" style="margin-top:10px; border-top:1px dashed #ccc; padding-top:10px;">
                <button onclick="window.openAuditEditor('${pointProperties.id}', '${kmlId}')" 
                        style="width:100%; padding:8px; border-radius:5px; border:1px solid #ddd; background:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px;">
                    <img src="${iconUrl}" style="width:16px; height:16px;">
                    <span style="font-weight:bold;">${btnText}</span>
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
                <p style="margin-bottom: 12px; color: #555; font-size: 14px;">請勾選要清查的圖層：</p>
                <div id="auditLayerList" style="max-height: 250px; overflow-y: auto; border: 1px solid #ddd; padding: 2px; border-radius: 8px; background: #fff;">`;
        
        layers.forEach(layer => {
            // 從全域狀態讀取目前是否已開啟清查
            const isEnabled = window.auditLayersState[layer.id]?.enabled;
            
            html += `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; border-bottom: 1px solid #eee; min-height: 45px;">
                    <label style="display: flex; align-items: center; cursor: pointer; flex: 1; min-width: 0; margin-right: 10px;">
                        <input type="checkbox" name="auditKml" value="${layer.id}" ${isEnabled ? 'checked' : ''} 
                               onchange="window.toggleDownloadBtn(this, '${layer.id}')" 
                               style="width: 18px; height: 18px; flex-shrink: 0; cursor: pointer;">
                        <span style="margin-left: 10px; font-size: 15px; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${layer.name}
                        </span>
                    </label>
                    
                    <button id="dlBtn_${layer.id}" class="action-buttons" 
                            style="display: ${isEnabled ? 'inline-block' : 'none'}; width: 75px; height: 32px; background: #28a745; color: white; border: none; border-radius: 6px; font-size: 13px; flex-shrink: 0; cursor: pointer;"
                            onclick="window.downloadAuditZip('${layer.id}', '${layer.name}')">下載</button>
                </div>`;
        });
        
        html += `</div>
                 <div style="margin-top: 15px;">
                    <p style="margin-bottom: 5px; font-weight: bold; color: #444;">預計清查照片張數：</p>
                    <input type="number" id="auditPhotoCountInput" value="10" min="1" max="100" 
                           style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 5px; box-sizing: border-box; font-size: 16px;">
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
        try {
            await db.doc(path).set({ 
                auditStamp: { 
                    enabled: isEnabled, 
                    targetCount: parseInt(count),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
                } 
            }, { merge: true });
            if (!window.auditLayersState[kmlId]) window.auditLayersState[kmlId] = {};
            window.auditLayersState[kmlId].enabled = isEnabled;
        } catch (e) { console.error("寫入失敗", e); }
    };

    window.toggleDownloadBtn = function(checkbox, id) {
        const btn = document.getElementById(`dlBtn_${id}`);
        if (btn) btn.style.display = checkbox.checked ? 'inline-block' : 'none';
    };

    // 5. 下載 ZIP 邏輯
    window.downloadAuditZip = async function(kmlId, kmlName) {
        const zip = new JSZip();
        const doc = await db.doc(`artifacts/kmldata-d22fb/public/data/kmlLayers/${kmlId}`).get();
        const nodes = doc.data().nodes || [];
        let csv = "\ufeff點名,狀況,備註\n";
        nodes.forEach(n => { if(n.auditStatus) csv += `${n.id},${n.auditStatus},${n.auditNote || ''}\n`; });
        zip.file("清查紀錄.csv", csv);
        
        try {
            const list = await storage.ref(kmlId).listAll();
            await Promise.all(list.items.map(async (item) => {
                const url = await item.getDownloadURL();
                const blob = await (await fetch(url)).blob();
                zip.file(`現場照片/${item.name}`, blob);
            }));
            const content = await zip.generateAsync({type:"blob"});
            saveAs(content, `${kmlName}_清查報告.zip`);
        } catch (e) { console.error("下載失敗", e); }
    };

})();