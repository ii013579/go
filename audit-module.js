/**
 * audit-module.js - 2026.04.08 完整版
 * 功能：
 * 1. 點擊點位保留高亮與導航，僅在開啟清查時顯示底部按鈕。
 * 2. 清查編輯框標題顯示點位號碼。
 * 3. 開啟圖層立即依清查狀態變色 (藍/粉紅)。
 * 4. 點擊地圖空白處自動隱藏清查按鈕。
 */
(function() {
    'use strict';

    // Firebase 初始化檢查
    let db;
    try {
        db = firebase.firestore();
    } catch (e) {
        console.error("Firebase Firestore 未就緒，清查模組無法執行:", e);
        return; 
    }

    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    window.auditLayersState = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;

    // ==========================================
    // 1. 核心攔截器 (Monkey Patch)
    // ==========================================
    const originalAddGeoJson = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(geojsonFeatures) {
        // 先執行原始渲染邏輯 (確保高亮與 Popup 綁定)
        if (typeof originalAddGeoJson === 'function') {
            originalAddGeoJson.apply(this, arguments);
        }

        const ns = window.mapNamespace;
        const currentId = ns?.currentKmlLayerId;
        if (!ns || !currentId) return;

        // 遍歷所有 CircleMarker，注入清查邏輯
        ns.markers.eachLayer(layer => {
            if (layer instanceof L.CircleMarker) {
                layer.options.kmlId = currentId;
                
                // 監聽點擊事件
                layer.on('click', function(e) {
                    const props = layer.feature?.properties || {};
                    
                    // 設定全域選取資訊
                    window.currentSelectedPoint = { 
                        id: layer.feature?.id || `${e.latlng.lat}_${e.latlng.lng}`, 
                        kmlId: currentId, 
                        props: props 
                    };
                    
                    // 更新底部按鈕狀態 (如果圖層開啟清查，按鈕會出現)
                    if (bottomControl) bottomControl.update();
                });
            }
        });

        // 立即套用清查配色與同步下拉選單文字
        window.refreshMapLayers(currentId);
        window.syncSelectMenuText();
    };

    // ==========================================
    // 2. 狀態監聽與地圖重新渲染
    // ==========================================
    window.watchAuditStatus = function(kmlId) {
        if (!kmlId || auditUnsubscribes[kmlId]) return;
        
        const docRef = db.doc(`${APP_PATH}/${kmlId}`);
        auditUnsubscribes[kmlId] = docRef.onSnapshot((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            window.auditLayersState[kmlId] = data?.auditStamp || { enabled: false, targetCount: 2 };
            
            // 實時重繪地圖與 UI
            window.refreshMapLayers(kmlId);
            window.syncSelectMenuText();
            if (bottomControl) bottomControl.update();
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
                
                if (config && config.enabled) {
                    // 清查中的樣式
                    layer.setStyle({ 
                        fillColor: isDone ? "#ff85c0" : "#3498db", // 已清:粉紅, 待清:藍
                        radius: 10, 
                        fillOpacity: 1, 
                        color: "#ffffff", 
                        weight: 2 
                    });
                } else {
                    // 原始樣式 (紅色)
                    layer.setStyle({ 
                        fillColor: "#e74c3c", 
                        radius: 8, 
                        fillOpacity: 1, 
                        color: "#ffffff", 
                        weight: 2 
                    });
                }
            }
        });
    };

    // ==========================================
    // 3. 底部按鈕控制 (Leaflet Custom Control)
    // ==========================================
    const AuditBottomMenu = L.Control.extend({
        options: { position: 'bottomcenter' },
        onAdd: function() {
            this._container = L.DomUtil.create('div', 'audit-bottom-menu-container');
            // 預設隱藏，不擋住地圖
            this._container.style.cssText = "pointer-events: auto; display: none; margin-bottom: 25px;";
            return this._container;
        },
        update: function() {
            const active = window.currentSelectedPoint;
            // 檢查：若未選取點位，或該圖層未開啟清查功能，則隱藏按鈕
            if (!active || !window.auditLayersState[active.kmlId]?.enabled) {
                this._container.style.display = 'none';
                return;
            }

            const isDone = !!(active.props.auditStatus || active.props.auditPhotoCount);
            this._container.style.display = 'block';
            
            this._container.innerHTML = `
                <button onclick="L.DomEvent.stopPropagation(event); window.openAuditEditor()" 
                        style="background: ${isDone ? '#ff85c0' : '#3498db'}; 
                               color: white; border: 2px solid #fff; 
                               padding: 10px 24px; border-radius: 30px; 
                               font-weight: bold; font-size: 15px; 
                               box-shadow: 0 4px 12px rgba(0,0,0,0.4); cursor: pointer;">
                    ${isDone ? '修改清查紀錄' : '編輯清查紀錄'}
                </button>`;
        }
    });

    // ==========================================
    // 4. 清查對話框 (Swal)
    // ==========================================
    window.openAuditEditor = async function() {
        const point = window.currentSelectedPoint;
        if (!point) return;
        
        const config = window.auditLayersState[point.kmlId];
        const targetCount = config?.targetCount || 2;
        const currentStatus = point.props.auditStatus || '正常';
        const currentNote = point.props.auditNote || '';
        const pointNumber = point.props.name || point.id; // 對話框標題改為點位號碼

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
            title: pointNumber,
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
            // 寫回屬性 (實際專案中此處應連動 Firebase 儲存)
            point.props.auditStatus = formResult.status;
            point.props.auditNote = formResult.note;
            
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
                
                if (!window.currentSelectedPoint.props.photos) window.currentSelectedPoint.props.photos = [];
                window.currentSelectedPoint.props.photos[index] = e.target.result;
            };
            reader.readAsDataURL(input.files[0]);
        }
    };

    // ==========================================
    // 5. 下拉選單同步文字
    // ==========================================
    window.syncSelectMenuText = function() {
        const selects = [document.getElementById('kmlLayerSelect'), document.getElementById('kmlLayerSelectDashboard')];
        selects.forEach(select => {
            if (!select) return;
            Array.from(select.options).forEach(opt => {
                if (!opt.value) return;
                const state = window.auditLayersState[opt.value];
                let rawName = opt.getAttribute('data-raw-name');
                if (!rawName) {
                    rawName = opt.textContent.split(' (清查中')[0];
                    opt.setAttribute('data-raw-name', rawName);
                }
                opt.textContent = (state && state.enabled) ? `${rawName} (清查中:${state.targetCount}張)` : rawName;
            });
        });
    };

    // ==========================================
    // 初始化
    // ==========================================
    const initModule = () => {
        const map = window.mapNamespace?.map;
        if (map && !bottomControl) {
            // 建立底部中央容器
            if (!map._controlCorners['bottomcenter']) {
                map._controlCorners['bottomcenter'] = L.DomUtil.create('div', 'leaflet-bottomcenter', map._controlContainer);
            }
            bottomControl = new AuditBottomMenu().addTo(map);
            
            // 點擊地圖空白處：取消選取點位並隱藏按鈕
            map.on('click', () => {
                window.currentSelectedPoint = null;
                bottomControl.update();
            });
        }
    };

    // 輪詢等待地圖載入
    const checkTimer = setInterval(() => {
        if (window.mapNamespace?.map) {
            initModule();
            clearInterval(checkTimer);
        }
    }, 1000);

})();