/**
 * audit-module.js - 2026.03.24 終極零侵入版
 * 功能：
 * 1. 自動攔截 addGeoJsonLayers 注入 kmlId 與點擊事件。
 * 2. 實時同步主頁面下拉選單文字 (顯示清查中:X張)。
 * 3. 開啟清查需確認張數 (2-10)，關閉需確認視窗。
 * 4. 點擊地圖點位自動喚醒底部「編輯清查紀錄」按鈕。
 * 5. 照片 800x600 壓縮處理與 Firebase 對接。
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
    // 1. 核心補丁 (Monkey Patch) - 不動原檔達成效果
    // ==========================================
    const originalAddGeoJson = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(geojsonFeatures) {
        // 執行原始地圖邏輯
        if (typeof originalAddGeoJson === 'function') {
            originalAddGeoJson.apply(this, arguments);
        }

        const ns = window.mapNamespace;
        const currentId = ns?.currentKmlLayerId;
        if (!ns || !currentId) return;

        // 強行注入：掃描地圖上剛剛產生的 Marker 並補上身分證 (kmlId)
        ns.markers.eachLayer(layer => {
            if (layer instanceof L.CircleMarker && !layer.options.kmlId) {
                layer.options.kmlId = currentId;
                
                // 重新綁定點擊事件以喚醒清查面板
                layer.off('click'); 
                layer.on('click', function(e) {
                    L.DomEvent.stopPropagation(e);
                    const props = layer.feature?.properties || {};
                    
                    // 設定全域選中點，供編輯器讀取
                    window.currentSelectedPoint = { 
                        id: layer.feature?.id || `${e.latlng.lat}_${e.latlng.lng}`, 
                        kmlId: currentId, 
                        props: props 
                    };

                    // 執行導航與面板更新
                    if (window.createNavButton) window.createNavButton(e.latlng, props.name || '未命名');
                    if (bottomControl) {
                        bottomControl.update();
                    } else {
                        window.initBottomAuditControl(ns.map);
                    }
                });
            }
        });

        // 立即執行地圖變色與 UI 文字同步
        window.refreshMapLayers(currentId);
        window.syncSelectMenuText();
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
            
            // 同步 A: 地圖點位顏色 (紅/藍/粉)
            if (window.refreshMapLayers) window.refreshMapLayers(kmlId);
            
            // 同步 B: 主頁面下拉選單文字
            window.syncSelectMenuText();
            
            // 同步 C: 如果管理視窗正開著，即時刷新內容
            if (Swal.isVisible() && Swal.getTitle()?.innerText === '圖層清查管理') {
                window.refreshAuditModalUI(false); 
            }

            // 同步 D: 底部按鈕
            if (bottomControl) bottomControl.update();
        });
    };

    // 同步「選擇資料庫」下拉選單文字
    window.syncSelectMenuText = function() {
        const select = document.getElementById('kmlLayerSelect');
        if (!select) return;

        Array.from(select.options).forEach(opt => {
            const kmlId = opt.value;
            const state = window.auditLayersState[kmlId];
            
            // 使用自定義屬性備份原始名稱，避免重複累加標籤
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

    // ==========================================
    // 3. 管理視窗與操作 (開啟/關閉對話框)
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
                Swal.fire({ icon: 'success', title: '清查已開啟', timer: 800, showConfirmButton: false });
            }
        } else {
            const res = await Swal.fire({ title: '確定關閉？', text: '點位將變回紅色', icon: 'warning', showCancelButton: true });
            if (res.isConfirmed) {
                await db.doc(`${APP_PATH}/${id}`).set({ auditStamp: { enabled: false, targetCount: 2 }}, { merge: true });
            }
        }
    };

    // ==========================================
    // 4. 地圖顏色與底部面板 (L.Control)
    // ==========================================
    window.refreshMapLayers = function(targetKmlId = null) {
        if (typeof map === 'undefined' || !map) return;
        map.eachLayer(layer => {
            if (layer instanceof L.CircleMarker && layer.options?.kmlId) {
                const kmlId = layer.options.kmlId;
                if (targetKmlId && kmlId !== targetKmlId) return;
                const props = layer.feature?.properties || {};
                const hasRecord = !!(props.auditStatus || props.auditPhotoCount);
                layer.setStyle(window.getAuditPointStyle(kmlId, hasRecord));
            }
        });
    };

    window.getAuditPointStyle = function(kmlId, hasRecord) {
        const config = window.auditLayersState[kmlId];
        let color = "#e74c3c"; // 預設紅
        if (config?.enabled) color = hasRecord ? "#ff85c0" : "#3498db"; // 粉(已查) / 藍(未查)
        return { fillColor: color, fillOpacity: 1, color: "#ffffff", weight: 2, radius: 8 };
    };

    const AuditBottomMenu = L.Control.extend({
        options: { position: 'bottomcenter' },
        onAdd: function() {
            this._container = L.DomUtil.create('div', 'audit-bottom-menu-container');
            this._container.style.display = 'none';
            return this._container;
        },
        update: function() {
            const active = window.currentSelectedPoint;
            if (!active || !window.auditLayersState[active.kmlId]?.enabled) {
                this._container.style.display = 'none';
                return;
            }
            const config = window.auditLayersState[active.kmlId];
            const isDone = !!active.props.auditStatus;
            this._container.style.display = 'block';
            this._container.innerHTML = `
                <button onclick="event.stopPropagation(); window.openAuditEditor('${active.id}', '${active.kmlId}')" 
                        style="background: ${isDone ? '#ff85c0' : '#3498db'}; color: white; border: 3px solid #fff; padding: 15px 30px; border-radius: 50px; font-weight: bold; font-size: 18px; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
                    ${isDone ? '修正清查紀錄' : '編輯清查紀錄'}
                </button>`;
        }
    });

    window.initBottomAuditControl = function(mapInstance) {
        if (!bottomControl && mapInstance) {
            if (!mapInstance._controlCorners['bottomcenter']) {
                mapInstance._controlCorners['bottomcenter'] = L.DomUtil.create('div', 'leaflet-bottomcenter', mapInstance._controlContainer);
            }
            bottomControl = new AuditBottomMenu().addTo(mapInstance);
            mapInstance.on('click', () => { window.currentSelectedPoint = null; bottomControl.update(); });
        }
    };

    // 自動偵測地圖初始化
    const checkMapTimer = setInterval(() => {
        if (window.mapNamespace?.map) {
            window.initBottomAuditControl(window.mapNamespace.map);
            clearInterval(checkMapTimer);
        }
    }, 2000);

})();
