/**
 * audit-module.js - 2026.04.14 全功能穩定版
 */
(function() {
    'use strict';

    // 1. 【立即註冊】防止 auth-kml-management.js 出現「尚未載入」報錯
    window.initAuditListener = window.initAuditListener || function(id) {
        console.warn("[Audit] 正在背景初始化，請稍候...");
    };

    // 全域變數宣告
    window.auditLayersState = window.auditLayersState || {};
    const auditUnsubscribes = {};
    let bottomControl = null;
    
    // 設定路徑 (請依您的 Firebase 結構調整)
    const STORAGE_ROOT = 'kmldata-d22fb/storage';
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';

    // ---------------------------------------------------------
    // 2. 核心初始化邏輯 (延遲執行確保 Firebase 已就緒)
    // ---------------------------------------------------------
    const startModule = () => {
        if (typeof firebase === 'undefined' || !firebase.apps.length) {
            setTimeout(startModule, 500); // Firebase 未就緒則 0.5 秒後重試
            return;
        }

        const db = firebase.firestore();
        const storage = firebase.storage();

        /**
         * 功能 A: Firebase 實時監聽器
         */
        window.initAuditListener = function(kmlId) {
            if (!kmlId) return;
            if (auditUnsubscribes[kmlId]) auditUnsubscribes[kmlId]();

            console.log("[Audit] 啟動監聽圖層: " + kmlId);
            try {
                auditUnsubscribes[kmlId] = db.collection(APP_PATH).doc(kmlId).collection('auditRecords')
                    .onSnapshot(snapshot => {
                        const updates = {};
                        snapshot.forEach(doc => { updates[doc.id] = doc.data(); });
                        window.auditLayersState[kmlId] = updates;

                        // 同步刷新地圖點位顏色
                        const ns = window.mapNamespace;
                        if (ns && ns.currentKmlLayerId === kmlId && ns.allKmlFeatures) {
                            window.addGeoJsonLayers(ns.allKmlFeatures);
                        }
                        if (bottomControl) bottomControl.update();
                    });
            } catch (e) {
                console.error("[Audit] 監聽啟動失敗", e);
            }
        };

        /**
         * 功能 B: 影像壓縮處理 (1024x768)
         */
        window.handleAuditPhotoPreview = function(input, index) {
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const img = new Image();
                    img.onload = function() {
                        const canvas = document.createElement('canvas');
                        canvas.width = 1024;
                        canvas.height = 768;
                        const ctx = canvas.getContext('2d');
                        
                        // 白色背景補底
                        ctx.fillStyle = "#FFFFFF";
                        ctx.fillRect(0, 0, 1024, 768);
                        
                        // 繪製縮放影像
                        ctx.drawImage(img, 0, 0, 1024, 768);

                        const base64 = canvas.toDataURL('image/jpeg', 0.8);
                        const prevImg = document.getElementById('audit-prev-' + index);
                        const icon = document.getElementById('audit-icon-' + index);
                        if (prevImg) { prevImg.src = base64; prevImg.style.display = 'block'; }
                        if (icon) icon.style.display = 'none';
                        
                        // 存入當前選中點位的緩存
                        if (!window.currentSelectedPoint.props.photos) window.currentSelectedPoint.props.photos = [];
                        window.currentSelectedPoint.props.photos[index] = base64;
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(input.files[0]);
            }
        };

        /**
         * 功能 C: 清查編輯對話框與分層上傳
         */
        window.openAuditEditor = async function() {
            const point = window.currentSelectedPoint;
            if (!point) return;

            const kmlId = point.kmlId;
            const featureId = point.id;
            const currentStatus = point.props.auditStatus || '正常';
            const currentNote = point.props.auditNote || '';

            let photoHtml = '';
            for (let i = 0; i < 2; i++) {
                const photoData = point.props.photos?.[i] || '';
                photoHtml += `
                    <div style="border:2px dashed #ccc;height:95px;position:relative;display:flex;align-items:center;justify-content:center;background:#fafafa;border-radius:8px;overflow:hidden;">
                        <input type="file" accept="image/*" capture="environment" onchange="window.handleAuditPhotoPreview(this, ${i})" style="position:absolute;width:100%;height:100%;opacity:0;z-index:2;cursor:pointer;">
                        <img id="audit-prev-${i}" src="${photoData}" style="width:100%;height:100%;object-fit:cover;display:${photoData?'block':'none'};z-index:1;">
                        <span id="audit-icon-${i}" style="font-size:28px;color:#bbb;display:${photoData?'none':'block'};z-index:1;">📷</span>
                    </div>`;
            }

            const { value: formResult } = await Swal.fire({
                title: '清查點位: ' + (point.props.name || featureId),
                html: `
                    <div style="text-align:left;">
                        <label><b>1. 清查狀態</b></label>
                        <select id="swal-status" class="swal2-input" style="width:100%;margin:10px 0 20px 0;">
                            <option value="正常" ${currentStatus==='正常'?'selected':''}>正常</option>
                            <option value="毀損" ${currentStatus==='毀損'?'selected':''}>毀損</option>
                            <option value="遺失" ${currentStatus==='遺失'?'selected':''}>遺失</option>
                            <option value="被覆蓋" ${currentStatus==='被覆蓋'?'selected':''}>被覆蓋</option>
                        </select>
                        <label><b>2. 現場照片 (1024x768)</b></label>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0 20px 0;">${photoHtml}</div>
                        <label><b>3. 備註描述</b></label>
                        <textarea id="swal-note" class="swal2-textarea" style="width:100%;height:60px;margin:0;">${currentNote}</textarea>
                    </div>`,
                showCancelButton: true,
                confirmButtonText: '儲存上傳',
                preConfirm: () => ({
                    status: document.getElementById('swal-status').value,
                    note: document.getElementById('swal-note').value,
                    photos: point.props.photos || []
                })
            });

            if (formResult) {
                Swal.fire({ title: '上傳處理中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                try {
                    const photoUrls = [];
                    for (let i = 0; i < formResult.photos.length; i++) {
                        const data = formResult.photos[i];
                        if (data && data.startsWith('data:image')) {
                            // 按 KML ID 分資料夾上傳
                            const fileRef = storage.ref().child(`${STORAGE_ROOT}/${kmlId}/${featureId}_${i}.jpg`);
                            const blob = await (await fetch(data)).blob();
                            await fileRef.put(blob);
                            photoUrls.push(await fileRef.getDownloadURL());
                        } else if (data) {
                            photoUrls.push(data);
                        }
                    }

                    await db.collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(featureId).set({
                        status: formResult.status,
                        note: formResult.note,
                        photos: photoUrls,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });

                    Swal.fire({ icon: 'success', title: '儲存完成', timer: 1000, showConfirmButton: false });
                } catch (e) {
                    Swal.fire('上傳失敗', e.message, 'error');
                }
            }
        };

        /**
         * 功能 D: 底部喚醒按鈕 (Leaflet 控制項)
         */
        if (window.mapNamespace && window.mapNamespace.map && !bottomControl) {
            const AuditMenu = L.Control.extend({
                options: { position: 'bottomcenter' },
                onAdd: function() {
                    this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                    this._container.style.display = 'none';
                    return this._container;
                },
                update: function() {
                    const active = window.currentSelectedPoint;
                    if (!active) { this._container.style.display = 'none'; return; }
                    const isDone = !!active.props.auditStatus;
                    this._container.style.display = 'block';
                    this._container.innerHTML = `
                        <button onclick="event.stopPropagation(); window.openAuditEditor()" 
                                style="background:${isDone?'#ff85c0':'#3498db'};color:white;border:3px solid #fff;padding:15px 30px;border-radius:50px;font-weight:bold;font-size:18px;box-shadow:0 4px 15px rgba(0,0,0,0.5);cursor:pointer;">
                            ${isDone ? '修改紀錄' : '開始清查點位'}
                        </button>`;
                }
            });
            bottomControl = new AuditMenu();
            bottomControl.addTo(window.mapNamespace.map);
        }

        console.log("[Audit] 清查模組全功能載入完成。");
    };

    // 啟動程序
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startModule);
    } else {
        startModule();
    }

    // ---------------------------------------------------------
    // 3. 【零侵入攔截】(立即執行) - 確保點位屬性與顏色正確
    // ---------------------------------------------------------
    const originalAddLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        if (ns && ns.currentKmlLayerId && window.auditLayersState[ns.currentKmlLayerId]) {
            const records = window.auditLayersState[ns.currentKmlLayerId];
            features.forEach(f => {
                const rid = f.properties.id || f.id;
                if (records[rid]) {
                    f.properties.auditStatus = records[rid].status;
                    f.properties.auditNote = records[rid].note;
                    f.properties.photos = records[rid].photos || [];
                }
                f.properties.kmlId = ns.currentKmlLayerId;
            });
        }
        return originalAddLayers ? originalAddLayers.apply(this, arguments) : null;
    };

})();