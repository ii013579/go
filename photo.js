// photo.js
// 拍照 + Storage 上傳（簡單封裝）
// 上傳後回傳 downloadURL

(function () {
  'use strict';

  if (typeof storage === 'undefined') {
    console.warn('photo.js: Firebase storage 未初始化。');
  }

  // fileOrBlob: File 或 Blob； path: 儲存路徑（例如 `photos/{kmlId}/{timestamp}.jpg`）
  window.uploadPhotoToStorage = async function (fileOrBlob, path) {
    if (typeof storage === 'undefined') throw new Error('Storage 未初始化');
    if (!fileOrBlob) throw new Error('缺少要上傳的檔案');
    const ref = storage.ref().child(path);
    const snapshot = await ref.put(fileOrBlob);
    const url = await snapshot.ref.getDownloadURL();
    return { snapshot, url };
  };

  // 產生建議路徑
  window.makePhotoPath = function ({ kmlId = 'unknown', userId = 'anon' } = {}) {
    const ts = Date.now();
    return `photos/${kmlId}/${userId}_${ts}.jpg`;
  };
})();