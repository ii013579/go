// kml.js - KML 上傳、合併覆蓋檢查與刪除復原管理模組
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

  if (els.triggerDeleteBtn) {
    els.triggerDeleteBtn.addEventListener('click', async () => {
      let currentMode = 'delete';

      const getModalContent = async () => {
        const currentUserEmail = auth.currentUser?.email;
        const isOwner = (window.currentUserRole === 'owner');
        let optionsHtml = '';
        let promptText = '';
        let warningHtml = '';
        let toggleText = '';
        let titleHeader = '';
        let headerBgColor = '';

        if (currentMode === 'delete') {
          titleHeader = '刪除圖層';
          headerBgColor = '#f9ebea';
          promptText = '請選擇要刪除的圖層：';
          warningHtml = '<p style="color: #d32f2f; font-size: 12px; margin-top: 10px; font-weight: bold;">警告：刪除後資料將移至回收桶。</p>';
          toggleText = '?? 切換至復原圖層';

          const layers = window.currentKmlLayers || [];
          optionsHtml = layers
            .map(layer => {
              const canDelete = isOwner || (window.currentUserRole === 'editor' && layer.uploadedBy === currentUserEmail);
              return canDelete 
                ? `<option value="${layer.id}">${layer.name}</option>`
                : `<option value="${layer.id}" disabled style="color: #999; background-color: #f2f2f2;">${layer.name} (無刪除權限)</option>`;
            })
            .join('');

          optionsHtml = optionsHtml ? '<option value="" disabled selected>-- 請選擇要刪除的圖層 --</option>' + optionsHtml 
                                    : '<option value="" disabled selected>-- 目前沒有可刪除的圖層 --</option>';
        } else {
          titleHeader = '復原圖層';
          headerBgColor = '#e8f8f5';
          promptText = '請選擇要復原的圖層：';
          warningHtml = '<p style="color: #27ae60; font-size: 12px; margin-top: 10px; font-weight: bold;">提示：選擇後將從回收桶還原該圖層。</p>';
          toggleText = '??? 切換至刪除圖層';

          try {
            const trashSnapshot = await db.collection('artifacts').doc(currentAppId)
              .collection('public').doc('data').collection('kmlTrash').get();

            if (trashSnapshot.empty) {
              optionsHtml = '<option value="" disabled selected>-- 回收桶目前沒有可復原的圖層 --</option>';
            } else {
              trashSnapshot.forEach(doc => {
                const data = doc.data();
                optionsHtml += `<option value="${doc.id}">${data.name || doc.id}</option>`;
              });
              optionsHtml = '<option value="" disabled selected>-- 請選擇要復原的圖層 --</option>' + optionsHtml;
            }
          } catch (e) {
            optionsHtml = '<option value="" disabled selected>-- 載入回收桶失敗 --</option>';
          }
        }

        return {
          title: titleHeader,
          html: `
            <div style="text-align: left; margin-top: 5px; background-color: ${headerBgColor}; padding: 12px; border-radius: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid rgba(0,0,0,0.1); padding-bottom: 6px;">
                <span style="font-size: 13px; color: #444;">目前模式：<strong>${titleHeader}</strong></span>
                <button type="button" id="swalModeToggleBtn" style="background-color: ${currentMode === 'delete' ? '#27ae60' : '#e74c3c'}; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">
                  ${toggleText}
                </button>
              </div>
              <p style="color: #333; margin-bottom: 5px;">${promptText}</p>
              <select id="modalKmlActionPicker" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #ddd; background-color: #fff;">
                ${optionsHtml}
              </select>
              ${warningHtml}
            </div>`
        };
      };

      while (true) {
        const content = await getModalContent();

        const { value: result, isDismissed } = await Swal.fire({
          title: content.title,
          html: content.html,
          showCancelButton: true,
          confirmButtonText: '確定',
          cancelButtonText: '取消',
          confirmButtonColor: currentMode === 'delete' ? '#e74c3c' : '#2ecc71',
          cancelButtonColor: '#707a86',
          focusConfirm: false,
          didOpen: () => {
            const toggleBtn = document.getElementById('swalModeToggleBtn');
            if (toggleBtn) {
              toggleBtn.onclick = () => {
                currentMode = (currentMode === 'delete') ? 'restore' : 'delete';
                Swal.close();
              };
            }
          },
          preConfirm: () => {
            const picker = document.getElementById('modalKmlActionPicker');
            const selectedId = picker ? picker.value : null;
            const selectedOpt = picker ? picker.options[picker.selectedIndex] : null;

            if (!selectedId || (selectedOpt && selectedOpt.disabled)) {
              Swal.showValidationMessage('請選擇有效的圖層！');
              return false;
            }
            return selectedId;
          }
        });

        if (isDismissed) {
          if (Swal.isVisible()) break; 
          else continue;
        }

        if (result) {
          const selectedId = result;

          if (currentMode === 'delete') {
            try {
              Swal.fire({ title: '正在刪除並備份圖層...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

              const docRef = getKmlCollectionRef().doc(selectedId);
              const docSnap = await docRef.get();

              if (docSnap.exists) {
                await db.collection('artifacts').doc(currentAppId)
                  .collection('public').doc('data')
                  .collection('kmlTrash').doc(selectedId).set({
                    ...docSnap.data(),
                    deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    deletedBy: auth.currentUser.email
                  });

                await docRef.delete();
                
                if (typeof window.cleanupAuditData === 'function') {
                  const selectedOpt = document.getElementById('modalKmlActionPicker')?.selectedOptions[0];
                  const kmlName = selectedOpt ? selectedOpt.textContent : null;
                  if (kmlName) await window.cleanupAuditData(kmlName);
                }

                const now = Date.now();
                await db.collection('artifacts').doc(currentAppId).collection('public').doc('data')
                  .collection('metadata').doc('sync').set({ lastUpdate: now }, { merge: true });

                localStorage.removeItem('kml_list_cache_data');
                localStorage.removeItem(`kml_data_${selectedId}`);

                Swal.fire({ icon: 'success', title: '圖層已刪除並移至回收桶。', timer: 1500, showConfirmButton: false });
                await window.optimizedUpdateKmlLayerSelects?.();
                window.clearAllKmlLayers?.();
                window.updatePinButtonState?.();
              }
            } catch (error) {
              Swal.fire('刪除失敗', error.message, 'error');
            }
          } else {
            try {
              Swal.fire({ title: '正在還原圖層...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

              const trashRef = db.collection('artifacts').doc(currentAppId)
                .collection('public').doc('data').collection('kmlTrash').doc(selectedId);
              
              const docSnap = await trashRef.get();
              if (!docSnap.exists) throw new Error('找不到該筆備份資料');

              const layerData = docSnap.data();
              delete layerData.deletedAt;
              delete layerData.deletedBy;

              await getKmlCollectionRef().doc(selectedId).set(layerData);
              await trashRef.delete();

              const now = Date.now();
              await db.collection('artifacts').doc(currentAppId).collection('public').doc('data')
                .collection('metadata').doc('sync').set({ lastUpdate: now }, { merge: true });

              localStorage.removeItem('kml_list_cache_data');

              Swal.fire({ icon: 'success', title: '圖層已成功復原！', timer: 1500, showConfirmButton: false });
              await window.optimizedUpdateKmlLayerSelects?.();
            } catch (error) {
              Swal.fire('復原失敗', error.message, 'error');
            }
          }
          break;
        }
      }
    });
  }
})();