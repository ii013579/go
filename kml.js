// kml.js
(function () {
  'use strict';

  const STATE = {
    currentId: null,
    loading: false,
    listLoaded: false
  };

  async function load(id) {
    if (!id) {
      MAP.clear();
      STATE.currentId = null;
      return;
    }
    if (STATE.loading || STATE.currentId === id) return;

    STATE.loading = true;
    const geojson = await KML_DB.geojson(id);
    MAP.render(geojson.features || geojson);
    STATE.currentId = id;
    STATE.loading = false;
  }

  async function refreshList() {
    if (STATE.listLoaded || !AUTH.user) return;

    const role = AUTH.role;
    const email = AUTH.user.email;
    const list = await KML_DB.list(role === 'editor' ? email : null);

    UI.updateKmlSelect(list);
    STATE.listLoaded = true;

    const pinned = localStorage.getItem('pinnedKmlId');
    if (pinned) load(pinned);
  }

  async function upload(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const xml = new DOMParser().parseFromString(reader.result, 'text/xml');
      const geojson = toGeoJSON.kml(xml);
      if (!geojson.features?.length) {
        alert('KML 檔案沒有任何圖徵');
        return;
      }

      const list = await KML_DB.list();
      const exist = list.find(k => k.name === file.name);

      if (exist && !confirm(`已存在「${file.name}」，是否覆蓋？`)) return;

      const id = await KML_DB.save({
        id: exist?.id,
        name: file.name,
        geojson,
        uploadedBy: AUTH.user.email,
        uploadedByRole: AUTH.role
      });

      STATE.listLoaded = false;
      await refreshList();
      await load(id);
    };
    reader.readAsText(file);
  }

  async function remove(id) {
    if (!id || !confirm('確定刪除此 KML？此操作不可逆')) return;

    await KML_DB.delete(id);

    if (STATE.currentId === id) {
      MAP.clear();
      STATE.currentId = null;
    }

    STATE.listLoaded = false;
    await refreshList();
  }

  // ===== 事件綁定 =====
  document.addEventListener('kml:select', e => load(e.detail));
  document.addEventListener('kml:upload', e => upload(e.detail));
  document.addEventListener('kml:delete', e => remove(e.detail));
  document.addEventListener('auth:changed', refreshList);
  document.addEventListener('auth:role', refreshList);

})();
