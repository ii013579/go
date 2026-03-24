/**
 * audit-module.js - 2026.03.24 最終整合版
 * 整合功能：
 * 1. 排除 undefined 圖層與異常數據。
 * 2. 開啟清查需輸入 2-10 張照片數量確認。
 * 3. 關閉清查跳出確認提示。
 * 4. 管理視窗支援「實時更新」（狀態改變自動刷新 UI）。
 * 5. 修正地圖點擊事件，確保手機下方「編輯清查」面板正常彈出。
 */
(function() {
    'use strict';

    const db = firebase.firestore();
    const storage = firebase.storage();
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    
    window.auditLayersState = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;

    // --- [1. 狀態監聽：確保同步與即時 UI 刷新] ---
    window.watchAuditStatus = function(kmlId) {
        if (!kmlId || kmlId === "undefined" || auditUnsubscribes[kmlId]) return;
        
        const docRef = db.doc(`${APP_PATH}/${kmlId}`);
        auditUnsubscribes[kmlId] = docRef.onSnapshot((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            
            // 更新狀態快取
            window.auditLayersState[kmlId] = data?.auditStamp || { enabled: false, targetCount: 2 };
            
            // A. 更新主選單按鈕顏色
            updateMainMenuBtnStatus();
            
            // B. 如果「管理彈窗」正開著，即時刷新內容
            if (Swal.isVisible() && Swal.getTitle()?.innerText === '圖層清查管理') {
                window.refreshAuditModalUI(false); // false 表示不顯示讀取條，靜默刷新
            }
            
            // C. 通知地圖變色
            if (window.refreshMapLayers) window.refreshMapLayers(kmlId);
            
            // D. 通知底部面板更新
            if (bottomControl) bottomControl.update();
        });
    };

    // --- [2. 管理視窗核心：排除 undefined 並支援刷新] ---
    window.showAuditActionModal = async function() {
        Swal.fire({ title: '讀取圖層中...', didOpen: () => Swal.showLoading() });
        await window.refreshAuditModalUI(true);
    };

    window.refreshAuditModalUI = async function(showLoading = false) {
        try {
            const snapshot = await db.collection(APP_PATH).get();
            const layers = [];
            
            snapshot.forEach(doc => {
                const data = doc.data();
                const id = doc.id;
                // ✨ 修正：徹底過濾無效圖層
                if (id === "undefined" || !data || (!data.name && !data.KmlName)) return;

                layers.push({
                    id: id,
                    name: data.name || data.KmlName || id
                });
                // 啟動監聽
                window.watchAuditStatus(id);
            });

            const modalHtml = window.renderAuditModal(layers);
            
            if (Swal.isVisible() && Swal.getTitle()?.innerText === '圖層清查管理') {
                Swal.update({ html: modalHtml });
                if (!showLoading) Swal.hideLoading();
            } else {
                Swal.fire({
                    title: '圖層清查管理',
                    html: modalHtml,
                    showConfirmButton: false,
                    showCancelButton: true,
                    cancelButtonText: '取消',
                    width: '95%'
                });
            }
        } catch (e) {
            console.error("刷新清單失敗:", e);
        }
    };

    window.renderAuditModal = function(layers) {
        let html = `<div style="text-align: left; max-height: 65vh; overflow-y: auto;">`;
        layers.forEach(layer => {
            const state = window.auditLayersState[layer.id] || { enabled: false, targetCount: 2 };
            const tag = state.enabled ? ` <span style="color:#ff8533; font-weight:bold;">(清查中:${state.targetCount}張)</span>` : "";
            
            html += `
                <div style="padding: 12px; border-bottom: 1px solid #eee; background: #fff;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <span style="font-size: 15px; flex: 1; font-weight: bold; color: #333;">${layer.name}${tag}</span>
                        <div style="display: flex; gap: 5px;">
                            <button onclick="window.updateLayerAudit('${layer.id}', true)" 
                                    style="padding: 6px 12px; background: #28a745; color: white; border: none; border-radius: 4px;" ${state.enabled ? 'disabled' : ''}>開啟</button>
                            <button onclick="window.updateLayerAudit('${layer.id}', false)" 
                                    style="padding: 6px 12px; background: #dc3545; color: white; border: none; border-radius: 4px;" ${!state.enabled ? 'disabled' : ''}>關閉</button>
                            <button onclick="window.downloadAuditZip('${layer.id}', '${layer.name}')" 
                                    style="padding: 6px 12px; background: #6c757d; color: white; border: none; border-radius: 4px;">下載</button>
                        </div>
                    </div>
                </div>`;
        });
        return html + `</div>`;
    };

    // --- [3. 操作邏輯：開啟對話框、關閉提示] ---
    window.updateLayerAudit = async function(id, enable) {
        if (enable) {
            // ✨ 開啟清查：跳出張數確認 (2-10)
            const { value: count } = await Swal.fire({
                title: '設定清查條件',
                text: '請輸入每個點位要求的照片張數 (2-10)',
                input: 'number',
                inputValue: 2,
                inputAttributes: { min: 2, max: 10, step: 1 },
                showCancelButton: true,
                confirmButtonText: '確認開啟',
                cancelButtonText: '取消'
            });

            if (count) {
                await db.doc(`${APP_PATH}/${id}`).set({ 
                    auditStamp: { 
                        enabled: true, 
                        targetCount: parseInt(count), 
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
                    } 
                }, { merge: true });
                Swal.fire({ icon: 'success', title: '清查已開啟', timer: 800, showConfirmButton: false });
            }
        } else {
            // ✨ 關閉清查
            const result = await Swal.fire({
                title: '確定關閉？',
                text: '關閉後地圖點位將回復為紅色。',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: '確定關閉',
                cancelButtonText: '返回'
            });

            if (result.isConfirmed) {
                await db.doc(`${APP_PATH}/${id}`).set({ 
                    auditStamp: { enabled: false, targetCount: 2, updatedAt: firebase.firestore.FieldValue.serverTimestamp() } 
                }, { merge: true });
                Swal.fire({ icon: 'info', title: '清查已關閉', timer: 800, showConfirmButton: false });
            }
        }
    };

    // --- [4. 地圖變色與點擊喚醒面板] ---
    window.refreshMapLayers = function(targetKmlId = null) {
        if (typeof map === 'undefined') return;
        map.eachLayer(layer => {
            if (layer instanceof L.CircleMarker && layer.options?.kmlId) {
                const kmlId = layer.options.kmlId;
                if (targetKmlId && kmlId !== targetKmlId) return;

                const props = layer.feature.properties;
                const hasRecord = !!(props.auditStatus || props.auditPhotoCount);
                layer.setStyle(window.getAuditPointStyle(kmlId, hasRecord));

                // ✨ 修正點擊事件：確保喚醒底部面板
                layer.off('click'); 
                layer.on('click', function(e) {
                    L.DomEvent.stopPropagation(e);
                    if (window.createNavButton) window.createNavButton(e.latlng, props.name);
                    
                    window.currentSelectedPoint = { id: props.id, kmlId: kmlId, props: props };
                    if (bottomControl) {
                        bottomControl.update();
                    } else {
                        window.initBottomAuditControl(map);
                    }
                });
            }
        });
    };

    window.getAuditPointStyle = function(kmlId, hasRecord) {
        const config = window.auditLayersState[kmlId];
        let color = "#e74c3c"; // 預設紅
        if (config?.enabled) color = hasRecord ? "#ff85c0" : "#3498db"; // 粉(已查) / 藍(未查)
        return { fillColor: color, fillOpacity: 1, color: "#ffffff", weight: 2, radius: 8 };
    };

    // --- [5. 底部選單與容器初始化] ---
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
                this._container.style.display = 'block';
                this._container.innerHTML = `
                    <button onclick="window.openAuditEditor('${active.id}', '${active.kmlId}')" 
                            style="background: ${isDone ? '#ff85c0' : '#e74c3c'}; color: white; border: 2px solid #fff; padding: 12px 25px; border-radius: 50px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.4); cursor: pointer;">
                        ${isDone ? '修正清查紀錄' : '編輯清查紀錄'}
                        <div style="font-size: 10px; font-weight: normal; opacity: 0.9;">(要求: ${config.targetCount} 張)</div>
                    </button>`;
            } else {
                this._container.style.display = 'none';
            }
        }
    });

    window.initBottomAuditControl = function(mapInstance) {
        if (!bottomControl && mapInstance) {
            const name = 'bottomcenter';
            if (mapInstance._controlCorners && !mapInstance._controlCorners[name]) {
                mapInstance._controlCorners[name] = L.DomUtil.create('div', 'leaflet-' + name, mapInstance._controlContainer);
            }
            bottomControl = new AuditBottomMenu().addTo(mapInstance);
            mapInstance.on('click', () => {
                window.currentSelectedPoint = null;
                if (bottomControl) bottomControl.update();
            });
        }
    };

    function updateMainMenuBtnStatus() {
        const auditBtn = document.getElementById('auditKmlBtn');
        if (auditBtn) {
            const isAnyEnabled = Object.values(window.auditLayersState).some(s => s.enabled);
            isAnyEnabled ? auditBtn.classList.add('active') : auditBtn.classList.remove('active');
        }
    }

    // --- [6. 照片處理 (800x600)] ---
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

    // --- [7. 下載 ZIP] ---
    window.downloadAuditZip = async function(kmlId, kmlName) {
        const zip = new JSZip();
        Swal.fire({ title: '封裝檔案中...', didOpen: () => Swal.showLoading() });
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
            Swal.close();
        } catch (e) { 
            Swal.fire("下載失敗", "尚未有照片紀錄或網路錯誤", "error"); 
        }
    };

})();