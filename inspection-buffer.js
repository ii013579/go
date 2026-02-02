// inspection-buffer.js
// 5 點 / 時間 / unload 批次寫入 Firestore
// 使用方式： window.inspectionBuffer = new InspectionBuffer({kmlId, flushIntervalMs})
// 並呼叫 addPoint(feature)；檔案參考 auth-kml-management.js 的寫入邏輯

(function () {
  'use strict';

  function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

  class InspectionBuffer {
    constructor({ kmlId = null, flushIntervalMs = 10000 } = {}) {
      this.kmlId = kmlId;
      this.buffer = [];
      this.maxBatch = 5;
      this.flushing = false;
      this.flushIntervalMs = flushIntervalMs;
      this._interval = setInterval(() => this.flushIfNeeded(), this.flushIntervalMs);
      this.setupBeforeUnload();
    }

    addPoint(feature) {
      this.buffer.push({ feature, ts: Date.now() });
      if (this.buffer.length >= this.maxBatch) {
        this.flush();
      }
    }

    async flushIfNeeded() {
      if (this.buffer.length > 0) {
        await this.flush();
      }
    }

    async flush() {
      if (this.flushing || this.buffer.length === 0) return;
      this.flushing = true;

      const toWrite = this.buffer.splice(0, this.maxBatch);
      try {
        if (typeof db === 'undefined' || !this.kmlId) {
          console.warn('inspection-buffer: db 或 kmlId 未設定，暫時將資料保留於 buffer。');
          // 若無法寫入，將資料再放回 buffer（簡單處理）
          this.buffer = toWrite.concat(this.buffer);
          return;
        }

        // 範例寫入路徑：將 features 寫入 kmlLayers/{kmlId}/inspections 子集合
        const batch = db.batch();
        const colRef = db.collection('artifacts').doc(appId)
          .collection('public').doc('data')
          .collection('kmlLayers').doc(this.kmlId)
          .collection('inspections');

        toWrite.forEach(item => {
          const docRef = colRef.doc();
          batch.set(docRef, {
            feature: item.feature,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });

        await batch.commit();
      } catch (err) {
        console.error('inspection-buffer flush 失敗：', err);
        // 若失敗，把資料放回 buffer（避免遺失）
        this.buffer = toWrite.concat(this.buffer);
      } finally {
        this.flushing = false;
      }
    }

    setupBeforeUnload() {
      window.addEventListener('beforeunload', (e) => {
        if (this.buffer.length === 0) return;
        // 試著同步 flush（非保證）
        navigator.sendBeacon = navigator.sendBeacon || function () { return false; };
        // 最好嘗試啟動一個同步寫入，這裡簡化為呼叫 flush（非同步）
        this.flush();
      });
    }

    destroy() {
      clearInterval(this._interval);
      window.removeEventListener('beforeunload', this.setupBeforeUnload);
    }
  }

  // 建立一個實例放到全域（需由外部設定 kmlId）
  window.InspectionBuffer = InspectionBuffer;
  window.inspectionBuffer = window.inspectionBuffer || null;
})();