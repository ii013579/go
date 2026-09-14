/**
 * audit-module.js - 清查與修改覆蓋整合優化版 (v3.17 精簡重構版)
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

    function syncAuditButtonVisibility() {
        const btn = document.getElementById('btn-standalone-add-point');
        if (!btn) return;
        const kmlId = window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        const config = kmlId ? window.globalAuditConfigs[kmlId] : null;
        const show = checkHasAuditPermission() && config?.isAuditing;
        btn.style.setProperty('display', show ? 'inline-flex' : 'none', 'important');
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
        if (!ns?.map || !kmlId) return;

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

        // 刪除 Storage 照片
        if (existingPhotos.length > 0) {
            await Promise.all(existingPhotos.map(url => url?.startsWith('http') ? getStorage().refFromURL(url).delete().catch(() => {}) : null));
        } else {
            await Promise.all([1, 2, 3].map(i => storageRef.child(`${rootPath}/${kmlLayerName}/${safePointKey}_0${i}.jpg`).delete().catch(() => {})));
        }

        // 刪除 Firestore 紀錄與本地快取
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
        if (!confirmRes.isConfirmed) return;

        Swal.fire({ title: '正在刪除...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        try {
            const records = window.auditLayersState?.[kmlId]?.[pointKey];
            await deleteAuditRecord(kmlId, pointKey, kmlLayerName, records?.photos || []);
            
            window.currentSelectedPoint = null;
            await generateLayerCsvReport(kmlId, kmlLayerName, 2);
            Swal.fire({ icon: 'success', title: '刪除成功', timer: 1200, showConfirmButton: false });
            forceMapRefresh();
            updateBottomBtnState();
        } catch (e) {
            Swal.fire('錯誤', e.message || '刪除失敗', 'error');
        }
    };

    // ---------------------------------------------------------
    // 4. CSV 清冊與打包工具
    // ---------------------------------------------------------
    async function generateLayerCsvReport(kmlId, kmlLayerName, maxPhotos = 2) {
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
    // 5. 統一點位編輯 Modal (整合新增與修改)
    // ---------------------------------------------------------
    window.openAuditEditor = async function(isModifyMode = false, isCustomNew = false) {
        if (!checkHasAuditPermission()) return;
        
        const activePoint = window.currentSelectedPoint;
        const layerProps = activePoint?.feature?.properties || activePoint?.properties || {};
        const pointKey = layerProps.name || layerProps.title || layerProps.id || "新增點位";
        const kmlId = layerProps.kmlId || window.mapNamespace?.currentKmlLayerId;
        const config = window.globalAuditConfigs?.[kmlId] || {};
        const maxPhotos = config.targetPhotos || 2;

        const selectEl = document.getElementById('kmlLayerSelect');
        const kmlLayerName = (selectEl?.options[selectEl.selectedIndex]?.getAttribute('data-basename') || '預設區域').replace(/\.kml$/i, '').trim();
        const historyRecord = isModifyMode ? (window.auditLayersState?.[kmlId]?.[pointKey] || {}) : {};
        
        const isUserCreated = isCustomNew || layerProps.isCustomPoint || historyRecord.deviceStatus === '新增';
        const currentPhotos = Array.from({ length: maxPhotos }, (_, i) => historyRecord.photos?.[i] || '');

        let photoHtml = currentPhotos.map((url, i) => `
            <div style="position:relative; margin-bottom:12px; width:80px;">
                <div style="border:2px dashed #ccc; height:80px; width:80px; display:flex; align-items:center; justify-content:center; background:#fafafa; border-radius:8px; overflow:hidden;">
                    <img id="prev-${i}" src="${url}" style="width:100%; height:100%; object-fit:cover; display:${url ? 'block' : 'none'};">
                    <span id="icon-${i}" style="font-size:24px; color:#bbb; display:${url ? 'none' : 'block'};">📷</span>
                    <input type="file" accept="image/*" capture="environment" onchange="window._previewImage(this, ${i})" style="position:absolute; width:100%; height:100%; opacity:0; cursor:pointer;">
                </div>
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

        const { value: res, isDenied } = await Swal.fire({
            title: `${isModifyMode ? '修改' : '填寫'}清查紀錄`,
            html: `
                <div style="text-align:left; font-size:14px;">
                    ${isCustomNew ? `<label>點位名稱</label><input id="swal-name" class="swal2-input" value="${pointKey === '新增點位' ? '' : pointKey}">` : `<p><b>點位:</b> ${safeEscape(pointKey)}</p>`}
                    <label>設備狀態</label>
                    <select id="swal-status" class="swal2-input" ${isUserCreated ? 'disabled' : ''}>
                        ${isUserCreated ? '<option value="新增">新增</option>' : (config.statusOptions || ['正常','損壞','遺失']).map(o => `<option value="${o}" ${historyRecord.deviceStatus === o ? 'selected' : ''}>${o}</option>`).join('')}
                    </select>
                    <label>現場照片 (${maxPhotos} 張)</label>
                    <div style="display:flex; gap:10px; flex-wrap:wrap; margin:8px 0;">${photoHtml}</div>
                    <label>備註事項</label>
                    <textarea id="swal-note" class="swal2-textarea" style="height:60px;">${safeEscape(historyRecord.note || '')}</textarea>
                </div>`,
            showCancelButton: true,
            showDenyButton: isModifyMode && isUserCreated,
            denyButtonText: '🗑️ 刪除點位',
            confirmButtonText: '確認儲存',
            preConfirm: () => {
                const name = isCustomNew ? document.getElementById('swal-name')?.value.trim() : pointKey;
                const status = document.getElementById('swal-status').value;
                const note = document.getElementById('swal-note').value;
                if (!name) return Swal.showValidationMessage('請輸入點位名稱');
                if (currentPhotos.filter(Boolean).length < maxPhotos) return Swal.showValidationMessage(`請補滿 ${maxPhotos} 張照片`);
                return { name, status, note, photos: currentPhotos };
            }
        });

        delete window._previewImage;

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

                Swal.fire({ icon: 'success', title: '儲存成功', timer: 1000, showConfirmButton: false });
                forceMapRefresh();
                updateBottomBtnState();
            } catch (e) {
                Swal.fire('錯誤', e.message || '儲存失敗', 'error');
            }
        }
    };

    // ---------------------------------------------------------
    // 6. 地圖懸浮與底欄按鈕機制
    // ---------------------------------------------------------
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

    window.startAddCustomPoint = function(kmlId) {
        if (!checkHasAuditPermission()) return Swal.fire('權限不足', '不允許新增點位', 'warning');
        const targetKmlId = kmlId || window.currentActiveKmlId || window.mapNamespace?.currentKmlLayerId;
        const map = window.mapNamespace?.map;
        if (!map || !targetKmlId) return;

        map.getContainer().style.cursor = 'crosshair';
        const handleMapClick = e => {
            map.off('click', handleMapClick);
            map.getContainer().style.cursor = '';
            window.currentSelectedPoint = { properties: { kmlId: targetKmlId, lat: e.latlng.lat, lng: e.latlng.lng, isCustomPoint: true } };
            window.openAuditEditor(false, true);
        };
        map.on('click', handleMapClick);
    };

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
        } else if (++checkAttempts >= 30) {
            clearInterval(checkMapInterval);
        }
    }, 500);

})();