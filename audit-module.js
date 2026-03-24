/**
 * audit-module.js - 清查系統全功能獨立整合版 (2026.03.24)
 * 1. 支援單圖層獨立開關 (開啟/關閉/下載)
 * 2. 自動名稱加註：開啟後顯示 "(清查中:X張)"
 * 3. 底部浮動選單：L.Control.extend 實現編輯/修正按鈕
 * 4. 自動樣式切換：紅(未開) / 藍(開未查) / 粉(已查)
 * 5. 照片處理：Canvas 壓縮至 800x600
 * 6. 錯誤修正：自動建立 Leaflet bottomcenter 容器
 */
(function() {
    'use strict';

    const db = firebase.firestore();
    const storage = firebase.storage();
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    
    window.auditLayersState = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;

    // --- [1. 基礎設施：自動建立 Leaflet 缺失的容器] ---
    function ensureLeafletContainer(mapInstance) {
        const name = 'bottomcenter';
        if (mapInstance._controlCorners && !mapInstance._controlCorners[name]) {
            mapInstance._controlCorners[name] = L.DomUtil.create('div', 'leaflet-' + name, mapInstance._controlContainer);
        }
    }

    // --- [2. 狀態監聽與 UI 連動] ---
    window.watchAuditStatus = function(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        const docRef = db.doc(`${APP_PATH}/${kmlId}`);
        auditUnsubscribes[kmlId] = docRef.onSnapshot((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            window.auditLayersState[kmlId] = data?.auditStamp || { enabled: false, targetCount: 2 };
            
            updateMainMenuBtnStatus();
            window.refreshMapLayers(kmlId);
            if (bottomControl) bottomControl.update();
        });
    };

    // --- [3. 樣式與事件：紅/藍/粉 變色與導航觸發] ---
    window.refreshMapLayers = function(targetKmlId = null) {
        if (typeof map === 'undefined') return;
        map.eachLayer(layer => {
            if (layer instanceof L.CircleMarker && layer.options?.kmlId) {
                const kmlId = layer.options.kmlId;
                if (targetKmlId && kmlId !== targetKmlId) return;

                const props = layer.feature.properties;
                const hasRecord = !!(props.auditStatus || props.auditPhotoCount);
                
                // 設定顏色：未開啟(紅) / 開啟未查(藍) / 開啟已查(粉)
                layer.setStyle(window.getAuditPointStyle(kmlId, hasRecord));

                // 注入點擊監聽：觸發導航 + 喚醒底部選單
                if (!layer._auditListenerAttached) {
                    layer.on('click', function(e) {
                        L.DomEvent.stopPropagation(e);
                        // A. 呼叫外部導航 (不修改其邏輯)
                        if (window.createNavButton) window.createNavButton(e.latlng, props.name);
                        // B. 更新選中狀態
                        window.currentSelectedPoint = { id: props.id, kmlId: kmlId, props: props };
                        if (bottomControl) bottomControl.update();
                    });
                    layer._auditListenerAttached = true;
                }
                layer.setPopupContent(props.name || "點位");
            }
        });
    };

    window.getAuditPointStyle = function(kmlId, hasRecord) {
        const config = window.auditLayersState[kmlId];
        let color = "#e74c3c"; // 預設紅
        if (config?.enabled) color = hasRecord ? "#ff85c0" : "#3498db";
        return { fillColor: color, fillOpacity: 1, color: "#ffffff", weight: 2, radius: 8 };
    };

    // --- [4. 螢幕正下方浮動選單 (L.Control)] ---
    const AuditBottomMenu = L.Control.extend({
        options: { position: 'bottomcenter' }, 
        onAdd: function() {
            this._container = L.DomUtil.create('div', 'audit-bottom-menu');
            this._container.style.display = 'none';
            return this._container;
        },
        update: function() {
            const active = window.currentSelectedPoint;
            if (!active) {
                this._container.style.display = 'none';
                return;
            }
            const config = window.auditLayersState[active.kmlId];
            if (config && config.enabled) {
                const isDone = !!active.props.auditStatus;
                const bgColor = isDone ? '#ff85c0' : '#e74c3c'; 
                this._container.style.display = 'block';
                this._container.innerHTML = `
                    <button onclick="window.openAuditEditor('${active.id}', '${active.kmlId}')" 
                            style="background: ${bgColor}; color: white; border: 2px solid #fff; padding: 12px 30px; border-radius: 50px; font-weight: bold; font-size: 18px; box-shadow: 0 4px 15px rgba(0,0,0,0.4); cursor: pointer;">
                        ${isDone ? '修正清查紀錄' : '編輯清查紀錄'}
                        <div style="font-size: 11px; font-weight: normal; opacity: 0.9;">(目標: ${config.targetCount} 張)</div>
                    </button>`;
            } else {
                this._container.style.display = 'none';
            }
        }
    });

    window.initBottomAuditControl = function(mapInstance) {
        if (!bottomControl) {
            ensureLeafletContainer(mapInstance); // 確保容器存在避免 insertBefore 報錯
            bottomControl = new AuditBottomMenu().addTo(mapInstance);
            mapInstance.on('click', () => {
                window.currentSelectedPoint = null;
                bottomControl.update();
            });
        }
    };

    // --- [5. 管理視窗：對接舊有 showAuditActionModal 接口] ---
    window.showAuditActionModal = function(layers) {
        const layerList = Array.isArray(layers) ? layers : [layers];
        Swal.fire({
            title: '圖層清查管理',
            html: window.renderAuditModal(layerList),
            showConfirmButton: false,
            showCancelButton: true,
            cancelButtonText: '取消',
            width: '90%',
            didOpen: () => {
                layerList.forEach(l => window.watchAuditStatus(l.id));
            }
        });
    };

    window.renderAuditModal = function(layers) {
        let html = `<div style="text-align: left; max-height: 400px; overflow-y: auto;">`;
        layers.forEach(layer => {
            const state = window.auditLayersState[layer.id] || { enabled: false, targetCount: 2 };
            
            // ✨ 修正名稱抓取：相容 layer.name, layer.label 或 layer.title
            const displayName = layer.name || layer.label || layer.title || "未命名圖層";
            
            const tag = state.enabled ? ` <span style="color:#ff8533; font-weight:bold;">(清查中:${state.targetCount}張)</span>` : "";
            
            html += `
                <div style="padding: 12px; border-bottom: 1px solid #eee; background: #fff;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 14px; flex: 1;">${displayName}${tag}</span>
                        <div style="display: flex; gap: 5px;">
                            <button onclick="window.updateLayerAudit('${layer.id}', true)" 
                                    style="padding: 5px 10px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;" ${state.enabled ? 'disabled' : ''}>開啟</button>
                            <button onclick="window.updateLayerAudit('${layer.id}', false)" 
                                    style="padding: 5px 10px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;" ${!state.enabled ? 'disabled' : ''}>關閉</button>
                            <button onclick="window.downloadAuditZip('${layer.id}', '${displayName}')" 
                                    class="download-btn" style="display: inline-block; padding: 5px 10px;">下載</button>
                        </div>
                    </div>
                    ${state.enabled ? `
                    <div style="margin-top: 8px; font-size: 12px; color: #666; background: #f9f9f9; padding: 5px; border-radius: 4px;">
                        設定張數 (2-10): <input type="number" value="${state.targetCount}" min="2" max="10" 
                                     onchange="window.updateLayerAuditCount('${layer.id}', this.value)" style="width:45px; text-align:center;">
                    </div>` : ''}
                </div>`;
        });
        return html + `</div>`;
    };

    window.updateLayerAudit = async function(id, enable) {
        await db.doc(`${APP_PATH}/${id}`).set({ 
            auditStamp: { enabled: enable, targetCount: 2, updatedAt: firebase.firestore.FieldValue.serverTimestamp() } 
        }, { merge: true });
    };

    window.updateLayerAuditCount = async function(id, count) {
        await db.doc(`${APP_PATH}/${id}`).update({ "auditStamp.targetCount": parseInt(count) });
    };

    function updateMainMenuBtnStatus() {
        const auditBtn = document.querySelector('.audit-btn');
        if (auditBtn) {
            const isAnyEnabled = Object.values(window.auditLayersState).some(s => s.enabled);
            isAnyEnabled ? auditBtn.classList.add('active') : auditBtn.classList.remove('active');
        }
    }

    // --- [6. 照片處理 (800x600) 與 ZIP 下載] ---
    window.handleAuditPhoto = function(input, index) {
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
                    window.tempPhotos = window.tempPhotos || {};
                    window.tempPhotos[index] = blob;
                    const preview = document.getElementById(`img_${index}`);
                    if (preview) { preview.src = URL.createObjectURL(blob); preview.style.display = 'block'; }
                }, 'image/jpeg', 0.85);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    };

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
        } catch (e) { Swal.fire("下載失敗", "尚未有照片", "error"); }
    };

})();