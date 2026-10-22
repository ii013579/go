// layer.js - 圖層選單、快取與釘選控制模組
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const els = {
    kmlLayerSelect: $('kmlLayerSelect'),
    kmlLayerSelectDashboard: $('kmlLayerSelectDashboard'),
    kmlControlsDashboard: $('kmlControlsDashboard'),
    uploadKmlSectionDashboard: $('uploadKmlSectionDashboard'),
    deleteKmlSectionDashboard: $('deleteKmlSectionDashboard'),
    uploadKmlSubmitBtnDashboard: $('uploadKmlSubmitBtnDashboard'),
    deleteSelectedKmlBtn: $('deleteSelectedKmlBtn'),
    pinButton: $('pinButton')
  };

  window.currentKmlLayers = [];
  let isUpdatingList = false;
  let hasInitialAutoLoaded = false;
  let hasInitialMenuLoaded = false;

  const currentAppId = (typeof appId !== 'undefined') ? appId : 'kmldata-d22fb';

  const getKmlCollectionRef = () =>
    db.collection('artifacts').doc(currentAppId).collection('public').doc('data').collection('kmlLayers');

  const getSyncDocRef = () =>
    db.collection('artifacts').doc(currentAppId).collection('public').doc('data').collection('metadata').doc('sync');

  const createOption = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  };

  const updatePinButtonState = () => {
    const pinBtn = els.pinButton;
    const select = els.kmlLayerSelect;
    if (!pinBtn || !select) return;

    const kmlId = select.value || '';
    const pinnedId = localStorage.getItem('pinnedKmlId') || '';

    if (kmlId) pinBtn.removeAttribute('disabled');
    else pinBtn.setAttribute('disabled', 'true');

    if (kmlId && pinnedId === kmlId) pinBtn.classList.add('clicked');
    else pinBtn.classList.remove('clicked');
  };
  window.updatePinButtonState = updatePinButtonState;

  const handleKmlLayerSelectChange = () => {
    const select = els.kmlLayerSelect;
    const kmlId = select?.value || '';

    updatePinButtonState();

    if (kmlId && typeof window.loadKmlLayerFromFirestore === 'function') {
      if (window.currentKmlLayerId === kmlId) return;
      window.loadKmlLayerFromFirestore(kmlId);
    } else if (!kmlId && typeof window.clearAllKmlLayers === 'function') {
      window.clearAllKmlLayers();
    }
  };

  const tryLoadPinnedKmlLayerWhenReady = () => {
    if (hasInitialAutoLoaded) return; 
    const select = els.kmlLayerSelect;
    const pinnedId = localStorage.getItem('pinnedKmlId') || localStorage.getItem('pinnedKmlLayerId');

    if (!pinnedId || !select || select.options.length <= 1) return;

    const option = Array.from(select.options).find(opt => opt.value === pinnedId);
    if (!option) {
      localStorage.removeItem('pinnedKmlId');
      localStorage.removeItem('pinnedKmlLayerId');
      return;
    }

    if (typeof window.loadKmlLayerFromFirestore === 'function') {
      if (window.mapNamespace?.isLoadingKml || window.mapNamespace?.currentKmlLayerId === pinnedId) return;

      hasInitialAutoLoaded = true;
      select.value = pinnedId;
      updatePinButtonState();
      window.loadKmlLayerFromFirestore(pinnedId);
    }
  };

  const updateKmlLayerSelects = async (passedLayers = null) => {
    const select = els.kmlLayerSelect;
    const selectDashboard = els.kmlLayerSelectDashboard;
    const deleteBtn = els.deleteSelectedKmlBtn;

    if (!select) return;
    if (deleteBtn) deleteBtn.disabled = true;

    const canEdit = (window.currentUserRole === 'owner' || window.currentUserRole === 'editor');
    if (els.kmlControlsDashboard) els.kmlControlsDashboard.style.display = canEdit ? 'flex' : 'none';
    if (els.uploadKmlSectionDashboard) els.uploadKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
    if (els.deleteKmlSectionDashboard) els.deleteKmlSectionDashboard.style.display = canEdit ? 'flex' : 'none';
    if (selectDashboard) selectDashboard.disabled = !canEdit;
    if (els.uploadKmlSubmitBtnDashboard) els.uploadKmlSubmitBtnDashboard.disabled = !canEdit;

    try {
      let layersToRender = [];
      if (Array.isArray(passedLayers)) {
        layersToRender = passedLayers;
      } else {
        const snapshot = await getKmlCollectionRef().get();
        snapshot.forEach(doc => layersToRender.push({ id: doc.id, ...doc.data() }));
        localStorage.setItem('kml_list_cache_data', JSON.stringify(layersToRender));
      }

      select.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
      if (selectDashboard) selectDashboard.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
      window.currentKmlLayers = []; 

      const currentUserEmail = auth.currentUser?.email;
      const isOwner = (window.currentUserRole === 'owner');

      layersToRender.forEach(layer => {
        const kmlId = layer.id;
        const kmlName = layer.name || `KML_${kmlId.substring(0, 8)}`;
        const uploadedBy = layer.uploadedBy || '';
        
        const opt1 = createOption(kmlId, kmlName);
        const opt2 = createOption(kmlId, kmlName);
        
        const canDelete = isOwner || (window.currentUserRole === 'editor' && uploadedBy === currentUserEmail);
        if (!canDelete && selectDashboard) {
          opt2.disabled = true;
          opt2.style.color = '#999';
          opt2.textContent = `${kmlName} (無刪除權限)`;
        }

        select.appendChild(opt1);
        if (selectDashboard) selectDashboard.appendChild(opt2);
        window.currentKmlLayers.push({ id: kmlId, name: kmlName, uploadedBy });
      });

      if (window.currentKmlLayers.length > 0 && canEdit && deleteBtn) deleteBtn.disabled = false;
      tryLoadPinnedKmlLayerWhenReady();
    } catch (error) {
      console.error("更新 KML 圖層列表錯誤:", error);
    }
  };

  async function optimizedUpdateKmlLayerSelects() {
    if (isUpdatingList) return;
    isUpdatingList = true;

    const LIST_CACHE_KEY = 'kml_list_cache_data';
    const SYNC_TIME_KEY = 'kml_list_last_sync';

    try {
      const syncSnap = await getSyncDocRef().get();
      const serverUpdate = syncSnap.exists ? (syncSnap.data().lastUpdate || 0) : 0;
      const localUpdate = parseInt(localStorage.getItem(SYNC_TIME_KEY) || "0");
      const cachedList = localStorage.getItem(LIST_CACHE_KEY);

      if (cachedList && serverUpdate <= localUpdate && serverUpdate !== 0) {
        await updateKmlLayerSelects(JSON.parse(cachedList));
        tryLoadPinnedKmlLayerWhenReady();
        return; 
      }

      Object.keys(localStorage).forEach(key => { if (key.startsWith('kml_data_')) localStorage.removeItem(key); });

      const snapshot = await getKmlCollectionRef().get();
      const layers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(layers));
      localStorage.setItem(SYNC_TIME_KEY, serverUpdate.toString());

      await updateKmlLayerSelects(layers);
      tryLoadPinnedKmlLayerWhenReady();
    } catch (err) {
      const snapshot = await getKmlCollectionRef().get();
      const layers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      await updateKmlLayerSelects(layers);
      tryLoadPinnedKmlLayerWhenReady();
    } finally {
      isUpdatingList = false;
    }
  }
  window.optimizedUpdateKmlLayerSelects = optimizedUpdateKmlLayerSelects;

  // 初始化選單載入
  auth.onAuthStateChanged(async () => {
    if (!hasInitialMenuLoaded) {
      hasInitialMenuLoaded = true;
      await optimizedUpdateKmlLayerSelects();
    }
  });

  if (els.kmlLayerSelect) els.kmlLayerSelect.addEventListener('change', handleKmlLayerSelectChange);

  if (els.pinButton) {
    els.pinButton.addEventListener('click', () => {
      const select = els.kmlLayerSelect;
      if (!select || !select.value) return;
      const selectedKmlId = select.value;
      const currentPinnedId = localStorage.getItem('pinnedKmlId');

      if (currentPinnedId === selectedKmlId) {
        localStorage.removeItem('pinnedKmlId');
      } else {
        localStorage.setItem('pinnedKmlId', selectedKmlId);
      }
      updatePinButtonState();
    });
  }
})();