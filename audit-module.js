/**
 * audit-module.js - 4.0
 */
(function() {
    'use strict';

    window.auditLayersState = window.auditLayersState || {};
    window.globalAuditConfigs = window.globalAuditConfigs || {};
    window.showAuditedPoints = window.showAuditedPoints ?? true;

    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';
    const auditUnsubs = {};
    let controls = {}, activeCleanup = null;

    // --- 1. 工具函式 ---
    const getRole = () => (window.currentUserData?.role || window.currentUserRole || localStorage.getItem('userRole') || 'guest').toLowerCase();
    const canAudit = () => !['guest', 'unapproved'].includes(getRole());
    const canSeeColor = () => ['owner', 'editor', 'user'].includes(getRole());
    const getPk = (p, def = '未知點位') => p?.name || p?.title || p?.auditPointKey || p?.id || def;
    const getLayerName = (id) => {
        const opt = document.querySelector(`#kmlLayerSelect option[value="${id}"]`);
        return (opt?.getAttribute('data-basename') || opt?.textContent.split(' (')[0] || window.currentActiveKmlName || '預設區域').replace(/\.kml$/i, '').trim();
    };

    // --- 2. 核心 UI & 地圖重繪 ---
    function refreshMap() {
        const ns = window.mapNamespace, kmlId = ns?.currentKmlLayerId || window.currentActiveKmlId;
        if (!ns?.map || !kmlId) return;

        ns.map.invalidateSize({ pan: false });
        if (ns.allKmlFeatures) window.addGeoJsonLayers?.(ns.allKmlFeatures);

        const records = window.auditLayersState[kmlId] || {}, isVis = window.showAuditedPoints !== false;
        ns.map.eachLayer(l => {
            const props = l.feature?.properties || l.options?.properties;
            if (props && l.setStyle) {
                const audited = !!records[getPk(props)];
                l.setStyle(audited ? { fillColor: isVis ? "#FCD770" : "transparent", color: isVis ? "#fff" : "transparent", fillOpacity: isVis ? 0.85 : 0, opacity: isVis ? 1 : 0, stroke: isVis }
                                   : { fillColor: "#2A00D2", color: "#fff", fillOpacity: 0.85, opacity: 1, stroke: true, weight: 2 });
            }
        });
        updateUI();
    }
    window.forceMapRefresh = refreshMap;

    function updateUI() {
        const kmlId = window.mapNamespace?.currentKmlLayerId, cfg = kmlId ? window.globalAuditConfigs[kmlId] : null;
        const isAuditing = cfg?.isAuditing && canAudit() && canSeeColor();
        const addBtn = document.getElementById('btn-standalone-add-point');
        if (addBtn) addBtn.style.setProperty('display', isAuditing ? 'inline-flex' : 'none', 'important');

        if (!isAuditing) return Object.values(controls).forEach(c => c?._container && (c._container.style.display = 'none'));

        // 黃點切換 & 進度
        if (controls.yellow?._container) {
            controls.yellow._container.style.display = 'block';
            controls.yellow._container.innerHTML = `<button class="audit-yellow-dot-btn" onclick="window.toggleAuditedPointsVisibility()"><span class="audit-dot-outer"><span class="audit-dot-inner"></span></span>${!window.showAuditedPoints ? '<span class="audit-cross-icon">❌</span>' : ''}</button>`;
        }
        if (controls.progress?._container) {
            const feats = (window.mapNamespace?.allKmlFeatures || []).filter(f => !f.geometry || f.geometry.type === 'Point');
            const recs = window.auditLayersState[kmlId] || {}, done = feats.filter(f => recs[getPk(f.properties, f.id)]).length;
            controls.progress._container.style.display = feats.length ? 'block' : 'none';
            controls.progress._container.innerHTML = `<div class="audit-progress-badge">未清查: ${feats.length - done} / ${feats.length}</div>`;
        }
        // 底部選單
        if (controls.bottom?._container) {
            const pt = window.currentSelectedPoint;
            if (pt) {
                const pk = getPk(pt.feature?.properties || pt.properties), audited = !!(window.auditLayersState[kmlId] || {})[pk];
                controls.bottom._container.style.display = 'block';
                controls.bottom._container.innerHTML = `<div class="audit-bottom-container">${audited ? `<button onclick="window.viewAuditDetailOnly('${pk}')" class="audit-btn audit-btn-view">🔍 查看</button><button onclick="window.openAuditEditor(true)" class="audit-btn audit-btn-edit">✏️ 修改</button>` : `<button onclick="window.openAuditEditor(false)" class="audit-btn audit-btn-audit">📋 清查點位</button>`}</div>`;
            } else controls.bottom._container.style.display = 'none';
        }
    }

    // --- 3. 地圖圖層覆蓋 ---
    const origAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const kmlId = window.mapNamespace?.currentKmlLayerId || window.currentActiveKmlId;
        if (kmlId && Array.isArray(features)) {
            const recs = window.auditLayersState[kmlId] || {}, isVis = window.showAuditedPoints !== false;
            Object.entries(recs).forEach(([k, r]) => {
                if ((r.isCustomPoint || r.deviceStatus === "新增") && r.lat && r.lng && !features.some(f => getPk(f.properties) === (r.pointName || k))) {
                    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [+r.lng, +r.lat] }, properties: { name: r.pointName || k, kmlId, isCustomPoint: true, isAudited: true, deviceStatus: r.deviceStatus || "新增", photos: r.photos || [] } });
                }
            });
            features.forEach(f => {
                f.properties = f.properties || {}; f.properties.kmlId = kmlId;
                const pk = getPk(f.properties, f.id), rec = recs[pk];
                f.properties.auditPointKey = pk; f.properties.isAudited = !!rec;
                f.properties.fillColor = rec ? (isVis ? "#FCD770" : "transparent") : "#2A00D2";
                f.properties.fillOpacity = rec ? (isVis ? 0.85 : 0) : 0.85;
                f.properties.stroke = rec ? isVis : true;
            });
        }
        return origAddLayers?.apply(this, arguments);
    };

    // --- 4. Firebase & Storage 處理 ---
    async function uploadPhotos(photos, kmlId, pk, layerName) {
        if (!photos?.length) return [];
        const name = layerName || getLayerName(kmlId), safePk = String(pk).replace(/[/\\?%*:|"<>]/g, '_');
        return Promise.all(photos.map(async (p, idx) => {
            if (!p || (typeof p === 'string' && !p.startsWith('data:'))) return p;
            const ref = firebase.storage().ref(`${STORAGE_ROOT}/${name}/${safePk}_${String(idx + 1).padStart(2, '0')}.jpg`);
            const blob = typeof p === 'string' ? await (await fetch(p)).blob() : p;
            await ref.put(blob);
            return ref.getDownloadURL();
        }));
    }

    async function saveRecord(kmlId, pk, data, photos, isEdit, oldPk) {
        Swal.fire({ title: '儲存中...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        try {
            const layerName = getLayerName(kmlId), photoUrls = await uploadPhotos(photos, kmlId, pk, layerName);
            if (isEdit && oldPk && oldPk !== pk) {
                delete window.auditLayersState[kmlId]?.[oldPk];
                await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(oldPk).delete();
            }
            const record = { ...data, pointName: pk, photos: photoUrls, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
            (window.auditLayersState[kmlId] = window.auditLayersState[kmlId] || {})[pk] = record;
            await firebase.firestore().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(pk).set(record, { merge: true });
            
            Swal.fire({ icon: 'success', title: '儲存成功', timer: 800, showConfirmButton: false });
            refreshMap();
        } catch (e) { Swal.fire('錯誤', e.message, 'error'); }
    }

    // --- 5. 編輯 / 新增視窗 (精簡版) ---
    window.openAuditEditor = async function(isModify = false) {
        const pt = window.currentSelectedPoint; if (!pt || !canAudit()) return;
        const props = pt.feature?.properties || pt.properties || {}, pk = getPk(props), kmlId = props.kmlId || window.mapNamespace?.currentKmlLayerId;
        const cfg = window.globalAuditConfigs[kmlId] || {}, maxP = cfg.targetPhotos || 2, rec = isModify ? (window.auditLayersState[kmlId]?.[pk] || {}) : {};
        const isNew = rec.deviceStatus === '新增' || props.deviceStatus === '新增';
        const photos = Array.from({ length: maxP }, (_, i) => rec.photos?.[i] || '');

        const opts = cfg.statusOptions || JSON.parse(localStorage.getItem('audit_status_options') || '["正常","損壞","遺失"]');
        const gridHtml = photos.map((src, i) => `
            <div class="audit-photo-box-wrapper"><div class="audit-photo-box">
                <img id="p-prev-${i}" src="${src}" class="audit-photo-preview" style="display:${src ? 'block' : 'none'}">
                <span id="p-icon-${i}" class="audit-photo-icon" style="display:${src ? 'none' : 'block'}">📷</span>
                <input type="file" id="p-input-${i}" accept="image/*" capture="environment" class="audit-photo-file-input">
            </div></div>`).join('');

        const { value: res, isDenied } = await Swal.fire({
            title: `${isModify ? '修改' : '填寫'}紀錄：${pk}`,
            html: `<div class="audit-modal-container">
                <label class="audit-form-label">狀態</label>
                ${isNew ? '<select id="s-stat" disabled class="audit-select-disabled"><option value="新增">新增</option></select>'
                       : `<select id="s-stat" class="swal2-input"><option value="">--請選擇--</option>${opts.map(o => `<option value="${o}" ${rec.deviceStatus === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`}
                <label class="audit-form-label">照片 (需 ${maxP} 張)</label><div class="audit-photo-grid">${gridHtml}</div>
                <label class="audit-form-label">備註</label><textarea id="s-note" class="audit-textarea">${rec.note || ''}</textarea>
            </div>`,
            showCancelButton: true, showDenyButton: isNew, denyButtonText: '🗑️ 刪除', confirmButtonText: '儲存',
            didOpen: (el) => {
                for (let i = 0; i < maxP; i++) {
                    el.querySelector(`#p-input-${i}`).onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const r = new FileReader();
                            r.onload = (ev) => { photos[i] = ev.target.result; el.querySelector(`#p-prev-${i}`).src = ev.target.result; el.querySelector(`#p-prev-${i}`).style.display = 'block'; el.querySelector(`#p-icon-${i}`).style.display = 'none'; };
                            r.readAsDataURL(file);
                        }
                    };
                }
            },
            preConfirm: () => {
                const stat = document.getElementById('s-stat').value;
                if (!stat) return Swal.showValidationMessage('請選擇狀態');
                if (photos.filter(Boolean).length < maxP) return Swal.showValidationMessage(`請上傳 ${maxP} 張照片`);
                return { status: stat, note: document.getElementById('s-note').value };
            }
        });

        if (isDenied) window.deleteCustomPoint?.(kmlId, pk);
        else if (res) saveRecord(kmlId, pk, { deviceStatus: res.status, note: res.note, status: '已完成' }, photos, isModify, pk);
    };

    // --- 6. 全域即時監聽 ---
    function initListeners() {
        if (!window.firebase?.apps?.length) return setTimeout(initListeners, 500);
        firebase.firestore().collection(APP_PATH).onSnapshot(snap => {
            snap.forEach(doc => {
                window.globalAuditConfigs[doc.id] = doc.data();
                if (!auditUnsubs[doc.id]) {
                    auditUnsubs[doc.id] = firebase.firestore().collection(APP_PATH).doc(doc.id).collection('auditRecords').onSnapshot(s => {
                        const updates = {}; s.forEach(d => updates[d.id] = d.data());
                        window.auditLayersState[doc.id] = updates; refreshMap();
                    });
                }
            });
            refreshMap();
        });
    }

    // --- 7. 地圖掛載初始化 ---
    const timer = setInterval(() => {
        if (window.mapNamespace?.map && window.L) {
            clearInterval(timer);
            const map = window.mapNamespace.map;
            const Ctrl = L.Control.extend({
                options: { position: 'topright' },
                onAdd: function() { return L.DomUtil.create('div', this.options.className); }
            });
            controls.yellow = new (Ctrl.extend({ options: { className: 'leaflet-control-yellow-dot' } }))().addTo(map);
            controls.progress = new (Ctrl.extend({ options: { className: 'leaflet-control-audit-progress' } }))().addTo(map);
            controls.bottom = new (L.Control.extend({ onAdd: () => L.DomUtil.create('div', 'audit-bottom-menu') }))().addTo(map);

            // 獨立新增點位按鈕事件
            let btn = document.getElementById('btn-standalone-add-point') || document.createElement('button');
            btn.id = 'btn-standalone-add-point'; btn.innerHTML = '➕ 新增點位';
            document.body.appendChild(btn);
            btn.onclick = (e) => { e.stopPropagation(); window.startAddCustomPoint?.(); };

            window.addEventListener('click', () => setTimeout(updateUI, 150));
            initListeners();
        }
    }, 500);

    window.toggleAuditedPointsVisibility = () => { window.showAuditedPoints = !window.showAuditedPoints; refreshMap(); };
    window.viewAuditDetailOnly = (pk) => {
        const r = window.auditLayersState[window.mapNamespace?.currentKmlLayerId]?.[pk];
        if (!r) return;
        Swal.fire({ title: `紀錄：${pk}`, html: `<p><b>狀態：</b>${r.deviceStatus}</p><p><b>備註：</b>${r.note || '無'}</p><div>${(r.photos || []).map(p => `<img src="${p}" style="width:45%;margin:2%;">`).join('')}</div>` });
    };
})();