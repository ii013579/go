/**
 * audit-module.js - 2026.04.14 修正版
 * 解決：1. 讀取 null 報錯 2. 不動主程式實現藍/粉紅點變色
 */
(function() {
    'use strict';

    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;
    
    const STORAGE_ROOT = 'kmldata-d22fb/storage';
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';

    // ---------------------------------------------------------
    // 1. 初始化與選單同步
    // ---------------------------------------------------------
    const initGlobalConfigListener = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            setTimeout(initGlobalConfigListener, 500);
            return;
        }

        firebase.firestore().collection(APP_PATH).onSnapshot(snapshot => {
            snapshot.forEach(doc => {
                window.globalAuditConfigs[doc.id] = doc.data();
            });
            updateKmlSelectUI(); 
            
            const currentId = window.mapNamespace?.currentKmlLayerId;
            if (currentId && window.globalAuditConfigs[currentId]?.isAuditing) {
                if (!auditUnsubscribes[currentId]) startAuditDataListener(currentId);
            }
            
            // 重要：配置更新時觸發地圖重新渲染
            refreshMapMarkers();
        }, err => console.error("Firebase 讀取失敗:", err));
    };

    function updateKmlSelectUI() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select || select.options.length === 0) return; // 防止首次讀取為 null

        Array.from(select.options).forEach(opt => {
            if (!opt.value) return;
            const config = window.globalAuditConfigs[opt.value];
            const baseName = opt.getAttribute('data-basename') || opt.textContent.split(' (清查中')[0];
            
            if (!opt.getAttribute('data-basename')) opt.setAttribute('data-basename', baseName);

            if (config?.isAuditing) {
                opt.textContent = `${baseName} (清查中:${config.targetPhotos || 2}張)`;
            } else {
                opt.textContent = baseName;
            }
        });
    }

    // ---------------------------------------------------------
    // 2. 清查管理員對話框 (解決讀取 null)
    // ---------------------------------------------------------
    window.showAuditActionModal = async function() {
        const select = document.getElementById('kmlLayerSelect');
        // 防呆：若選單尚未載入或為空
        if (!select || select.options.length <= 1) {
            Swal.fire('請稍候', '圖層清單讀取中，請稍後再試。', 'info');
            return;
        }

        let listHtml = '<div style="max-height: 400px; overflow-y: auto; text-align: left; border: 1px solid #eee; border-radius: 8px;">';
        let hasValidItems = false;

        Array.from(select.options).forEach(opt => {
            if (!opt.value) return;
            hasValidItems = true;
            const config = window.globalAuditConfigs[opt.value] || {};
            const isAuditing = config.isAuditing || false;
            const displayName = opt.getAttribute('data-basename') || opt.textContent.split(' (')[0];
            
            listHtml += `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid #f0f0f0;">
                    <span style="font-weight: bold; flex: 1; font-size: 14px;">${displayName}</span>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        ${isAuditing ? 
                            `<span style="color: #ff85c0; font-size: 11px; background: #fff0f6; padding: 2px 6px; border-radius: 10px;">中:${config.targetPhotos}張</span>
                             <button onclick="window.toggleAuditStatus('${opt.value}', false)" style="background: #ff4d4f; color: white; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer;">關</button>` :
                            `<button onclick="window.toggleAuditStatus('${opt.value}', true)" style="background: #1890ff; color: white; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer;">開</button>`
                        }
                    </div>
                </div>`;
        });
        listHtml += '</div>';

        if (!hasValidItems) {
            Swal.fire('提示', '目前沒有可用的圖層', 'info');
            return;
        }

        Swal.fire({
            title: '圖層清查管理',
            html: listHtml,
            showConfirmButton: false,
            showCloseButton: true
        });
    };

    window.toggleAuditStatus = async function(kmlId, status) {
        if (status) {
            const { value: count } = await Swal.fire({
                title: '設定必填照片張數',
                input: 'select',
                inputOptions: { '2':'2張', '3':'3張', '4':'4張', '5':'5張', '10':'10張' },
                inputValue: '2'
            });
            if (count) {
                await firebase.firestore().collection(APP_PATH).doc(kmlId).set({
                    isAuditing: true,
                    targetPhotos: parseInt(count)
                }, { merge: true });
                startAuditDataListener(kmlId);
            }
        } else {
            await firebase.firestore().collection(APP_PATH).doc(kmlId).update({ isAuditing: false });
        }
        window.showAuditActionModal(); // 刷新清單內容
    };

    // ---------------------------------------------------------
    // 3. 核心變色攔截 (不動 map-logic.js 的關鍵)
    // ---------------------------------------------------------
    function refreshMapMarkers() {
        if (window.addGeoJsonLayers && window.mapNamespace?.allKmlFeatures) {
            window.addGeoJsonLayers(window.mapNamespace.allKmlFeatures);
        }
    }

    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        if (ns?.currentKmlLayerId) {
            const kmlId = ns.currentKmlLayerId;
            const config = window.globalAuditConfigs[kmlId];
            const records = window.auditLayersState[kmlId] || {};

            features.forEach(f => {
                const rid = f.properties.id || f.id;
                f.properties.kmlId = kmlId;
                
                if (config?.isAuditing) {
                    const record = records[rid];
                    if (record) {
                        // 已清查：粉紅色
                        f.properties.auditStatus = record.status;
                        f.properties.photos = record.photos || [];
                        f.properties.markerColor = 'pink'; // 供 Leaflet 渲染判斷
                    } else {
                        // 開啟清查但未清查：變為「藍色」 (原為紅點)
                        f.properties.auditStatus = null;
                        f.properties.markerColor = 'blue'; 
                    }
                } else {
                    // 關閉清查：恢復預設（通常 map-logic 會讀取不到 markerColor 則回歸紅點）
                    delete f.properties.auditStatus;
                    delete f.properties.markerColor;
                }
            });
        }
        // 呼叫原始渲染函式，此時 features 內的屬性已被我們動過手腳
        return originalAddLayers ? originalAddLayers.apply(this, arguments) : null;
    };

    // ---------------------------------------------------------
    // 4. 下方按鈕顯示邏輯
    // ---------------------------------------------------------
    window.openAuditEditor = async function() {
        const point = window.currentSelectedPoint;
        if (!point) return;

        // 點擊後按鈕立即隱藏
        if (bottomControl) bottomControl._container.style.display = 'none';

        const kmlId = point.kmlId;
        const featureId = point.id;
        const config = window.globalAuditConfigs[kmlId] || { targetPhotos: 2 };
        
        // ... (中間的編輯器 HTML 與上傳邏輯保持不變) ...
        // 請沿用上一版本的 openAuditEditor 邏輯，僅需注意張數從 config.targetPhotos 讀取
        renderEditor(point, kmlId, featureId, config.targetPhotos);
    };

    // 底部按鈕更新
    function updateBottomBtn() {
        if (!bottomControl) return;
        const active = window.currentSelectedPoint;
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId];

        // 僅當：圖層開啟清查 且 選中點位
        if (active && config?.isAuditing) {
            bottomControl._container.style.display = 'block';
            bottomControl._container.innerHTML = `
                <div class="audit-bottom-menu-container">
                    <button onclick="window.openAuditEditor()" 
                            style="background:#3498db; color:white; border:3px solid #fff; padding:12px 35px; border-radius:50px; font-weight:bold; font-size:18px; box-shadow:0 4px 15px rgba(0,0,0,0.3); cursor:pointer;">
                        清樁
                    </button>
                </div>`;
        } else {
            bottomControl._container.style.display = 'none';
        }
    }

    // 監聽地圖選中點位的變化
    document.addEventListener('pointSelected', updateBottomBtn);

    // ---------------------------------------------------------
    // 5. 數據監聽器
    // ---------------------------------------------------------
    function startAuditDataListener(kmlId) {
        if (auditUnsubscribes[kmlId]) return;
        const db = firebase.firestore();
        auditUnsubscribes[kmlId] = db.collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snapshot => {
                const updates = {};
                snapshot.forEach(doc => updates[doc.id] = doc.data());
                window.auditLayersState[kmlId] = updates;
                refreshMapMarkers();
            });
    }

    // 初始化底部容器
    document.addEventListener('DOMContentLoaded', () => {
        if (!window.mapNamespace?.map) return;
        const AuditMenu = L.Control.extend({
            options: { position: 'bottomcenter' },
            onAdd: function() {
                this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                this._container.style.display = 'none';
                return this._container;
            }
        });
        bottomControl = new AuditMenu();
        bottomControl.addTo(window.mapNamespace.map);
        initGlobalConfigListener();
    });

    console.log("[Audit] 2026.04.14 修正版已載入，變色攔截已啟動。");
})();