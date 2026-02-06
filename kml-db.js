// kml-db.js
(function () {
  'use strict';

  const col = () =>
    db.collection('artifacts')
      .doc(appId).collection('public')
      .doc('data').collection('kmlLayers');

  let listCache = null;
  let listTime = 0;
  const TTL = 5000;

  window.KML_DB = {

    async list(uploadedBy = null) {
      if (cache && Date.now() - cacheTime < TTL) return cache;

      let q = col();
      if (uploadedBy) q = q.where('uploadedBy', '==', uploadedBy);

      const snap = await q.get();
      cache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cacheTime = Date.now();
      return cache;
    },

    async geojson(id) {
      const doc = await col().doc(id).get();
      const parsed = JSON.parse(doc.data().geojson);
      return parsed.features || [];
    },

    clearCache() {
      cache = null;
      cacheTime = 0;
    }
  };
})();
