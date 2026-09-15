/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (v3.23 照片單行四格版)
 */
(function() {
    'use strict';

    // 全域狀態管理
    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;

    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    // Firebase v8 實例
    const getDb = () => firebase.firestore();
    const getStorage = () => firebase.storage();

    // ---------------------------------------------------------
    // 1. 權限、安全轉義與共用樣式
    // ---------------------------------------------------------
    function getUserRole() {
        return (window.currentUserRole || window.userRole || 
                localStorage.getItem('userRole') || sessionStorage.getItem('userRole') || 'guest').toLowerCase().trim();
    }

    function checkHasAuditPermission() {
        const role = getUserRole();
        return role !== 'guest' && role !== 'unapproved';
    }

    function canSeeAuditColors() {
        return ['owner', 'editor', 'user'].includes(getUserRole());
    }

    function safeEscape(str) {
        if (str === null || str === undefined) return '';
        if (typeof str !== 'string') {
            try { return JSON.stringify(str); } catch (e) { return ''; }
        }
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
    window.escapeHtml = safeEscape;

    const STYLE_PRESETS = {
        audited:   { fillColor: "#ff85c0", color: "#ffffff", weight: 2, fillOpacity: 0.9, radius: 10 },
        unaudited: { fillColor: "#3498db", color: "#ffffff", weight: 2, fillOpacity: 0.9, radius: 10 },
        default:   { fillColor: "#e74c3c", color: "#ffffff", weight: 1.5, fillOpacity: 0.85, radius: 8 }
    };

    function syncAuditButtonVisibility(forceHide = false) {
        let btn = document.getElementById('btn-standalone-add-point');
        if (!btn) {
            btn = renderStandaloneAddButton();
        }
        if (forceHide) {
            if (btn) btn.style.setProperty('display', 'none', 'important');
            if (bottomControl?._container) bottomControl._container.style.display = 'none';
            return;
        }

        const kmlId = window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        const config = kmlId ? window.globalAuditConfigs[kmlId] : null;
        const isAuditing = config ? config.isAuditing : true; 
        const show = checkHasAuditPermission() && isAuditing;

        if (btn) {
            btn.style.setProperty('display', show ? 'inline-flex' : 'none', 'important');
        }
        updateBottomBtnState();
    }
    window.syncAuditButtonVisibility = syncAuditButtonVisibility;

    // ---------------------------------------------------------
    // 2. 地圖圖層與樣式重繪
    // ---------------------------------------------------------
    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        if (kmlId && Array.isArray(features)) {
            const config = window.globalAuditConfigs[kmlId];
            const records = window.auditLayersState[kmlId] || {};

            features.forEach(f => {
                if (!f.properties) f.properties = {};
                f.properties.kmlId = kmlId;
                const pointKey = f.properties.name || f.properties.title || f.properties.id || f.id || "未知點位";
                f.properties.auditPointKey = pointKey;

                if (config?.isAuditing && canSeeAuditColors()) {
                    const record = records[pointKey];
                    Object.assign(f.properties, {
                        isAudited: !!record,
                        auditStatus: record?.deviceStatus || null,
                        auditNote: record?.note || null,
                        photos: record?.photos || [],
                        fillColor: record ? "#FCD770" : "#2A00D2",
                        color: "#ffffff", radius: 8, fillOpacity: 0.85
                    });
                } else {
                    Object.assign(f.properties, { fillColor: "#e74c3c", radius: 8, isAudited: false, fillOpacity: 0.85 });
                    delete f.properties.auditStatus;
                }
            });
        }
        if (originalAddLayers) return originalAddLayers.apply(this, arguments);
    };

    function forceMapRefresh() {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId;
        if (!ns?.map || !kmlId) {
            syncAuditButtonVisibility();
            return;
        }

        setTimeout(() => ns.map?.invalidateSize?.({ animate: false }), 100);

        const records = window.auditLayersState[kmlId] || {};
        const showAuditMode = window.globalAuditConfigs[kmlId]?.isAuditing && canSeeAuditColors();

        ns.map.eachLayer(layer => {
            const props = layer.feature?.properties;
            if (!props) return;

            const pointKey = props.name || props.title || props.id || "未知點位";
            const record = records[pointKey];

            if (showAuditMode) {
                props.isAudited = !!record;
                if (record) {
                    Object.assign(props, { auditStatus: record.deviceStatus || "正常", photos: record.photos || [], auditNote: record.note });
                }
                layer.setStyle?.(record ? STYLE_PRESETS.audited : STYLE_PRESETS.unaudited);
            } else {
                layer.setStyle?.(STYLE_PRESETS.default);
            }
        });

        if (window.addGeoJsonLayers && ns.allKmlFeatures) {
            window.addGeoJsonLayers(ns.allKmlFeatures);
        }
        syncAuditButtonVisibility();
    }
    window.forceMapRefresh = forceMapRefresh;

    // ---------------------------------------------------------
    // 3. Storage & Firestore 核心 Service
    // ---------------------------------------------------------
    window.uploadPhotosToStorage = async function(photos, kmlId, pointKey, kmlLayerName) {
        if (!Array.isArray(photos) || photos.length === 0) return [];
        const rootPath = STORAGE_ROOT;
        const targetLayerName = (kmlLayerName || window.currentActiveKmlName || '預設區域').replace(/\.kml$/i, '').trim();
        const storageRef = getStorage().ref();
        const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');

        return Promise.all(photos.map(async (photoData, index) => {
            if (!photoData || (typeof photoData === 'string' && !photoData.startsWith('data:image'))) return photoData;
            
            const photoIndexStr = String(index + 1).padStart(2, '0');
            const customStoragePath = `${rootPath}/${targetLayerName}/${safePointKey}_${photoIndexStr}.jpg`;
            const ref = storageRef.child(customStoragePath);

            let blob = (photoData instanceof File || photoData instanceof Blob) ? photoData : await (await fetch(photoData)).blob();
            await ref.put(blob);
            return ref.getDownloadURL();
        }));
    };

    async function deleteAuditRecord(kmlId, pointKey, kmlLayerName, existingPhotos = []) {
        const rootPath = STORAGE_ROOT;
        const safePointKey = String(pointKey).replace(/[/\\?%*:|"<>]/g, '_');
        const storageRef = getStorage().ref();

        if (existingPhotos.length > 0) {
            await Promise.all(existingPhotos.map(url => url?.startsWith('http') ? getStorage().refFromURL(url).delete().catch(() => {}) : null));
        } else {
            await Promise.all([1, 2, 3, 4].map(i => storageRef.child(`${rootPath}/${kmlLayerName}/${safePointKey}_0${i}.jpg`).delete().catch(() => {})));
        }

        await getDb().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pointKey).delete();
        delete window.auditLayersState?.[kmlId]?.[pointKey];

        const ns = window.mapNamespace;
        if (ns?.allKmlFeatures) {
            ns.allKmlFeatures = ns.allKmlFeatures.filter(f => (f.properties?.name || f.properties?.auditPointKey) !== pointKey);
        }
    }

    window.deleteCustomPoint = async function(kmlId, pointKey, kmlLayerName) {
        if (!kmlId || !pointKey) return Swal.fire('錯誤', '無效點位資訊', 'error');

        const confirmRes = await Swal.fire({
            title: '確定要刪除此點位？',
            text: `點位「${pointKey}」及其照片將被永久刪除！`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: '確定刪除'
        });
        if (!confirmRes.isConfirmed) {
            syncAuditButtonVisibility(false);
            return;
        }

        Swal.fire({ title: '正在刪除...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        try {
            const records = window.auditLayersState?.[kmlId]?.[pointKey];
            await deleteAuditRecord(kmlId, pointKey, kmlLayerName, records?.photos || []);
            
            window.currentSelectedPoint = null;
            await generateLayerCsvReport(kmlId, kmlLayerName, 4);
            Swal.fire({ icon: 'success', title: '刪除成功', timer: 1200, showConfirmButton: false });
            forceMapRefresh();
        } catch (e) {
            Swal.fire('錯誤', e.message || '刪除失敗', 'error');
            syncAuditButtonVisibility(false);
        }
    };

    // ---------------------------------------------------------
    // 4. CSV 清冊與打包工具
    // ---------------------------------------------------------
    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos = 4) {
        const activeKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        const records = window.auditLayersState?.[activeKmlId] || {};
        const features = window.mapNamespace?.allKmlFeatures || [];

        let headerArr = ["點名", "經度", "緯度", "設備狀態"];
        for (let i = 1; i <= parseInt(maxPhotos); i++) headerArr.push(`照片${i}`);
        headerArr.push("備註");

        let csvContent = "\uFEFF" + headerArr.join(",") + "\n";
        const allKeys = new Set([...features.map(f => f.properties?.name || f.properties?.title || f.id), ...Object.keys(records)]);

        allKeys.forEach(pointKey => {
            if (!pointKey) return;
            const record = records[pointKey];
            const feature = features.find(f => (f.properties?.name || f.properties?.title || f.id) === pointKey);
            const coords = feature?.geometry?.coordinates || [];

            let row = [
                `"${pointKey.replace(/"/g, '""')}"`,
                `"${record?.lng || coords[0] || ''}"`,
                `"${record?.lat || coords[1] || ''}"`,
                `"${record?.deviceStatus || record?.status || (record ? '正常' : '')}"`
            ];

            for (let i = 0; i < maxPhotos; i++) {
                const url = record?.photos?.[i] || "";
                let fileName = url ? decodeURIComponent(url.split("?")[0]).split("/").pop().replace(/\.[^/.]+$/, "") : "";
                row.push(`"${fileName.replace(/"/g, '""')}"`);
            }
            row.push(`"${(record?.remark || record?.note || '').replace(/"/g, '""')}"`);
            csvContent += row.join(",") + "\n";
        });

        try {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
            const safeLayerName = kmlLayerName || 'default_layer';
            const csvStoragePath = `${STORAGE_ROOT}/${safeLayerName}/${safeLayerName}_清查總表.csv`;
            return await getStorage().ref().child(csvStoragePath).put(blob, { contentType: 'text/csv' });
        } catch (err) {
            window.downloadCsvFallback?.(csvContent, `${kmlLayerName || '清查'}_總表.csv`);
        }
    }

    // ---------------------------------------------------------
    // 5. 統一點位編輯 Modal
    // ---------------------------------------------------------
    window.openAuditEditor = async function(isModifyMode = false, isCustomNew = false) {
        if (!checkHasAuditPermission()) return;

        syncAuditButtonVisibility(true);

        const activePoint = window.currentSelectedPoint;
        const layerProps = activePoint?.feature?.properties || activePoint?.properties || {};
        const pointKey = layerProps.name || layerProps.title || layerProps.id || "新增點位";
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs?.[kmlId] || {};
        
        // 原設定四格 (4張)
        const maxPhotos = config.targetPhotos || 4;

        const selectEl = document.getElementById('kmlLayerSelect');
        const kmlLayerName = (selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '預設區域').replace(/\.kml$/i, '').trim();
        const historyRecord = isModifyMode ? (window.auditLayersState?.[kmlId]?.[pointKey] || {}) : {};
        
        const isUserCreated = isCustomNew || layerProps.isCustomPoint || historyRecord.deviceStatus === '新增';
        const currentPhotos = Array.from({ length: maxPhotos }, (_, i) => historyRecord.photos?.[i] || '');

        // 單行四格 CSS 結構調整
        let photoHtml = currentPhotos.map((url, i) => `
            <div style="position:relative; flex:1; min-width:0; display:flex; flex-direction:column; align-items:center;">
                <!-- 上方相機拍照區 -->
                <div style="position:relative; border:2px dashed #ccc; background:#fbfbfb; width:100%; aspect-ratio:1/1; border-radius:8px; display:flex; align-items:center; justify-content:center; overflow:hidden; cursor:pointer;">
                    <img id="prev-${i}" src="${url}" style="width:100%; height:100%; object-fit:cover; display:${url ? 'block' : 'none'};">
                    <span id="icon-${i}" style="font-size:20px; opacity:0.6; display:${url ? 'none' : 'block'};">📷</span>
                    <input type="file" accept="image/*" capture="environment" onchange="window._previewImage(this, ${i})" style="position:absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:pointer; z-index:2;">
                </div>
                
                <!-- 下方開啟舊檔按鈕 -->
                <label style="position:relative; margin-top:-10px; z-index:5; background:#343a40; color:white; padding:2px 4px; border-radius:8px; font-size:10px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; width:90%; white-space:nowrap; box-shadow:0 2px 4px rgba(0,0,0,0.2);">
                    📁 舊檔
                    <input type="file" accept="image/*" onchange="window._previewImage(this, ${i})" style="position:absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:pointer;">
                </label>
            </div>`).join('');

        window._previewImage = (input, index) => {
            if (input.files?.[0]) {
                const reader = new FileReader();
                reader.onload = e => {
                    document.getElementById(`prev-${index}`).src = e.target.result;
                    document.getElementById(`prev-${index}`).style.display = 'block';
                    document.getElementById(`icon-${index}`).style.display = 'none';
                    currentPhotos[index] = e.target.result;
                };
                reader.readAsDataURL(input.files[0]);
            }
        };

        const inputStyle = "width:100%; padding:8px 10px; border:1px solid #dcdfe6; border-radius:6px; box-sizing:border-box; margin-top:4px; margin-bottom:10px; font-size:14px;";

        const { value: res, isDenied, isDismissed } = await Swal.fire({
            title: `填寫清查紀錄 : ${safeEscape(pointKey)}`,
            customClass: { popup: 'swal-wide-modal' },
            html: `
                <div style="text-align:left; font-size:14px; color:#333;">
                    ${isCustomNew ? `
                        <label style="font-weight:bold;">點位名稱</label>
                        <input id="swal-name" style="${inputStyle}" value="${pointKey === '新增點位' ? '' : pointKey}" placeholder="請輸入點位名稱">
                    ` : ''}
                    
                    <label style="font-weight:bold;">設備狀態 <span style="color:red;">*必選</span></label>
                    <select id="swal-status" style="${inputStyle}" ${isUserCreated ? 'disabled' : ''}>
                        <option value="">--- 請選擇設備狀態 ---</option>
                        ${isUserCreated ? '<option value="新增" selected>新增</option>' : (config.statusOptions || ['正常','損壞','遺失']).map(o => `<option value="${o}" ${historyRecord.deviceStatus === o ? 'selected' : ''}>${o}</option>`).join('')}
                    </select>

                    <label style="font-weight:bold; display:block; margin-bottom:6px;">現場照片 (需滿 ${maxPhotos} 張) <span style="color:red;">*必填</span></label>
                    <!-- 四格單一行 (1 line 4 items) -->
                    <div style="display:flex; flex-direction:row; justify-content:space-between; gap:6px; margin-bottom:12px; width:100%;">
                        ${photoHtml}
                    </div>

                    <label style="font-weight:bold;">備註事項 (選填)</label>
                    <textarea id="swal-note" style="${inputStyle} height:65px; resize:vertical;" placeholder="輸入備註事項...">${safeEscape(historyRecord.note || '')}</textarea>
                </div>`,
            showCancelButton: true,
            showDenyButton: isModifyMode && isUserCreated,
            denyButtonText: '🗑️ 刪除點位',
            cancelButtonText: '取消',
            confirmButtonText: '確認並上傳',
            confirmButtonColor: '#6f42c1',
            cancelButtonColor: '#6c757d',
            preConfirm: () => {
                const name = isCustomNew ? document.getElementById('swal-name')?.value.trim() : pointKey;
                const status = document.getElementById('swal-status').value;
                const note = document.getElementById('swal-note').value;
                if (!name) return Swal.showValidationMessage('請輸入點位名稱');
                if (!status) return Swal.showValidationMessage('請選擇設備狀態');
                if (currentPhotos.filter(Boolean).length < maxPhotos) return Swal.showValidationMessage(`現場照片需滿 ${maxPhotos} 張`);
                return { name, status, note, photos: currentPhotos };
            }
        });

        delete window._previewImage;

        if (isDismissed) {
            syncAuditButtonVisibility(false);
            return;
        }

        if (isDenied) return window.deleteCustomPoint(kmlId, pointKey, kmlLayerName);

        if (res) {
            Swal.fire({ title: '上傳處理中...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
            try {
                const photoUrls = await window.uploadPhotosToStorage(res.photos, kmlId, res.name, kmlLayerName);
                const structuredData = {
                    pointName: res.name, status: "已完成", deviceStatus: res.status, note: res.note, photos: photoUrls,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                window.auditLayersState[kmlId] = window.auditLayersState[kmlId] || {};
                window.auditLayersState[kmlId][res.name] = structuredData;

                await getDb().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(res.name).set(structuredData, { merge: true });
                await generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos);

                window.currentSelectedPoint = null;

                Swal.fire({ icon: 'success', title: '儲存成功', timer: 1000, showConfirmButton: false });
                forceMapRefresh();
            } catch (e) {
                Swal.fire('錯誤', e.message || '儲存失敗', 'error');
                syncAuditButtonVisibility(false);
            }
        }
    };

    // ---------------------------------------------------------
    // 6. 新增點位與 UI 懸浮按鈕機制
    // ---------------------------------------------------------
    window.startAddCustomPoint = function(kmlId) {
        if (!checkHasAuditPermission()) return Swal.fire('權限不足', '不允許新增點位', 'warning');
        const targetKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        const map = window.mapNamespace?.map;
        if (!map) return Swal.fire('提示', '地圖載入中，請稍後再試', 'info');

        Swal.fire({
            title: '請在地圖上點擊位置',
            text: '點擊地圖任意位置以新增該點位',
            icon: 'info',
            toast: true,
            position: 'top',
            showConfirmButton: false,
            timer: 3000
        });

        map.getContainer().style.cursor = 'crosshair';
        const handleMapClick = e => {
            map.off('click', handleMapClick);
            map.getContainer().style.cursor = '';
            window.currentSelectedPoint = { 
                properties: { 
                    kmlId: targetKmlId, 
                    lat: e.latlng.lat, 
                    lng: e.latlng.lng, 
                    isCustomPoint: true 
                } 
            };
            window.openAuditEditor(false, true);
        };
        map.on('click', handleMapClick);
    };

    function renderStandaloneAddButton() {
        let btn = document.getElementById('btn-standalone-add-point');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'btn-standalone-add-point';
            btn.innerHTML = '➕ 新增點位';
            Object.assign(btn.style, {
                position: 'fixed',
                bottom: '80px',
                right: '20px',
                zIndex: '9999',
                background: '#28a745',
                color: 'white',
                border: 'none',
                padding: '10px 18px',
                borderRadius: '25px',
                boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                fontWeight: 'bold',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
            });
            btn.onclick = () => window.startAddCustomPoint();
            (document.body || document.documentElement).appendChild(btn);
        }
        return btn;
    }

    function updateBottomBtnState() {
        if (!bottomControl?._container) return;
        const container = bottomControl._container;

        if (!checkHasAuditPermission() || !canSeeAuditColors()) {
            container.style.display = 'none';
            return;
        }

        const active = window.currentSelectedPoint;
        const kmlId = window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs[kmlId];

        if (active && config?.isAuditing) {
            const props = active.feature?.properties || active.properties || {};
            const pointKey = props.name || props.title || props.id || "未知點位";
            const isAudited = !!window.auditLayersState[kmlId]?.[pointKey];

            const btnStyle = "color:white; border:none; padding:8px 20px; border-radius:25px; font-weight:bold; cursor:pointer;";
            container.style.display = 'block';
            container.innerHTML = `
                <div style="display:flex; gap:10px; justify-content:center;">
                    ${isAudited ? `
                        <button onclick="window.viewAuditDetailOnly('${safeEscape(pointKey)}')" style="background:#e91e63; ${btnStyle}">查看</button>
                        <button onclick="window.openAuditEditor(true)" style="background:#f39c12; ${btnStyle}">修改</button>
                    ` : `
                        <button onclick="window.openAuditEditor(false)" style="background:#2ecc71; ${btnStyle}">清查點位</button>
                    `}
                </div>`;
        } else {
            container.style.display = 'none';
        }
    }
    window.addEventListener('click', () => setTimeout(updateBottomBtnState, 150));

    // ---------------------------------------------------------
    // 7. 監聽與初始化
    // ---------------------------------------------------------
    const initGlobalConfigListener = () => {
        getDb().collection(APP_PATH).onSnapshot(snapshot => {
            snapshot.forEach(doc => {
                const data = doc.data();
                window.globalAuditConfigs[doc.id] = data;
                if (data.isAuditing && !auditUnsubscribes[doc.id]) {
                    auditUnsubscribes[doc.id] = getDb().collection(APP_PATH).doc(doc.id).collection('auditRecords').onSnapshot(snap => {
                        window.auditLayersState[doc.id] = snap.docs.reduce((acc, d) => ({ ...acc, [d.id]: d.data() }), {});
                        forceMapRefresh();
                    });
                }
            });
            forceMapRefresh();
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderStandaloneAddButton);
    } else {
        renderStandaloneAddButton();
    }

    let checkAttempts = 0;
    const checkMapInterval = setInterval(() => {
        if (window.mapNamespace?.map && typeof L !== 'undefined') {
            clearInterval(checkMapInterval);
            const map = window.mapNamespace.map;

            const AuditMenu = L.Control.extend({
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                    Object.assign(this._container.style, { display: 'none', position: 'fixed', bottom: '35px', left: '50%', transform: 'translateX(-50%)', zIndex: '5000' });
                    return this._container;
                }
            });
            bottomControl = new AuditMenu();
            bottomControl.addTo(map);

            initGlobalConfigListener();
            syncAuditButtonVisibility();
        } else if (++checkAttempts >= 30) {
            clearInterval(checkMapInterval);
            syncAuditButtonVisibility();
        }
    }, 500);

})();