/**
 * audit-module.js - 2026.04.14 最終整合完整版
 * 功能：
 * 1. 攔截渲染：解決藍/粉紅點顏色消失的問題。
 * 2. 影像處理：強制壓縮照片至 1024x768 (JPEG 80%)。
 * 3. 儲存隔離：按 KML 圖層名稱建立 Storage 資料夾。
 * 4. 底部選單：點擊點位自動喚醒「編輯紀錄」按鈕。
 */
(function() {
    'use strict';

    // 延遲初始化，確保 firebase 物件已準備就緒
    const getDB = () => firebase.firestore();
    const getStorage = () => firebase.storage();
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    window.auditLayersState = {}; 
    const auditUnsubscribes = {};
    let bottomControl = null;

    // ==========================================
    // 1. 核心攔截 (AOP) - 解決顏色持續性與屬性注入
    // ==========================================
    const originalAddGeoJsonLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        if (!ns) return originalAddGeoJsonLayers.apply(this, arguments);

        const kmlId = ns.currentKmlLayerId;
        if (kmlId && window.auditLayersState[kmlId]) {
            const records = window.auditLayersState[kmlId];
            features.forEach(f => {
                const fid = f.properties.id || f.id;
                const record = records[fid];
                if (record) {
                    // 同步 Firebase 資料到 Feature 屬性中
                    f.properties.auditStatus = record.status;
                    f.properties.auditNote = record.note;
                    f.properties.photos = record.photos || [];
                }
                f.properties.kmlId = kmlId; // 標記點位所屬圖層
            });
        }
        return originalAddGeoJsonLayers.apply(this, arguments);
    };

    // ==========================================
    // 2. Firebase 即時監聽與自動刷新
    // ==========================================
    window.initAuditListener = function(kmlId) {
        if (!kmlId) return;
        if (auditUnsubscribes[kmlId]) auditUnsubscribes[kmlId]();

        console.log("[Audit] 啟動即時監聽: " + kmlId);
        try {
            auditUnsubscribes[kmlId] = getDB().collection(APP_PATH).doc(kmlId).collection('auditRecords')
                .onSnapshot(snapshot => {
                    const updates = {};
                    snapshot.forEach(doc => { updates[doc.id] = doc.data(); });
                    window.auditLayersState[kmlId] = updates;

                    // 當資料異動，觸發地圖重新渲染以更新顏色
                    const ns = window.mapNamespace;
                    if (ns && ns.currentKmlLayerId === kmlId && ns.allKmlFeatures) {
                        window.addGeoJsonLayers(ns.allKmlFeatures);
                    }
                    if (bottomControl) bottomControl.update();
                });
        } catch (e) {
            console.error("[Audit] 監聽失敗:", e);
        }
    };

    // ==========================================
    // 3. 影像處理：壓縮至 1024x768
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
                    
                    // 繪製背景與縮放影像
                    ctx.fillStyle = "#FFFFFF";
                    ctx.fillRect(0, 0, 1024, 768);
                    ctx.drawImage(img, 0, 0, 1024, 768);

                    const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
                    
                    // UI 更新
                    const prevImg = document.getElementById(`audit-prev-${index}`);
                    const icon = document.getElementById(`audit-icon-${index}`);
                    if (prevImg) { prevImg.src = compressedBase64; prevImg.style.display = 'block'; }
                    if (icon) icon.style.display = 'none';
                    
                    // 存入全域變數
                    if (!window.currentSelectedPoint.props.photos) window.currentSelectedPoint.props.photos = [];
                    window.currentSelectedPoint.props.photos[index] = compressedBase64;
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(input.files[0]);
        }
    };

    // ==========================================
    // 4. 清查對話框與 Firebase Storage 上傳
    // ==========================================
    window.openAuditEditor = async function() {
        const point = window.currentSelectedPoint;
        if (!point) return;

        const kmlId = point.kmlId;
        const featureId = point.id;
        const currentStatus = point.props.auditStatus || '正常';
        const currentNote = point.props.auditNote || '';
        const targetCount = 2; // 預設張數

        let photoHtml = '';
        for (let i = 0; i < targetCount; i++) {
            const photoData = point.props.photos?.[i] || '';
            photoHtml += `
                <div style="border: 2px dashed #ccc; height: 90px; position: relative; display: flex; align-items: center; justify-content: center; background: #fafafa; border-radius: 8px;">
                    <input type="file" accept="image/*" capture="environment" onchange="window.handleAuditPhotoPreview(this, ${i})" 
                           style="position: absolute; width: 100%; height: 100%; opacity: 0; z-index: 2; cursor: pointer;">
                    <img id="audit-prev-${i}" src="${photoData}" style="width: 100%; height: 100%; object-fit: cover; display: ${photoData ? 'block' : 'none'}; z-index: 1;">
                    <span id="audit-icon-${i}" style="font-size: 28px; color: #999; display: ${photoData ? 'none' : 'block'}; z-index: 1;">📷</span>
                </div>`;
        }

        const { value: formResult } = await Swal.fire({
            title: '點位: ' + (point.props.name || featureId),
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
            confirmButtonText: '儲存上傳',
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
                        // 上傳至指定資料夾: storage/KML名稱/點位ID_序號.jpg
                        const fileRef = getStorage().ref().child(`${STORAGE_ROOT}/${kmlId}/${featureId}_${i}.jpg`);
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
                Swal.fire('上傳失敗', '請確認網路連線與權限', 'error');
            }
        }
    };

    // ==========================================
    // 5. 底部選單控制項 (Leaflet Control)
    // ==========================================
    document.addEventListener('DOMContentLoaded', () => {
        if (!window.mapNamespace || !window.mapNamespace.map) return;
        
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
                this._container.innerHTML = `
                    <button onclick="event.stopPropagation(); window.openAuditEditor()" 
                            style="background: ${isDone ? '#ff85c0' : '#3498db'}; color: white; border: 3px solid #fff; padding: 15px 30px; border-radius: 50px; font-weight: bold; font-size: 18px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); cursor: pointer;">
                        ${isDone ? '查看/修改紀錄' : '開始清查點位'}
                    </button>`;
            }
        });

        bottomControl = new AuditBottomMenu();
        bottomControl.addTo(window.mapNamespace.map);
    });

    console.log("[Audit] 清查模組完整功能已載入。");
})();