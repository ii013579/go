/**
 * 檔名：data.js
 * 版本：v2.1.0
 * 權責：資料 CRUD 處理、地圖圖徵樣式控制
 * 功能：
 * - 修正路徑至 artifacts/kmldata-d22fb/public/data/kmlLayers
 * - 恢復點位「紅點」樣式與「導航按鈕」
 * - 實現上傳 (setDoc) 與 刪除 (deleteDoc) 功能
 */
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const DB_PATH = `artifacts/kmldata-d22fb/public/data/kmlLayers`;

window.addGeoJsonLayers = (features) => {
    window.App.markers.clearLayers();
    window.App.geoJsonLayers.clearLayers();
    features.forEach(f => {
        if (f.geometry.type === 'Point') {
            const coords = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
            const m = L.circleMarker(coords, { radius: 8, fillColor: "#ff0000", color: "#fff", weight: 2, fillOpacity: 0.8 });
            // 導航按鈕 (恢復 v1.9.6 樣式)
            const popup = `<div style="text-align:center;"><b>${f.properties.name || '圖徵點'}</b><br><br>
                           <a href="https://www.google.com/maps/dir/?api=1&destination=${coords[0]},${coords[1]}" 
                           target="_blank" style="background:#4285f4;color:white;padding:5px 10px;text-decoration:none;border-radius:3px;">Google 導航</a></div>`;
            m.bindPopup(popup);
            window.App.markers.addLayer(m);
        } else {
            window.App.geoJsonLayers.addLayer(L.geoJSON(f));
        }
    });
    const bounds = L.featureGroup([window.App.markers, window.App.geoJsonLayers]).getBounds();
    if (bounds.isValid()) window.App.map.fitBounds(bounds, { padding: [50, 50] });
};

window.updateKmlSelect = async () => {
    try {
        const snap = await getDocs(collection(window.db, DB_PATH));
        const sel = document.getElementById('kmlLayerSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">請選擇圖層</option>';
        snap.forEach(d => sel.add(new Option(d.data().name || d.id, d.id)));
    } catch (e) { console.warn("Access Restricted"); }
};

window.uploadKml = async (name, geo) => {
    if (!window.auth.currentUser) return;
    try {
        const id = Date.now().toString();
        await setDoc(doc(window.db, DB_PATH, id), {
            name, geojsonContent: geo, 
            uploadedBy: window.auth.currentUser.email, createdAt: serverTimestamp() 
        });
        alert("上傳成功"); window.updateKmlSelect();
    } catch (e) { alert("上傳失敗: " + e.message); }
};

window.deleteCurrentKml = async () => {
    const id = document.getElementById('kmlLayerSelect').value;
    if (!id || !confirm("確定刪除？")) return;
    try {
        await deleteDoc(doc(window.db, DB_PATH, id));
        alert("刪除成功"); window.updateKmlSelect();
        window.App.markers.clearLayers();
    } catch (e) { alert("刪除失敗"); }
};