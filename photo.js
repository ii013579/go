// photo.js
document.getElementById('hiddenPhotoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ref = storage.ref(`inspections/${Date.now()}_${file.name}`);
    window.showMessageCustom({ title: '上傳中', message: '照片正在傳送...' });
    const snap = await ref.put(file);
    window.currentPhotoUrl = await snap.ref.getDownloadURL();
    window.showMessageCustom({ title: '完成', message: '照片已就緒' });
});