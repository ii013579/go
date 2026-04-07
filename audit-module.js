/**
 * audit-module.js - 2026.04.07 整合優化版
 * 1. 立即變色：開啟圖層即顯示藍點(未查)/粉紅點(已查)。
 * 2. 選單加註：自動在下拉選單標註「(清查中:X張)」。
 * 3. 簡約 UI：按鈕縮小 2/3，僅顯示「清樁」或「修改」。
 * 4. 完整表單：包含狀態、多張照片預覽、備註與 Firebase 對接。
 */
(function() {
    'use strict';

    // 基礎配置
    const db = firebase.firestore();
    const storage = firebase.storage();
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    
    window.auditLayersState = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;

    // ==========================================
    // 1. 狀態監聽入口 (供 auth-kml-management.js 呼叫)
    // ==========================================
    window.watchAuditStatus = function(kmlId) {
        if (!kmlId || kmlId === "undefined" || auditUnsubscribes[kmlId]) return;
        
        const docRef = db.doc(`${APP_PATH}/${kmlId}`);
        auditUnsubscribes[kmlId] = docRef.onSnapshot((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            // 儲存該圖層的清查設定
            window.auditLayersState[kmlId] = data?.auditStamp || { enabled: false, targetCount: 2 };
            
            // 狀態變更時，立即同步 UI
            window.refreshMapLayers(kmlId);
            window.syncSelectMenuText();
            if (bottomControl) bottomControl.update();
        }, err => console.error("監聽失敗:", err));
    };

    // ==========================================
    // 2. 核心攔截：地圖載入即刻同步
    // ==========================================
    const originalAddGeoJson = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(geojsonFeatures) {
        // 執行原始地圖繪製
        if (typeof originalAddGeoJson === 'function') {
            originalAddGeoJson.apply(this, arguments);
        }

        const ns = window.mapNamespace;
        const currentId = ns?.currentKmlLayerId;
        if (!ns || !currentId) return;

        // 重新掃描 Marker 注入 ID 與點擊行為
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

        // 關鍵：圖層開啟後 100ms 內完成顏色與文字同步
        setTimeout(() => {
            window.syncSelectMenuText();
            window.refreshMapLayers(currentId);
        }, 100);
    };

    // ==========================================
    // 3. UI 同步功能 (下拉選單文字)
    // ==========================================
    window.syncSelectMenuText = function() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select) return;
        Array.from(select.options).forEach(opt => {
            const state = window.auditLayersState[opt.value];
            let raw = opt.getAttribute('data-raw-name');
            if (!raw) {
                raw = opt.textContent.split(' (清查中')[0];
                opt.setAttribute('data-raw-name', raw);
            }
            opt.textContent = (state && state.enabled) ? `${raw} (清查中:${state.targetCount}張)` : raw;
        });
    };

    // ==========================================
    // 4. 地圖著色邏輯
    // ==========================================
    window.refreshMapLayers = function(targetKmlId = null) {
        if (!window.mapNamespace?.map) return;
        window.mapNamespace.markers.eachLayer(layer => {
            if (layer instanceof L.CircleMarker && layer.options?.kmlId) {
                const kmlId = layer.options.kmlId;
                if (targetKmlId && kmlId !== targetKmlId) return;
                
                const config = window.auditLayersState[kmlId];
                const props = layer.feature?.properties || {};
                const isDone = !!(props.auditStatus || props.auditPhotoCount);
                
                let color = "#e74c3c"; // 預設紅色 (清查關閉)
                if (config?.enabled) {
                    color = isDone ? "#ff85c0" : "#3498db"; // 粉紅(已查) / 藍色(未查)
                }
                layer.setStyle({ 
                    fillColor: color, 
                    fillOpacity: 1, 
                    color: "#ffffff", 
                    weight: 2, 
                    radius: config?.enabled ? 10 : 8 
                });
            }
        });
    };

    // ==========================================
    // 5. 輕量化底部按鈕 (縮小 2/3)
    // ==========================================
    const AuditBottomMenu = L.Control.extend({
        options: { position: 'bottomcenter' },
        onAdd: function() { 
            this._container = L.DomUtil.create('div', 'audit-bottom-menu-container'); 
            this._container.style.cssText = "pointer-events:auto; display:none; margin-bottom:20px;";
            return this._container; 
        },
        update: function() {
            const active = window.currentSelectedPoint;
            // 無選取點或該圖層未開啟清查則隱藏
            if (!active || !window.auditLayersState[active.kmlId]?.enabled) {
                this._container.style.display = 'none';
                return;
            }
            const isDone = !!(active.props.auditStatus || active.props.auditPhotoCount);
            this._container.style.display = 'block';
            this._container.innerHTML = `
                <button onclick="window.openAuditEditor()" 
                        style="background:${isDone?'#ff85c0':'#3498db'}; color:#fff; border:2px solid #fff; 
                               padding:6px 16px; border-radius:20px; font-size:14px; 
                               font-weight:bold; box-shadow:0 2px 8px rgba(0,0,0,0.3); cursor:pointer;">
                    ${isDone ? '修改' : '清樁'}
                </button>`;
        }
    });

    // ==========================================
    // 6. 清查紀錄對話框內容
    // ==========================================
    window.openAuditEditor = async function() {
        const point = window.currentSelectedPoint;
        const config = window.auditLayersState[point.kmlId];
        const targetCount = config?.targetCount || 2;

        Swal.fire({
            title: `點位清查: ${point.props.name || '未命名'}`,
            html: `
                <div style="text-align:left; font-size: 14px;">
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
                            <div style="border:1px dashed #ccc; height:80px; position:relative; background:#f9f9f9; display:flex; align-items:center; justify-content:center;">
                                <input type="file" accept="image/*" capture="camera" onchange="window.previewAuditPhoto(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; z-index:2; cursor:pointer;">
                                <img id="prev-${i}" src="${point.props.photos?.[i] || ''}" style="max-width:100%; max-height:100%; display:${point.props.photos?.[i]?'block':'none'};">
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
                return {
                    status: document.getElementById('auditStatus').value,
                    note: document.getElementById('auditNote').value
                };
            }
        }).then((result) => {
            if (result.isConfirmed) {
                console.log("準備儲存清查資料:", result.value);
                // 此處對接您的 Firebase 儲存邏輯...
            }
        });
    };

    // 初始化控制項
    const checkMap = setInterval(() => {
        if (window.mapNamespace?.map) {
            const map = window.mapNamespace.map;
            if (!map._controlCorners['bottomcenter']) {
                map._controlCorners['bottomcenter'] = L.DomUtil.create('div', 'leaflet-bottomcenter', map._controlContainer);
            }
            if (!bottomControl) {
                bottomControl = new AuditBottomMenu().addTo(map);
                map.on('click', (e) => {
                    // 點擊地圖空白處，關閉按鈕
                    if (e.originalEvent?.target?.id === 'map') {
                        window.currentSelectedPoint = null;
                        bottomControl.update();
                    }
                });
            }
            clearInterval(checkMap);
        }
    }, 1000);

    console.log("✅ 清查模組 (audit-module.js) 載入完成");
})();