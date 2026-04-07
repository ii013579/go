/**
 * audit-module.js - 2026.04.07 終極整合版
 * 功能：
 * 1. 自動攔截 addGeoJsonLayers 注入 kmlId 與點擊事件。
 * 2. 實時同步主頁面下拉選單文字 (顯示清查中:X張)。
 * 3. 點擊點位自動喚醒底部「清樁/修改」按鈕 (縮小 2/3 版)。
 * 4. 點位顏色實時同步：紅(關閉)、藍(未查)、粉(已查)。
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
    // 1. 核心攔截：載入圖層即變色與注入事件
    // ==========================================
    const originalAddGeoJson = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(geojsonFeatures) {
        if (typeof originalAddGeoJson === 'function') {
            originalAddGeoJson.apply(this, arguments);
        }

        const ns = window.mapNamespace;
        const currentId = ns?.currentKmlLayerId;
        if (!ns || !currentId) return;

        // 延遲執行確保 Leaflet 已完成 Layer 繪製
        setTimeout(() => {
            let count = 0;
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
                    count++;
                }
            });
            
            window.syncSelectMenuText();
            window.refreshMapLayers(currentId);
            console.log(`[Audit] 已為 ${count} 個點位注入清查邏輯`);
        }, 150); 
    };

    // ==========================================
    // 2. 狀態監聽與 UI 同步邏輯
    // ==========================================
    window.watchAuditStatus = function(kmlId) {
        if (!kmlId || kmlId === "undefined" || auditUnsubscribes[kmlId]) return;
        
        const docRef = db.doc(`${APP_PATH}/${kmlId}`);
        auditUnsubscribes[kmlId] = docRef.onSnapshot((doc) => {
            if (!doc.exists) return;
            const data = doc.data();
            window.auditLayersState[kmlId] = data?.auditStamp || { enabled: false, targetCount: 2 };
            
            window.refreshMapLayers(kmlId);
            window.syncSelectMenuText();
            
            if (Swal.isVisible() && Swal.getTitle()?.innerText === '圖層清查管理') {
                window.refreshAuditModalUI(false); 
            }
            if (bottomControl) bottomControl.update();
        }, err => console.error("[Audit] 監聽失敗:", err));
    };

    window.syncSelectMenuText = function() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select) return;

        Array.from(select.options).forEach(opt => {
            const kmlId = opt.value;
            const state = window.auditLayersState[kmlId];
            
            let rawName = opt.getAttribute('data-raw-name');
            if (!rawName) {
                rawName = opt.textContent.split(' (清查中')[0];
                opt.setAttribute('data-raw-name', rawName);
            }

            if (state && state.enabled) {
                opt.textContent = `${rawName} (清查中:${state.targetCount}張)`;
            } else {
                opt.textContent = rawName;
            }
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
                
                let style = { fillColor: "#e74c3c", radius: 8 }; // 預設紅色
                if (config?.enabled) {
                    style.fillColor = isDone ? "#ff85c0" : "#3498db"; // 粉紅(已查) / 藍色(未查)
                    style.radius = 10;
                }
                layer.setStyle({ ...style, fillOpacity: 1, color: "#ffffff", weight: 2 });
            }
        });
    };

    // ==========================================
    // 3. 底部按鈕控制項 (縮小 2/3 版)
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
            if (!active || !window.auditLayersState[active.kmlId]?.enabled) {
                this._container.style.display = 'none';
                return;
            }

            const isDone = !!(active.props.auditStatus || active.props.auditPhotoCount);
            this._container.style.display = 'block';
            this._container.innerHTML = `
                <button onclick="window.openAuditEditor()" 
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
    // 4. 清查編輯對話框
    // ==========================================
    window.openAuditEditor = async function() {
        const point = window.currentSelectedPoint;
        if (!point) return;
        const config = window.auditLayersState[point.kmlId];
        const targetCount = config?.targetCount || 2;

        Swal.fire({
            title: `點位清查: ${point.props.name || '未命名'}`,
            html: `
                <div style="text-align:left; font-size: 14px;">
                    <label><b>1. 清查狀態</b></label>
                    <select id="auditStatus" class="swal2-input" style="width:100%; margin: 10px 0;">
                        <option value="正常" ${point.props.auditStatus === '正常' ? 'selected' : ''}>正常</option>
                        <option value="毀損" ${point.props.auditStatus === '毀損' ? 'selected' : ''}>毀損</option>
                        <option value="遺失" ${point.props.auditStatus === '遺失' ? 'selected' : ''}>遺失</option>
                        <option value="被覆蓋" ${point.props.auditStatus === '被覆蓋' ? 'selected' : ''}>被覆蓋</option>
                    </select>
                    <label><b>2. 現場照片 (要求 ${targetCount} 張)</b></label>
                    <div id="photo-uploader" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 10px;">
                        ${Array.from({length: targetCount}).map((_, i) => `
                            <div style="border: 1px dashed #ccc; height: 80px; position: relative; display: flex; align-items: center; justify-content: center; background: #f9f9f9;">
                                <input type="file" accept="image/*" capture="camera" onchange="window.handleAuditPhotoPreview(this, ${i})" 
                                       style="position: absolute; width: 100%; height: 100%; opacity: 0; cursor: pointer; z-index: 2;">
                                <img id="prev-${i}" src="${point.props.photos?.[i] || ''}" style="max-width: 100%; max-height: 100%; display: ${point.props.photos?.[i] ? 'block' : 'none'};">
                                <span id="icon-${i}" style="font-size: 20px; color: #999; display: ${point.props.photos?.[i] ? 'none' : 'block'};">📷</span>
                            </div>
                        `).join('')}
                    </div>
                    <label style="display:block; margin-top:15px;"><b>3. 備註</b></label>
                    <textarea id="auditNote" class="swal2-textarea" style="width:100%; height: 60px; margin: 10px 0;">${point.props.auditNote || ''}</textarea>
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
                // 此處對接您的 Firebase 儲存 function
                console.log("儲存數據:", result.value);
            }
        });
    };

    window.handleAuditPhotoPreview = function(input, index) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = document.getElementById(`prev-${index}`);
                const icon = document.getElementById(`icon-${index}`);
                img.src = e.target.result;
                img.style.display = 'block';
                icon.style.display = 'none';
            };
            reader.readAsDataURL(input.files[0]);
        }
    };

    // ==========================================
    // 5. 初始化與自動監控
    // ==========================================
    const initModule = () => {
        const map = window.mapNamespace?.map;
        if (map && !bottomControl) {
            if (!map._controlCorners['bottomcenter']) {
                map._controlCorners['bottomcenter'] = L.DomUtil.create('div', 'leaflet-bottomcenter', map._controlContainer);
            }
            bottomControl = new AuditBottomMenu().addTo(map);
            
            // 點擊地圖空白處清除選取
            map.on('click', (e) => {
                if (e.originalEvent?.target?.id === 'map') {
                    window.currentSelectedPoint = null;
                    bottomControl.update();
                }
            });

            // 如果目前已有圖層載入，手動補償一次
            if (window.mapNamespace.currentKmlLayerId) {
                window.addGeoJsonLayers();
            }
        }
    };

    const checkTimer = setInterval(() => {
        if (window.mapNamespace?.map) {
            initModule();
            clearInterval(checkTimer);
        }
    }, 1000);

    console.log("✅ 清查模組 (audit-module.js) 載入完成");
})();