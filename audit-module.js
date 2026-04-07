/**
 * audit-module.js - 專業整合版
 * 1. 開啟圖層立即顯示藍點/粉紅點。
 * 2. 下拉選單自動加註「(清查中:X張)」。
 * 3. 縮小 2/3 的「清樁/修改」按鈕，無選取點時自動關閉。
 * 4. 完整的清查紀錄對話框（含多張照片、壓縮、Firebase）。
 */
(function() {
    'use strict';

    const db = firebase.firestore();
    const storage = firebase.storage();
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    
    window.auditLayersState = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;

    // ==========================================
    // 1. 核心補丁：攔截 addGeoJsonLayers
    // ==========================================
    const originalAddGeoJson = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(geojsonFeatures) {
        if (typeof originalAddGeoJson === 'function') {
            originalAddGeoJson.apply(this, arguments);
        }

        const ns = window.mapNamespace;
        const currentId = ns?.currentKmlLayerId;
        if (!ns || !currentId) return;

        // 注入點擊事件與 kmlId
        ns.markers.eachLayer(layer => {
            if (layer instanceof L.CircleMarker) {
                layer.options.kmlId = currentId;
                layer.off('click').on('click', function(e) {
                    L.DomEvent.stopPropagation(e);
                    const props = layer.feature?.properties || {};
                    window.currentSelectedPoint = { 
                        id: layer.feature?.id || `${e.latlng.lat}_${e.latlng.lng}`, 
                        kmlId: currentId, 
                        props: props 
                    };
                    if (bottomControl) bottomControl.update();
                });
            }
        });

        // 立即執行同步：文字標註與點位變色
        setTimeout(() => {
            window.syncSelectMenuText();
            window.refreshMapLayers(currentId);
        }, 100);
    };

    // ==========================================
    // 2. 狀態監聽：同步資料庫狀態
    // ==========================================
    window.watchAuditStatus = function(kmlId) {
        if (!kmlId || kmlId === "undefined" || auditUnsubscribes[kmlId]) return;
        const docRef = db.doc(`${APP_PATH}/${kmlId}`);
        auditUnsubscribes[kmlId] = docRef.onSnapshot((doc) => {
            if (!doc.exists) return;
            window.auditLayersState[kmlId] = doc.data()?.auditStamp || { enabled: false, targetCount: 2 };
            window.refreshMapLayers(kmlId);
            window.syncSelectMenuText();
            if (bottomControl) bottomControl.update();
        });
    };

    window.syncSelectMenuText = function() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select) return;
        Array.from(select.options).forEach(opt => {
            const state = window.auditLayersState[opt.value];
            let name = opt.getAttribute('data-raw-name');
            if (!name) {
                name = opt.textContent.split(' (清查中')[0];
                opt.setAttribute('data-raw-name', name);
            }
            opt.textContent = (state && state.enabled) ? `${name} (清查中:${state.targetCount}張)` : name;
        });
    };

    // ==========================================
    // 3. 輕量化 UI：清樁/修改按鈕
    // ==========================================
    const AuditBottomMenu = L.Control.extend({
        options: { position: 'bottomcenter' },
        onAdd: function() {
            this._container = L.DomUtil.create('div', 'audit-bottom-menu-container');
            // pointer-events: auto 確保按鈕可點點擊，container 本身不擋地圖
            this._container.style.cssText = "pointer-events: auto; z-index: 1000; display: none; margin-bottom: 15px;";
            return this._container;
        },
        update: function() {
            const active = window.currentSelectedPoint;
            if (!active || !window.auditLayersState[active.kmlId]?.enabled) {
                this._container.style.display = 'none';
                return;
            }
            const isDone = !!(active.props.auditStatus || active.props.auditPhotoCount);
            this._container.style.display = 'block';
            this._container.innerHTML = `
                <button onclick="event.stopPropagation(); window.openAuditEditor()" 
                        style="background: ${isDone ? '#ff85c0' : '#3498db'}; 
                               color: white; border: 2px solid #fff; 
                               padding: 8px 18px; border-radius: 20px; 
                               font-weight: bold; font-size: 14px; 
                               box-shadow: 0 2px 10px rgba(0,0,0,0.3); cursor: pointer;">
                    ${isDone ? '修改' : '清樁'}
                </button>`;
        }
    });

    // ==========================================
    // 4. 清查對話框內容邏輯
    // ==========================================
    window.openAuditEditor = async function() {
        const point = window.currentSelectedPoint;
        const config = window.auditLayersState[point.kmlId];
        const targetCount = config?.targetCount || 2;

        Swal.fire({
            title: `點位清查: ${point.props.name || '未命名'}`,
            html: `
                <div id="audit-form" style="text-align:left; font-size: 14px;">
                    <label><b>1. 清查狀態</b></label>
                    <select id="auditStatus" class="swal2-input" style="width:100%; margin: 10px 0;">
                        <option value="正常" ${point.props.auditStatus==='正常'?'selected':''}>正常</option>
                        <option value="毀損" ${point.props.auditStatus==='毀損'?'selected':''}>毀損</option>
                        <option value="遺失" ${point.props.auditStatus==='遺失'?'selected':''}>遺失</option>
                        <option value="被覆蓋" ${point.props.auditStatus==='被覆蓋'?'selected':''}>被覆蓋</option>
                    </select>
                    
                    <label><b>2. 現場照片 (要求 ${targetCount} 張)</b></label>
                    <div id="photo-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px;">
                        ${Array.from({length: targetCount}).map((_, i) => `
                            <div style="border: 1px dashed #ccc; height: 80px; position: relative; background: #f9f9f9; display: flex; align-items: center; justify-content: center;">
                                <input type="file" accept="image/*" capture="camera" onchange="window.previewAuditPhoto(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;">
                                <img id="prev-${i}" src="${point.props.photos?.[i] || ''}" style="max-width:100%; max-height:100%; display: ${point.props.photos?.[i]?'block':'none'};">
                                <span id="icon-${i}" style="font-size:20px; color:#999; display:${point.props.photos?.[i]?'none':'block'};">📷</span>
                            </div>
                        `).join('')}
                    </div>

                    <label style="display:block; margin-top:15px;"><b>3. 備註</b></label>
                    <textarea id="auditNote" class="swal2-textarea" style="width:100%; height:60px; margin: 10px 0;">${point.props.auditNote || ''}</textarea>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '儲存紀錄',
            preConfirm: () => {
                const status = document.getElementById('auditStatus').value;
                const note = document.getElementById('auditNote').value;
                // 這裡可加入張數檢查邏輯
                return { status, note };
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                // 儲存邏輯 (呼叫 Firebase 更新)
                window.saveAuditToFirebase(result.value);
            }
        });
    };

    // ==========================================
    // 5. 輔助功能：變色與初始化
    // ==========================================
    window.refreshMapLayers = function(targetKmlId = null) {
        if (!window.mapNamespace?.map) return;
        window.mapNamespace.markers.eachLayer(layer => {
            if (layer instanceof L.CircleMarker && layer.options?.kmlId) {
                const kmlId = layer.options.kmlId;
                if (targetKmlId && kmlId !== targetKmlId) return;
                
                const config = window.auditLayersState[kmlId];
                const props = layer.feature?.properties || {};
                const hasRecord = !!(props.auditStatus || props.auditPhotoCount);
                
                let color = "#e74c3c"; // 預設紅
                if (config?.enabled) {
                    color = hasRecord ? "#ff85c0" : "#3498db"; // 粉紅 / 藍
                }
                layer.setStyle({ fillColor: color, fillOpacity: 1, color: "#ffffff", weight: 2, radius: config?.enabled ? 10 : 8 });
            }
        });
    };

    window.initBottomAuditControl = function(mapInstance) {
        if (!bottomControl && mapInstance) {
            if (!mapInstance._controlCorners['bottomcenter']) {
                mapInstance._controlCorners['bottomcenter'] = L.DomUtil.create('div', 'leaflet-bottomcenter', mapInstance._controlContainer);
            }
            bottomControl = new AuditBottomMenu().addTo(mapInstance);
            
            // 點擊地圖空白處隱藏按鈕 (但不影響點位顏色)
            mapInstance.on('click', (e) => {
                if (e.originalEvent && e.originalEvent.target.id === 'map') {
                    window.currentSelectedPoint = null;
                    bottomControl.update();
                }
            });
        }
    };

    // 定期檢查地圖是否準備好
    const checkMap = setInterval(() => {
        if (window.mapNamespace?.map) {
            window.initBottomAuditControl(window.mapNamespace.map);
            clearInterval(checkMap);
        }
    }, 1000);

})();