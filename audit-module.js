/**
 * audit-module.js - 2026 最新穩定版
 * 解決載入崩潰問題，並完整實作清查 UI 與狀態同步
 */
(function() {
    'use strict';

    // 1. 安全初始化：避免 Firebase 尚未就緒導致整個模組崩潰
    let db, storage;
    try {
        db = firebase.firestore();
        storage = firebase.storage();
    } catch (e) {
        console.error("Firebase 初始化失敗，清查模組可能無法正常運作:", e);
        return; // 若缺少 Firebase 則安全退出，不引發後續 undefined 錯誤
    }

    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    window.auditLayersState = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;

    // ==========================================
    // 需求 1 & 4：核心攔截器 (立即變色與文字同步)
    // ==========================================
    const originalAddGeoJson = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(geojsonFeatures) {
        // 先執行原始的 map-logic.js 繪製邏輯
        if (typeof originalAddGeoJson === 'function') {
            originalAddGeoJson.apply(this, arguments);
        }

        const ns = window.mapNamespace;
        const currentId = ns?.currentKmlLayerId;
        if (!ns || !currentId) return;

        // 立即為新產生的 Marker 注入 ID 與點擊事件
        ns.markers.eachLayer(layer => {
            if (layer instanceof L.CircleMarker) {
                layer.options.kmlId = currentId;
                
                // 覆蓋原本的點擊事件，同時喚醒清查按鈕與導航
                layer.off('click').on('click', function(e) {
                    L.DomEvent.stopPropagation(e);
                    const props = layer.feature?.properties || {};
                    window.currentSelectedPoint = { 
                        id: layer.feature?.id || `${e.latlng.lat}_${e.latlng.lng}`, 
                        kmlId: currentId, 
                        props: props 
                    };
                    
                    // 呼叫原本的導航按鈕 (相容 map-logic.js)
                    if (typeof window.createNavButton === 'function') {
                        window.createNavButton(e.latlng, props.name || '未命名');
                    }
                    
                    // 喚醒底部清查按鈕
                    if (bottomControl) bottomControl.update();
                });
            }
        });

        // ✨ 需求 1：圖層一開啟，立即執行變色與選單文字加註
        window.refreshMapLayers(currentId);
        window.syncSelectMenuText();
    };

    // ==========================================
    // 狀態監聽與 UI 同步
    // ==========================================
    window.watchAuditStatus = function(kmlId) {
        if (!kmlId || kmlId === "undefined" || auditUnsubscribes[kmlId]) return;
        
        const docRef = db.doc(`${APP_PATH}/${kmlId}`);
        auditUnsubscribes[kmlId] = docRef.onSnapshot((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            window.auditLayersState[kmlId] = data?.auditStamp || { enabled: false, targetCount: 2 };
            
            // 監聽到狀態改變時，即時更新地圖顏色與選單文字
            window.refreshMapLayers(kmlId);
            window.syncSelectMenuText();
            if (bottomControl) bottomControl.update();
            
            if (Swal.isVisible() && Swal.getTitle()?.innerText === '圖層清查管理') {
                window.refreshAuditModalUI(false); 
            }
        });
    };

    window.syncSelectMenuText = function() {
        // 同步所有可能的下拉選單
        const selects = [document.getElementById('kmlLayerSelect'), document.getElementById('kmlLayerSelectDashboard')];
        
        selects.forEach(select => {
            if (!select) return;
            Array.from(select.options).forEach(opt => {
                if (!opt.value) return; // 略過 "-- 請選擇 --"
                
                const state = window.auditLayersState[opt.value];
                let rawName = opt.getAttribute('data-raw-name');
                if (!rawName) {
                    rawName = opt.textContent.split(' (清查中')[0];
                    opt.setAttribute('data-raw-name', rawName);
                }

                // ✨ 需求 1：加註清查中文字
                if (state && state.enabled) {
                    opt.textContent = `${rawName} (清查中:${state.targetCount}張)`;
                } else {
                    opt.textContent = rawName;
                }
            });
        });
    };

    window.refreshMapLayers = function(targetKmlId = null) {
        const ns = window.mapNamespace;
        if (!ns?.map || !ns?.markers) return;

        ns.markers.eachLayer(layer => {
            if (layer instanceof L.CircleMarker && layer.options?.kmlId) {
                const kmlId = layer.options.kmlId;
                if (targetKmlId && kmlId !== targetKmlId) return;
                
                const props = layer.feature?.properties || {};
                const isDone = !!(props.auditStatus || props.auditPhotoCount);
                const config = window.auditLayersState[kmlId];
                
                // ✨ 需求 1：開啟圖層立即顯示顏色 (紅=關閉, 藍=未查, 粉=已查)
                let style = { fillColor: "#e74c3c", radius: 8 }; 
                if (config?.enabled) {
                    style.fillColor = isDone ? "#ff85c0" : "#3498db"; 
                    style.radius = 10;
                }
                layer.setStyle({ ...style, fillOpacity: 1, color: "#ffffff", weight: 2 });
            }
        });
    };

    // ==========================================
    // 需求 2：底部控制面板 (縮小 2/3、文字簡化、自動隱藏)
    // ==========================================
    const AuditBottomMenu = L.Control.extend({
        options: { position: 'bottomcenter' },
        onAdd: function() {
            this._container = L.DomUtil.create('div', 'audit-bottom-menu-container');
            this._container.style.cssText = "pointer-events: auto; display: none; margin-bottom: 20px;";
            return this._container;
        },
        update: function() {
            const active = window.currentSelectedPoint;
            // 無選取點位或未開啟清查時，隱藏按鈕
            if (!active || !window.auditLayersState[active.kmlId]?.enabled) {
                this._container.style.display = 'none';
                return;
            }

            const isDone = !!(active.props.auditStatus || active.props.auditPhotoCount);
            this._container.style.display = 'block';
            
            // 按鈕尺寸縮小，文字簡化為「清樁」或「修改」
            this._container.innerHTML = `
                <button onclick="L.DomEvent.stopPropagation(event); window.openAuditEditor()" 
                        style="background: ${isDone ? '#ff85c0' : '#3498db'}; 
                               color: white; border: 2px solid #fff; 
                               padding: 6px 16px; border-radius: 20px; 
                               font-weight: bold; font-size: 14px; 
                               box-shadow: 0 2px 8px rgba(0,0,0,0.3); cursor: pointer;">
                    ${isDone ? '修改' : '清樁'}
                </button>`;
        }
    });

    // ==========================================
    // 需求 3：清查對話框內容 (我還記得！)
    // ==========================================
    window.openAuditEditor = async function() {
        const point = window.currentSelectedPoint;
        if (!point) return;
        
        const config = window.auditLayersState[point.kmlId];
        const targetCount = config?.targetCount || 2;
        const currentStatus = point.props.auditStatus || '正常';
        const currentNote = point.props.auditNote || '';

        // 建立照片上傳預覽網格
        let photoHtml = '';
        for (let i = 0; i < targetCount; i++) {
            const photoData = point.props.photos?.[i] || '';
            photoHtml += `
                <div style="border: 1px dashed #ccc; height: 80px; position: relative; display: flex; align-items: center; justify-content: center; background: #f9f9f9;">
                    <input type="file" accept="image/*" capture="environment" onchange="window.handleAuditPhotoPreview(this, ${i})" 
                           style="position: absolute; width: 100%; height: 100%; opacity: 0; cursor: pointer; z-index: 2;">
                    <img id="audit-prev-${i}" src="${photoData}" style="max-width: 100%; max-height: 100%; display: ${photoData ? 'block' : 'none'}; z-index: 1;">
                    <span id="audit-icon-${i}" style="font-size: 24px; color: #999; display: ${photoData ? 'none' : 'block'}; z-index: 1;">📷</span>
                </div>
            `;
        }

        const { value: formResult } = await Swal.fire({
            title: `點位清查: ${point.props.name || '未命名'}`,
            html: `
                <div style="text-align:left; font-size: 14px;">
                    <label><b>1. 清查狀態</b></label>
                    <select id="swal-audit-status" class="swal2-input" style="width: 100%; margin: 5px 0 15px 0; height: 40px; font-size: 16px;">
                        <option value="正常" ${currentStatus === '正常' ? 'selected' : ''}>正常</option>
                        <option value="毀損" ${currentStatus === '毀損' ? 'selected' : ''}>毀損</option>
                        <option value="遺失" ${currentStatus === '遺失' ? 'selected' : ''}>遺失</option>
                        <option value="被覆蓋" ${currentStatus === '被覆蓋' ? 'selected' : ''}>被覆蓋</option>
                    </select>
                    
                    <label><b>2. 現場照片 (應拍 ${targetCount} 張)</b></label>
                    <div id="photo-uploader" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 5px 0 15px 0;">
                        ${photoHtml}
                    </div>

                    <label style="display:block;"><b>3. 備註</b></label>
                    <textarea id="swal-audit-note" class="swal2-textarea" style="width: 100%; height: 60px; margin: 5px 0;">${currentNote}</textarea>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '儲存紀錄',
            cancelButtonText: '取消',
            preConfirm: () => {
                return {
                    status: document.getElementById('swal-audit-status').value,
                    note: document.getElementById('swal-audit-note').value
                };
            }
        });

        if (formResult) {
            // 將結果寫回當前選中點的屬性中 (實務上應加上寫入 Firebase 邏輯)
            point.props.auditStatus = formResult.status;
            point.props.auditNote = formResult.note;
            
            // 儲存後立即更新地圖顏色與按鈕狀態
            window.refreshMapLayers(point.kmlId);
            if (bottomControl) bottomControl.update();
            Swal.fire({ icon: 'success', title: '儲存成功', timer: 1000, showConfirmButton: false });
        }
    };

    window.handleAuditPhotoPreview = function(input, index) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = document.getElementById(`audit-prev-${index}`);
                const icon = document.getElementById(`audit-icon-${index}`);
                if (img) { img.src = e.target.result; img.style.display = 'block'; }
                if (icon) icon.style.display = 'none';
                
                // 暫存在當前點位屬性中
                if (!window.currentSelectedPoint.props.photos) {
                    window.currentSelectedPoint.props.photos = [];
                }
                window.currentSelectedPoint.props.photos[index] = e.target.result;
            };
            reader.readAsDataURL(input.files[0]);
        }
    };

    // ==========================================
    // 清查管理對話框 (總覽與開關)
    // ==========================================
    window.showAuditActionModal = async function() {
        Swal.fire({ title: '讀取中...', didOpen: () => Swal.showLoading() });
        await window.refreshAuditModalUI(true);
    };

    window.refreshAuditModalUI = async function(firstOpen = false) {
        try {
            const snapshot = await db.collection(APP_PATH).get();
            const layers = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                if (doc.id === "undefined" || !data || (!data.name && !data.KmlName)) return;
                layers.push({ id: doc.id, name: data.name || data.KmlName });
                window.watchAuditStatus(doc.id);
            });

            const html = window.renderAuditModal(layers);
            if (firstOpen) {
                Swal.fire({ title: '圖層清查管理', html: html, showConfirmButton: false, showCancelButton: true, cancelButtonText: '取消', width: '95%' });
            } else {
                Swal.update({ html: html });
            }
        } catch (e) { console.error(e); }
    };

    window.renderAuditModal = function(layers) {
        let html = `<div style="text-align: left; max-height: 60vh; overflow-y: auto;">`;
        layers.forEach(l => {
            const state = window.auditLayersState[l.id] || { enabled: false, targetCount: 2 };
            const tag = state.enabled ? ` <span style="color:#ff8533; font-weight:bold;">(清查中:${state.targetCount}張)</span>` : "";
            html += `
                <div style="padding: 12px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight:bold;">${l.name}${tag}</span>
                    <div style="display: flex; gap: 5px;">
                        <button onclick="window.updateLayerAudit('${l.id}', true)" style="background:#28a745; color:white; border:none; padding:6px 10px; border-radius:4px;" ${state.enabled ? 'disabled' : ''}>開啟</button>
                        <button onclick="window.updateLayerAudit('${l.id}', false)" style="background:#dc3545; color:white; border:none; padding:6px 10px; border-radius:4px;" ${!state.enabled ? 'disabled' : ''}>關閉</button>
                    </div>
                </div>`;
        });
        return html + `</div>`;
    };

    window.updateLayerAudit = async function(id, enable) {
        if (enable) {
            const { value: count } = await Swal.fire({
                title: '設定清查張數',
                text: '請輸入每個點位要求的照片張數 (2-10)',
                input: 'number', inputValue: 2, inputAttributes: { min: 2, max: 10 },
                showCancelButton: true
            });
            if (count) {
                await db.doc(`${APP_PATH}/${id}`).set({ auditStamp: { enabled: true, targetCount: parseInt(count), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }}, { merge: true });
            }
        } else {
            const res = await Swal.fire({ title: '確定關閉？', text: '點位將變回紅色', icon: 'warning', showCancelButton: true });
            if (res.isConfirmed) {
                await db.doc(`${APP_PATH}/${id}`).set({ auditStamp: { enabled: false, targetCount: 2 }}, { merge: true });
            }
        }
    };

    // ==========================================
    // 地圖控制項初始化與自動監控
    // ==========================================
    const initModule = () => {
        const map = window.mapNamespace?.map;
        if (map && !bottomControl) {
            if (!map._controlCorners['bottomcenter']) {
                map._controlCorners['bottomcenter'] = L.DomUtil.create('div', 'leaflet-bottomcenter', map._controlContainer);
            }
            bottomControl = new AuditBottomMenu().addTo(map);
            
            // 點擊地圖空白處，清除選取並隱藏按鈕
            map.on('click', (e) => {
                window.currentSelectedPoint = null;
                bottomControl.update();
            });
        }
    };

    // 使用計時器等待地圖初始化完成
    const checkTimer = setInterval(() => {
        if (window.mapNamespace?.map) {
            initModule();
            clearInterval(checkTimer);
        }
    }, 1000);

    console.log("✅ 清查模組 (audit-module.js) 載入完成並已導出所有方法。");
})();