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
      if (listCache && Date.now() - listTime < TTL) {
        return listCache;
      }

      let q = col();
      if (uploadedBy) q = q.where('uploadedBy', '==', uploadedBy);

      const snap = await q.get();
      listCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      listTime = Date.now();
      return listCache;
    },

    async geojson(id) {
      const doc = await col().doc(id).get();
      return JSON.parse(doc.data().geojson);
    },

    async save({ id = null, name, geojson, uploadedBy, uploadedByRole }) {
      let ref;

      if (id) {
        ref = col().doc(id);
      } else {
        const exist = await col().where('name', '==', name).get();
        ref = exist.empty ? await col().add({}) : exist.docs[0].ref;
      }

      await ref.set({
        name,
        geojson: JSON.stringify(geojson),
        uploadTime: firebase.firestore.FieldValue.serverTimestamp(),
        uploadedBy,
        uploadedByRole
      }, { merge: true });

      this.clearCache();
      return ref.id;
    },

    async delete(id) {
      await col().doc(id).delete();
      this.clearCache();
    },

    clearCache() {
      listCache = null;
      listTime = 0;
    }
  };
})();
