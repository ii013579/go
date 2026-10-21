// kml.js - KML 上傳、合併覆蓋檢查與刪除管理模組
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const els = {
    triggerUploadBtn: $('triggerUploadBtn'),
    hiddenKmlFileInput: $('hiddenKmlFileInput'),
    selectedKmlFileNameDashboard: $('selectedKmlFileNameDashboard'),
    uploadKmlSubmitBtnDashboard: $('uploadKmlSubmitBtnDashboard'),
    triggerDeleteBtn: $('triggerDeleteBtn'),
    deleteSelectedKmlBtn: $('deleteSelectedKmlBtn'),
    kmlLayerSelectDashboard: $('kmlLayerSelectDashboard'),
    kmlLayerSelect: $('kmlLayerSelect')
  };

  const currentAppId = (typeof appId !== 'undefined') ? appId : 'kmldata-d22fb';

  const getKmlCollectionRef = () =>
    db.collection('artifacts').doc(currentAppId).collection('public').doc('data').collection('kmlLayers');

  // 1. 檔案選擇狀態顯示
  if (els.selectedKmlFileNameDashboard && els.hiddenKmlFileInput) {
    els.selectedKmlFileNameDashboard.addEventListener('click', () => els.hiddenKmlFileInput.click());

    els.hiddenKmlFileInput.addEventListener('change', (event) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        els.selectedKmlFileNameDashboard.textContent = files.length === 1 ? files[0].name : `已選擇 ${files.length} 個檔案`;
        if (els.uploadKmlSubmitBtnDashboard) els.uploadKmlSubmitBtnDashboard.disabled = false;
      } else {
        els.selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
        if (els.uploadKmlSubmitBtnDashboard) els.uploadKmlSubmitBtnDashboard.disabled = true;
      }
    });
  }

  // 2. 多檔案選取預覽、自訂圖層名稱與同名覆蓋檢查
  if (els.triggerUploadBtn) {
    els.triggerUploadBtn.addEventListener('click', () => els.hiddenKmlFileInput.click());
  }

  if (els.hiddenKmlFileInput) {
    els.hiddenKmlFileInput.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const defaultLayerName = files.length === 1 
        ? files[0].name 
        : `${files[0].name} 等 ${files.length} 個檔案合併`;

      const fileNamesHtml = Array.from(files)
        .map(file => `<strong style="color: red;">${file.name}</strong>`)
        .join('<br>');

      const modalContent = `
        <div style="text-align: left; margin-top: 10px;">
          <p>您選擇了以下 ${files.length} 個檔案：<br>${fileNamesHtml}</p>
          <div style="margin-top: 15px;">
            <label style="display: block; font-size: 13px; font-weight: bold; margin-bottom: 5px; color: #333;">自訂圖層名稱（留空則使用預設名稱）：</label>
            <input type="text" id="modalCustomLayerName" value="${defaultLayerName}" style="width: 100%; padding: 8px; box-sizing: border-box; border-radius: 4px; border: 1px solid #ccc; font-size: 14px;" />
          </div>
          <p style="margin-top: 10px; font-size: 13px;">確定要執行上傳嗎？</p>
        </div>`;

      const confirmUpload = await window.showConfirmationModal('確認上傳', modalContent);

      if (confirmUpload) {
        const customInput = document.getElementById('modalCustomLayerName');
        let finalLayerName = customInput && customInput.value.trim() !== '' 
          ? customInput.value.trim() 
          : defaultLayerName;

        finalLayerName = finalLayerName.replace(/\.kml$/i, '').trim();

        // 同名圖層檢查與覆蓋提示
        const selectEl = els.kmlLayerSelect;
        if (selectEl) {
          const existingOption = Array.from(selectEl.options).find(opt => {
            const baseName = (opt.getAttribute('data-basename') || opt.textContent.split(' (')[0]).replace(/\.kml$/i, '').trim();
            return baseName.toLowerCase() === finalLayerName.toLowerCase();
          });

          if (existingOption) {
            const overwriteRes = await Swal.fire({
              title: '?? 發現同名圖層',
              text: `圖層「${finalLayerName}」已經存在，請問是否要覆蓋現有圖層與資料？`,
              icon: 'warning',
              showCancelButton: true,
              confirmButtonColor: '#e74c3c',
              cancelButtonColor: '#34495e',
              confirmButtonText: '確定覆蓋',
              cancelButtonText: '取消'
            });

            if (!overwriteRes.isConfirmed) {
              els.hiddenKmlFileInput.value = '';
              if (els.selectedKmlFileNameDashboard) els.selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
              return;
            }
          }
        }

        els.hiddenKmlFileInput.dataset.customLayerName = finalLayerName;
        els.uploadKmlSubmitBtnDashboard.click();
      } else {
        els.hiddenKmlFileInput.value = '';
        if (els.selectedKmlFileNameDashboard) els.selectedKmlFileNameDashboard.textContent = '尚未選擇檔案';
      }
    });
  }

  // 3. 執行合併與上傳至 Firestore
  if (els.uploadKmlSubmitBtnDashboard) {
    els.uploadKmlSubmitBtnDashboard.addEventListener('click', async () => {
      const files = els.hiddenKmlFileInput?.files;
      if (!files || files.length === 0 || !auth.currentUser) return;

      if (window.currentUserRole !== 'owner' && window.currentUserRole !== 'editor') {
        window.showMessage?.('錯誤', '您沒有權限上傳 KML。');
        return;
      }

      const layerName = els.hiddenKmlFileInput.dataset.customLayerName || (
        files.length === 1 ? files[0].name : `${files[0].name} 等 ${files.length} 個檔案合併`
      );

      try {
        const mergedFeatures = [];
        for (let i = 0; i < files.length; i++) {
          const fileText = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (err) => reject(err);
            reader.readAsText(files[i]);
          });

          const dom = new DOMParser().parseFromString(fileText, 'text/xml');
          const geojson = toGeoJSON.kml(dom);
          if (geojson && Array.isArray(geojson.features)) {
            mergedFeatures.push(...geojson.features);
          }
        }

        const combinedGeoJson = { type: "FeatureCollection", features: mergedFeatures };
        const kmlLayersCollectionRef = getKmlCollectionRef();
        const existingKmlQuery = await kmlLayersCollectionRef.where('name', '==', layerName).get();
        let kmlLayerDocRef = existingKmlQuery.empty ? kmlLayersCollectionRef.doc() : existingKmlQuery.docs[0].ref;

        await kmlLayerDocRef.set({
          name: layerName,
          uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
          uploadedBy: auth.currentUser.email,
          uploadedByRole: window.currentUserRole,
          geojson: JSON.stringify(combinedGeoJson)
        }, { merge: true });

        const now = Date.now();
        await db.collection('artifacts').doc(currentAppId).collection('public').doc('data')
          .collection('metadata').doc('sync').set({ lastUpdate: now, lastUpdateTime: new Date(now).toLocaleString('zh-TW') }, { merge: true });

        localStorage.removeItem('kml_list_cache_data');
        localStorage.removeItem(`kml_data_${kmlLayerDocRef.id}`);
        delete els.hiddenKmlFileInput.dataset.customLayerName;

        window.showMessage?.('成功', `已成功合併並上傳 ${files.length} 個檔案至圖層 "${layerName}"。`);
        await window.optimizedUpdateKmlLayerSelects?.();
        window.updatePinButtonState?.();
        els.hiddenKmlFileInput.value = '';
      } catch (error) {
        window.showMessage?.('錯誤', error.message);
      }
    });
  }

  // 4. 圖層刪除互動與執行
  if (els.triggerDeleteBtn) {
    els.triggerDeleteBtn.addEventListener('click', async () => {
      const currentUserEmail = auth.currentUser?.email;
      const isOwner = (window.currentUserRole === 'owner');
      const layers = window.currentKmlLayers || [];

      const options = layers
        .map(layer => {
          const canDelete = isOwner || (window.currentUserRole === 'editor' && layer.uploadedBy === currentUserEmail);
          return canDelete 
            ? `<option value="${layer.id}">${layer.name}</option>`
            : `<option value="${layer.id}" disabled style="color: #999; background-color: #f2f2f2;">${layer.name} (無刪除權限)</option>`;
        })
        .join('');

      if (!options) {
        window.showMessage?.('提示', '目前沒有可刪除的 KML 圖層。');
        return;
      }

      const modalContent = `
        <div style="text-align: left; margin-top: 10px;">
          <p>請選擇要刪除的圖層：</p>
          <select id="modalKmlDeletePicker" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #ddd; margin-top: 5px;">
            <option value="" disabled selected>-- 請選擇要刪除的圖層 --</option>
            ${options}
          </select>
          <p style="color: #d32f2f; font-size: 12px; margin-top: 10px; font-weight: bold;">警告：刪除後資料將無法復原。</p>
        </div>`;

      const confirmDelete = await window.showConfirmationModal('刪除圖層', modalContent);

      if (confirmDelete) {
        const picker = document.getElementById('modalKmlDeletePicker');
        const selectedId = picker ? picker.value : null;
        const selectedOpt = picker ? picker.options[picker.selectedIndex] : null;

        if (selectedId && selectedOpt && !selectedOpt.disabled) {
          els.kmlLayerSelectDashboard.value = selectedId;
          els.deleteSelectedKmlBtn.click();
        } else {
          window.showMessage?.('提示', '您未選擇有效的可刪除圖層，或無權限刪除該圖層。');
        }
      }
    });
  }

  if (els.deleteSelectedKmlBtn) {
    els.deleteSelectedKmlBtn.addEventListener('click', async () => {
      const kmlIdToDelete = els.kmlLayerSelectDashboard.value;
      const selectedOption = els.kmlLayerSelectDashboard.options[els.kmlLayerSelectDashboard.selectedIndex];
      const kmlName = selectedOption ? selectedOption.textContent.replace(' (無刪除權限)', '') : null;

      if (!kmlIdToDelete) return;

      const targetLayer = (window.currentKmlLayers || []).find(l => l.id === kmlIdToDelete);
      const currentUserEmail = auth.currentUser?.email;
      const isOwner = (window.currentUserRole === 'owner');
      const canDelete = isOwner || (window.currentUserRole === 'editor' && targetLayer?.uploadedBy === currentUserEmail);

      if (!canDelete) {
        window.showMessage?.('權限不足', '您只能刪除自己上傳的 KML 圖層。');
        return;
      }

      try {
        await getKmlCollectionRef().doc(kmlIdToDelete).delete();
        
        if (typeof window.cleanupAuditData === 'function' && kmlName) {
          await window.cleanupAuditData(kmlName);
        }

        const now = Date.now();
        await db.collection('artifacts').doc(currentAppId).collection('public').doc('data')
          .collection('metadata').doc('sync').set({ lastUpdate: now }, { merge: true });

        localStorage.removeItem('kml_list_cache_data');
        localStorage.removeItem(`kml_data_${kmlIdToDelete}`);

        window.showMessage?.('成功', '圖層及相關清查資料已刪除。');
        await window.optimizedUpdateKmlLayerSelects?.();
        window.clearAllKmlLayers?.();
        window.updatePinButtonState?.();
      } catch (error) {
        window.showMessage?.('刪除失敗', error.message);
      }
    });
  }
})();