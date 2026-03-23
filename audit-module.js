/**
 * audit-module.js - 清查系統獨立擴充模組
 * 整合功能：單圖層控制、自動變色、底部浮動選單、照片壓縮、ZIP下載
 */
(function() {
    'use strict';

    // Firebase 配置 (請確保全域已初始化 firebase)
    const db = firebase.firestore();
    const storage = firebase.storage();
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    
    window.auditLayersState = {}; // 存放各圖層清查狀態：{ kmlId: { enabled: bool, targetCount: int } }
    const auditUnsubscribes = {};
    let bottomControl = null;     // 存放 Leaflet 底部控制項實體

    // --- [1. 狀態監聽：同步 Firebase 與地圖樣式] ---
    window.watchAuditStatus = function(kmlId) {
        if (auditUnsubscribes[kmlId]) return;

        const docRef = db.doc(`${APP_PATH}/${kmlId}`);
        auditUnsubscribes[kmlId] = docRef.onSnapshot((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            
            // 更新狀態快取
            if (data && data.auditStamp) {
                window.auditLayersState[kmlId] = data.auditStamp;
            } else {
                delete window.auditLayersState[kmlId];
            }
            
            // 狀態變更時，通知主 UI 與地圖重繪顏色
            updateMainMenuBtnStatus();
            window.refreshMapLayers(kmlId);
            if (bottomControl) bottomControl.update();
        });
    };

    // --- [2. 地圖層級邏輯：變色與事件掛載] ---
    window.refreshMapLayers = function(targetKmlId = null) {
        if (typeof map === 'undefined') return;

        map.eachLayer(layer => {
            // 僅處理帶有 kmlId 的圓點圖徵
            if (layer instanceof L.CircleMarker && layer.options?.kmlId) {
                const kmlId = layer.options.kmlId;
                if (targetKmlId && kmlId !== targetKmlId) return;

                const props = layer.feature.properties;
                const hasRecord = !!(props.auditStatus || props.auditPhotoCount);

                // A. 更新顏色：紅(未開) / 藍(已開未查) / 粉(已查)
                layer.setStyle(window.getAuditPointStyle(kmlId, hasRecord));

                // B. 注入點擊監聽 (僅掛載一次)
                if (!layer._auditListenerAttached) {
                    layer.on('click', function(e) {
                        L.DomEvent.stopPropagation(e);
                        
                        // 1. 觸發外部原有的導航按鈕 (不更動其邏輯)
                        if (window.createNavButton) {
                            window.createNavButton(e.latlng, props.name || "未命名點位");
                        }

                        // 2. 設定選中點位，喚醒螢幕下方浮動按鈕
                        window.currentSelectedPoint = { id: props.id, kmlId: kmlId, props: props };
                        if (bottomControl) bottomControl.update();
                    });
                    layer._auditListenerAttached = true;
                }
                
                // C. 移除原本 Popup 裡的按鈕，僅保留名稱 (避免 UI 重疊)
                layer.setPopupContent(props.name || "點位");
            }
        });
    };

    // 樣式計算邏輯
    window.getAuditPointStyle = function(kmlId, hasRecord) {
        const config = window.auditLayersState[kmlId];
        let color = "#e74c3c"; // 預設紅色

        if (config && config.enabled) {
            // 已開啟清查後：藍色為待查，粉紅為已查
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

    // --- [3. 螢幕正下方浮動選單 (L.Control)] ---
    const AuditBottomMenu = L.Control.extend({
        options: { position: 'bottomcenter' }, 
        onAdd: function() {
            // 使用您定義的 .audit-bottom-menu CSS class
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
                // 粉紅(修正) / 紅色(編輯)
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
            bottomControl = new AuditBottomMenu().addTo(mapInstance);
            // 點擊地圖空白處自動隱藏按鈕
            mapInstance.on('click', () => {
                window.currentSelectedPoint = null;
                bottomControl.update();
            });
        }
    };

    // --- [4. 管理視窗：單獨控制與名稱動態加註] ---
    window.renderAuditModal = function(layers) {
        let html = `<div style="text-align: left; max-height: 400px; overflow-y: auto; font-family: sans-serif;">`;
        layers.forEach(layer => {
            const state = window.auditLayersState[layer.id] || { enabled: false, targetCount: 2 };
            // 開啟清查時，名稱加註橘色字樣
            const tag = state.enabled ? ` <span style="color:#ff8533; font-weight:bold;">(清查中:${state.targetCount}張)</span>` : "";
            
            html += `
                <div style="padding: 12px; border-bottom: 1px solid #eee; background: #fff; display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 14px; flex: 1; margin-right: 10px;">${layer.name}${tag}</span>
                        <div style="display: flex; gap: 4px;">
                            <button onclick="window.updateLayerAudit('${layer.id}', true)" 
                                    style="padding: 4px 8px; background: #28a745; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;" ${state.enabled ? 'disabled' : ''}>開啟</button>
                            <button onclick="window.updateLayerAudit('${layer.id}', false)" 
                                    style="padding: 4px 8px; background: #dc3545; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;" ${!state.enabled ? 'disabled' : ''}>關閉</button>
                            <button onclick="window.downloadAuditZip('${layer.id}', '${layer.name}')" 
                                    class="download-btn" style="display: inline-block; padding: 4px 8px; font-size: 12px;">下載</button>
                        </div>
                    </div>
                    ${state.enabled ? `
                    <div style="font-size: 12px; color: #666; background: #fdfaf5; padding: 5px; border-radius: 4px;">
                        拍照張數 (2-10): <input type="number" value="${state.targetCount}" min="2" max="10" 
                                     onchange="window.updateLayerAuditCount('${layer.id}', this.value)" style="width:45px; text-align:center;">
                    </div>` : ''}
                </div>`;
        });
        return html + `</div>`;
    };

    function updateMainMenuBtnStatus() {
        const auditBtn = document.querySelector('.audit-btn');
        if (auditBtn) {
            const isAnyEnabled = Object.values(window.auditLayersState).some(s => s.enabled);
            // 任一圖層開啟清查，主按鈕變亮橘色 (.active)
            isAnyEnabled ? auditBtn.classList.add('active') : auditBtn.classList.remove('active');
        }
    }

    window.updateLayerAudit = async function(id, enable) {
        // 設定時預設張數為 2
        await db.doc(`${APP_PATH}/${id}`).set({ 
            auditStamp: { enabled: enable, targetCount: 2, updatedAt: firebase.firestore.FieldValue.serverTimestamp() } 
        }, { merge: true });
    };

    window.updateLayerAuditCount = async function(id, count) {
        await db.doc(`${APP_PATH}/${id}`).update({ "auditStamp.targetCount": parseInt(count) });
    };

    // --- [5. 照片壓縮 (800x600) 與 下載 (完整保留)] ---
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
                    if (preview) {
                        preview.src = URL.createObjectURL(blob);
                        preview.style.display = 'block';
                    }
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
        } catch (e) { Swal.fire("下載失敗", "尚未有照片或網路錯誤", "error"); }
    };

})();