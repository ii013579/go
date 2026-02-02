// inspection-buffer.js
let updateBuffer = [];

window.addToBuffer = (data) => {
    updateBuffer.push(data);
    if (updateBuffer.length >= 5) window.commitUpdates();
};

window.commitUpdates = async () => {
    if (updateBuffer.length === 0) return;
    const batch = db.batch();
    // 這裡實作將 buffer 中的每一筆，對應到 Firestore 的更新邏輯
    console.log("批次更新中...", updateBuffer);
    updateBuffer = [];
};

window.addEventListener('beforeunload', window.commitUpdates);