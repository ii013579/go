/**
 * audit-module.js - 2026.04.14 高相容最終版
 * 解決：載入錯誤、1024x768壓縮、Storage分層、顏色持續顯示
 */
(function() {
    'use strict';

    // 使用延遲初始化，防止 Firebase SDK 尚未就緒導致的報錯
    const getDB = () => firebase.firestore();
    const getStorage = () => firebase.storage();
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    // 全域狀態與控制項
    window.auditLayersState = window.auditLayersState || {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;

    // ==========================================
    // 1. 核心攔截 (AOP) - 這是解決「藍/粉紅點」顏色消失的關鍵
    // ==========================================
    const originalAddGeoJsonLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        // 如果地圖環境尚未就緒，先跑原始函式
        if (!ns) return originalAddGeoJsonLayers ? originalAddGeoJsonLayers.apply(this, arguments) : null;

        const kmlId = ns.currentKmlLayerId;
        // 若有清查紀錄，強行將最新狀態注入 Feature 屬性
        if (kmlId && window.auditLayersState[kmlId]) {
            const records = window.auditLayersState[kmlId];
            features.forEach(function(f) {
                const fid = f.properties.id || f.id;
                const record = records[fid];
                if (record) {
                    f.properties.auditStatus = record.status;
                    f.properties.auditNote = record.note;
                    f.properties.photos = record.photos || [];
                }
                f.properties.kmlId = kmlId;
            });
        }
        return originalAddGeoJsonLayers.apply(this, arguments);
    };

    // ==========================================
    // 2. Firebase 監聽器 (由 auth-kml-management.js 調用)
    // ==========================================
    window.initAuditListener = function(kmlId) {
        if (!kmlId) return;
        if (auditUnsubscribes[kmlId]) auditUnsubscribes[kmlId]();

        console.log("[Audit] 啟動監聽: " + kmlId);
        try {
            auditUnsubscribes[kmlId] = getDB().collection(APP_PATH).doc(kmlId).collection('auditRecords')
                .onSnapshot(function(snapshot) {
                    const updates = {};
                    snapshot.forEach(function(doc) { updates[doc.id] = doc.data(); });
                    window.auditLayersState[kmlId] = updates;

                    // 當資料異動時，手動觸發地圖重新染色 (不更動 map-logic.js)
                    const ns = window.mapNamespace;
                    if (ns && ns.currentKmlLayerId === kmlId && ns.allKmlFeatures) {
                        window.addGeoJsonLayers(ns.allKmlFeatures);
                    }
                    if (bottomControl && bottomControl.update) bottomControl.update();
                }, function(err) {
                    console.error("[Audit] 監聽發生錯誤:", err);
                });
        } catch (e) {
            console.error("[Audit] 初始化監聽失敗:", e);
        }
    };

    // ==========================================
    // 3. 影像處理：強制壓縮至 1024x768
    // ==========================================
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
                    
                    // 白色背景補底並繪製縮放圖片
                    ctx.fillStyle = "#FFFFFF";
                    ctx.fillRect(0, 0, 1024, 768);
                    ctx.drawImage(img, 0, 0, 1024, 768);

                    const base64 = canvas.toDataURL('image/jpeg', 0.85);
                    const prevImg = document.getElementById('audit-prev-' + index);
                    const icon = document.getElementById('audit-icon-' + index);
                    if (prevImg) { prevImg.src = base64; prevImg.style.display = 'block'; }
                    if (icon) icon.style.display = 'none';
                    
                    if (!window.currentSelectedPoint.props.photos) window.currentSelectedPoint.props.photos = [];
                    window.currentSelectedPoint.props.photos[index] = base64;
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(input.files[0]);
        }
    };

    // ==========================================
    // 4. 清查編輯對話框 (整合 Storage 路徑隔離)
    // ==========================================
    window.openAuditEditor = async function() {
        const point = window.currentSelectedPoint;
        if (!point) return;

        const kmlId = point.kmlId;
        const featureId = point.id;
        const currentStatus = point.props.auditStatus || '正常';
        const currentNote = point.props.auditNote || '';
        const targetCount = 2; 

        let photoHtml = '';
        for (let i = 0; i < targetCount; i++) {
            const photoData = point.props.photos?.[i] || '';
            photoHtml += `
                <div style="border: 2px dashed #ddd; height: 90px; position: relative; display: flex; align-items: center; justify-content: center; background: #fafafa; border-radius: 8px; overflow: hidden;">
                    <input type="file" accept="image/*" capture="environment" onchange="window.handleAuditPhotoPreview(this, ${i})" 
                           style="position: absolute; width: 100%; height: 100%; opacity: 0; z-index: 2; cursor: pointer;">
                    <img id="audit-prev-${i}" src="${photoData}" style="width: 100%; height: 100%; object-fit: cover; display: ${photoData ? 'block' : 'none'}; z-index: 1;">
                    <span id="audit-icon-${i}" style="font-size: 28px; color: #bbb; display: ${photoData ? 'none' : 'block'}; z-index: 1;">📷</span>
                </div>`;
        }

        const { value: formResult } = await Swal.fire({
            title: '編輯點位: ' + (point.props.name || featureId),
            html: `
                <div style="text-align:left;">
                    <label><b>1. 清查狀態</b></label>
                    <select id="swal-status" class="swal2-input" style="width:100%; margin: 10px 0 20px 0;">
                        <option value="正常" ${currentStatus==='正常'?'selected':''}>正常</option>
                        <option value="毀損" ${currentStatus==='毀損'?'selected':''}>毀損</option>
                        <option value="遺失" ${currentStatus==='遺失'?'selected':''}>遺失</option>
                        <option value="被覆蓋" ${currentStatus==='被覆蓋'?'selected':''}>被覆蓋</option>
                    </select>
                    <label><b>2. 現場照片</b></label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0 20px 0;">${photoHtml}</div>
                    <label><b>3. 備註</b></label>
                    <textarea id="swal-note" class="swal2-textarea" style="width:100%; height: 60px; margin: 0;">${currentNote}</textarea>
                </div>`,
            showCancelButton: true,
            confirmButtonText: '儲存並上傳',
            preConfirm: () => {
                return {
                    status: document.getElementById('swal-status').value,
                    note: document.getElementById('swal-note').value,
                    photos: point.props.photos || []
                };
            }
        });

        if (formResult) {
            Swal.fire({ title: '上傳處理中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            try {
                const photoUrls = [];
                for (let i = 0; i < formResult.photos.length; i++) {
                    const data = formResult.photos[i];
                    if (data && data.startsWith('data:image')) {
                        // 上傳路徑：/kmldata-d22fb/storage/{KML圖層ID}/{點位ID}_{序號}.jpg
                        const fileRef = getStorage().ref().child(STORAGE_ROOT + '/' + kmlId + '/' + featureId + '_' + i + '.jpg');
                        const blob = await (await fetch(data)).blob();
                        await fileRef.put(blob);
                        photoUrls.push(await fileRef.getDownloadURL());
                    } else if (data) {
                        photoUrls.push(data);
                    }
                }

                await getDB().collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(featureId).set({
                    status: formResult.status,
                    note: formResult.note,
                    photos: photoUrls,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                Swal.fire({ icon: 'success', title: '儲存成功', timer: 1000, showConfirmButton: false });
            } catch (e) {
                console.error(e);
                Swal.fire('上傳失敗', e.message, 'error');
            }
        }
    };

    // ==========================================
    // 5. 底部按鈕顯示邏輯
    // ==========================================
    const initBottomMenu = function() {
        if (!window.mapNamespace || !window.mapNamespace.map || bottomControl) return;

        const AuditBottomMenu = L.Control.extend({
            options: { position: 'bottomcenter' },
            onAdd: function() {
                this._container = L.DomUtil.create('div', 'audit-bottom-menu');
                this._container.style.display = 'none';
                return this._container;
            },
            update: function() {
                const active = window.currentSelectedPoint;
                if (!active) {
                    this._container.style.display = 'none';
                    return;
                }
                const isDone = !!active.props.auditStatus;
                this._container.style.display = 'block';
                this._container.innerHTML = 
                    '<button onclick="event.stopPropagation(); window.openAuditEditor()" ' +
                    'style="background: ' + (isDone ? '#ff85c0' : '#3498db') + '; color: white; border: 3px solid #fff; padding: 15px 30px; border-radius: 50px; font-weight: bold; font-size: 18px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); cursor: pointer;">' +
                    (isDone ? '查看/修改紀錄' : '開始清查點位') +
                    '</button>';
            }
        });

        bottomControl = new AuditBottomMenu();
        bottomControl.addTo(window.mapNamespace.map);
    };

    // 確保 DOM 載入後初始化選單
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBottomMenu);
    } else {
        initBottomMenu();
    }

    console.log("[Audit] 模組載入成功。");
})();