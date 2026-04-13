/**
 * audit-module.js - 2026.04.13 最終完整功能模組化版本
 * * 整合功能：
 * 1. 零侵入式攔截：自動同步 Firebase 狀態並決定點位顏色 (藍/粉紅)。
 * 2. 影像處理：強制壓縮照片至 1024x768 (JPEG 80%)。
 * 3. 儲存隔離：按 KML 圖層名稱建立 Storage 資料夾。
 * 4. 即時同步：解決搜尋或切換圖層後顏色消失的問題。
 */
(function() {
    'use strict';
    
    if (typeof firebase === 'undefined') {
        console.error("[Audit] Firebase SDK 未載入，請檢查 HTML 順序");
        return;
    }

    const db = firebase.firestore();
    const storage = firebase.storage();
    // Firebase 路徑配置
    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const STORAGE_ROOT = 'kmldata-d22fb/storage';

    window.auditLayersState = {}; 
    const auditUnsubscribes = {};

    // ==========================================
    // 1. 核心攔截 (Monkey Patch) - 解決顏色持續性
    // ==========================================
    const originalAddGeoJsonLayers = window.addGeoJsonLayers;
    window.addGeoJsonLayers = function(features) {
        const ns = window.mapNamespace;
        const kmlId = ns.currentKmlLayerId;

        // 如果目前處於清查模式且有緩存數據，則強行注入最新狀態
        if (kmlId && window.auditLayersState[kmlId]) {
            const records = window.auditLayersState[kmlId];
            features.forEach(f => {
                const fid = f.properties.id || f.id;
                const record = records[fid];
                if (record) {
                    // 同步 Firebase 屬性到 Feature 中，讓 map-logic 渲染正確顏色
                    f.properties.auditStatus = record.status;
                    f.properties.auditNote = record.note;
                    f.properties.photos = record.photos || [];
                } else {
                    // 若無紀錄則清除舊狀態（避免顏色殘留）
                    delete f.properties.auditStatus;
                }
                f.properties.kmlId = kmlId;
            });
        }
        // 調用原始渲染函式
        return originalAddGeoJsonLayers.apply(this, arguments);
    };

    // ==========================================
    // 2. Firebase 即時監聽與自動重繪
    // ==========================================
    window.initAuditListener = function(kmlId) {
    	  console.log("[Audit] 監聽器啟動:", kmlId);
        if (!kmlId) return;
        if (auditUnsubscribes[kmlId]) auditUnsubscribes[kmlId]();

        console.log(`[Audit] 啟動即時監聽: ${kmlId}`);
        auditUnsubscribes[kmlId] = db.collection(APP_PATH).doc(kmlId).collection('auditRecords')
            .onSnapshot(snapshot => {
                const updates = {};
                snapshot.forEach(doc => { updates[doc.id] = doc.data(); });
                window.auditLayersState[kmlId] = updates;

                // 當後端數據異動，立刻通知地圖重新染色 (不更動 map-logic)
                const ns = window.mapNamespace;
                if (ns && ns.currentKmlLayerId === kmlId && ns.allKmlFeatures) {
                    window.addGeoJsonLayers(ns.allKmlFeatures);
                }
            }, err => console.error("監聽失敗:", err));
    };

    // ==========================================
    // 3. 影像處理：壓縮至 1024x768
    // ==========================================
    window.handleAuditPhotoPreview = function(input, index) {
        if (input.files && input.files[0]) {
            const file = input.files[0];
            const reader = new FileReader();

            reader.onload = function(e) {
                const img = new Image();
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    // 強制設定規格
                    canvas.width = 1024;
                    canvas.height = 768;
                    const ctx = canvas.getContext('2d');
                    
                    // 填滿背景並繪製縮放後的圖片
                    ctx.fillStyle = "#FFFFFF";
                    ctx.fillRect(0, 0, 1024, 768);
                    ctx.drawImage(img, 0, 0, 1024, 768);

                    const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
                    
                    // 更新 UI 預覽
                    const prevImg = document.getElementById(`audit-prev-${index}`);
                    const icon = document.getElementById(`audit-icon-${index}`);
                    if (prevImg) { prevImg.src = compressedBase64; prevImg.style.display = 'block'; }
                    if (icon) icon.style.display = 'none';
                    
                    // 暫存在當前選中點位的記憶體中
                    if (!window.currentSelectedPoint.props.photos) window.currentSelectedPoint.props.photos = [];
                    window.currentSelectedPoint.props.photos[index] = compressedBase64;
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    };

    // ==========================================
    // 4. 清查編輯對話框 (Swal) 與上傳邏輯
    // ==========================================
    window.openAuditEditor = async function() {
        const point = window.currentSelectedPoint;
        if (!point) return;

        const kmlId = point.kmlId;
        const featureId = point.id;
        const currentStatus = point.props.auditStatus || '正常';
        const currentNote = point.props.auditNote || '';
        const targetCount = 2; // 預設應拍張數

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
            title: `點位: ${point.props.name || featureId}`,
            html: `
                <div style="text-align:left; font-family: sans-serif;">
                    <label style="font-weight:bold; color:#555;">1. 清查狀態</label>
                    <select id="swal-status" class="swal2-input" style="width:100%; margin: 8px 0 15px 0;">
                        <option value="正常" ${currentStatus==='正常'?'selected':''}>正常</option>
                        <option value="毀損" ${currentStatus==='毀損'?'selected':''}>毀損</option>
                        <option value="遺失" ${currentStatus==='遺失'?'selected':''}>遺失</option>
                        <option value="被覆蓋" ${currentStatus==='被覆蓋'?'selected':''}>被覆蓋</option>
                    </select>
                    <label style="font-weight:bold; color:#555;">2. 現場照片 (應拍 ${targetCount} 張)</label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0 15px 0;">${photoHtml}</div>
                    <label style="font-weight:bold; color:#555;">3. 備註描述</label>
                    <textarea id="swal-note" class="swal2-textarea" style="width:100%; height: 60px; margin: 8px 0;">${currentNote}</textarea>
                </div>`,
            confirmButtonText: '儲存並上傳',
            showCancelButton: true,
            cancelButtonText: '取消',
            focusConfirm: false,
            preConfirm: () => {
                return {
                    status: document.getElementById('swal-status').value,
                    note: document.getElementById('swal-note').value,
                    photos: point.props.photos || []
                };
            }
        });

        if (formResult) {
            Swal.fire({ title: '處理中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            try {
                const photoUrls = [];
                for (let i = 0; i < formResult.photos.length; i++) {
                    const data = formResult.photos[i];
                    // 僅上傳新拍攝的 Base64 檔案
                    if (data && data.startsWith('data:image')) {
                        const fileRef = storage.ref().child(`${STORAGE_ROOT}/${kmlId}/${featureId}_${i}.jpg`);
                        const blob = await (await fetch(data)).blob();
                        await fileRef.put(blob);
                        photoUrls.push(await fileRef.getDownloadURL());
                    } else if (data) {
                        photoUrls.push(data); // 保留原有網址
                    }
                }

                // 更新 Firestore
                await db.collection(APP_PATH).doc(kmlId).collection('auditRecords').doc(featureId).set({
                    status: formResult.status,
                    note: formResult.note,
                    photos: photoUrls,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                Swal.fire({ icon: 'success', title: '儲存成功', timer: 1000, showConfirmButton: false });
            } catch (e) {
                console.error("儲存出錯:", e);
                Swal.fire('上傳失敗', '請確認權限或網路連線', 'error');
            }
        }
    };
})();