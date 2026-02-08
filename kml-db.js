// kml-db.js (v2.0, Firebase v9+)

import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  deleteObject,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

import { db, storage, appId } from "./firebase-init.js";
import { AUTH } from "./auth.js";

/* =========================
   Firestore 路徑（v1.9.6 對齊）
========================= */

const KML_COL = collection(
  db,
  'artifacts',
  appId,
  'public',
  'data',
  'kmlLayers'
);

/* =========================
   Cache（?? 防止多次讀取）
========================= */

let cacheList = null;
let cacheTime = 0;
const CACHE_TTL = 5000;

/* =========================
   工具
========================= */

function invalidateCache() {
  cacheList = null;
  cacheTime = 0;
}

/* =========================
   對外 API
========================= */

export const KML_DB = {

  /* ===== 列出 KML（主畫面 / dashboard 共用）===== */
  async list() {
    if (cacheList && Date.now() - cacheTime < CACHE_TTL) {
      return cacheList;
    }

    const q = query(KML_COL, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);

    cacheList = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    cacheTime = Date.now();
    return cacheList;
  },

  /* ===== 取得 GeoJSON（?? 一定回傳 features[]）===== */
  async getGeoJSON(id) {
    const snap = await getDoc(doc(KML_COL, id));
    if (!snap.exists()) return [];

    const data = snap.data();
    try {
      const parsed = JSON.parse(data.geojson);
      return parsed.features || [];
    } catch {
      return [];
    }
  },

  /* ===== 上傳 / 覆蓋 KML（v1.9.6 行為）===== */
  async upload({ file, geojson, filename }) {
    if (!AUTH.user) throw new Error('尚未登入');

    // Storage 路徑（與 v1.9.6 一致）
    const storageRef = ref(
      storage,
      `kml/${appId}/${filename}`
    );

    // 上傳檔案
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    // Firestore（同名直接覆蓋）
    await setDoc(
      doc(KML_COL, filename),
      {
        filename,
        geojson: JSON.stringify(geojson),
        fileUrl: url,
        uploadedBy: AUTH.user.uid,
        createdAt: serverTimestamp()
      },
      { merge: true }
    );

    invalidateCache();
  },

  /* ===== 刪除 KML（Storage + Firestore）===== */
  async remove(id) {
    const docRef = doc(KML_COL, id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;

    const data = snap.data();

    // 刪 Storage
    try {
      await deleteObject(
        ref(storage, `kml/${appId}/${data.filename}`)
      );
    } catch {}

    // 刪 Firestore
    await deleteDoc(docRef);

    invalidateCache();
  }
};
