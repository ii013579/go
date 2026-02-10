/**
 * 檔名：data.js
 * 版本：v2.1.3
 * 權責：資料 CRUD 處理、地圖圖徵樣式控制
 * 功能：[修正 3-2, 3-3, 3-4] KML 上傳/刪除，恢復紅點與導航按鈕。
 */
import { collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const DB_PATH = `artifacts/kmldata-d22fb/public/data/kmlLayers`;

// 修正 3-4: 恢復紅點樣式與導航按鈕
window.addGeoJsonLayers = (features) => {
    window.App.markers.clearLayers();
    window.App.geoJsonLayers.clearLayers();
    window.App.allKmlFeatures = features;
    
    features.forEach(f => {
        if (f.geometry.type === 'Point') {
            const coords = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
            const m = L.circleMarker(coords, {
                radius: 8, fillColor: "#ff0000", color: "#fff", weight: 2, fillOpacity: 0.8
            });
            // 恢復導航按鈕
            const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${coords[0]},${coords[1]}`;
            m.bindPopup(`<b>${f.properties.name || '點位'}</b><br><br>
                        <a href="${navUrl}" target="_blank" style="background:#4285f4;color:white;padding:5px 10px;text-decoration:none;border-radius:3px;display:inline-block;">Google 導航</a>`);
            window.App.markers.addLayer(m);
        } else {
            window.App.geoJsonLayers.addLayer(L.geoJSON(f));
        }
    });
    
    const bounds = L.featureGroup([window.App.markers, window.App.geoJsonLayers]).getBounds();
    if (bounds.isValid()) window.App.map.fitBounds(bounds, { padding: [50, 50] });
};

// 修正 3-3: 讀取資料庫清單
window.updateKmlSelect = async () => {
    const sel = document.getElementById('kmlLayerSelect');
    if (!sel) return;
    try {
        const snap = await getDocs(collection(window.db, DB_PATH));
        sel.innerHTML = '<option value="">請選擇圖層</option>';
        snap.forEach(d => {
            sel.add(new Option(d.data().name || d.id, d.id));
        });
    } catch (e) { console.error("讀取資料庫失敗", e); }
};

// 修正 3-2: 觸發檔案選取並上傳
window.triggerUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.kml';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            const content = event.target.result; 
            const layerName = prompt("請輸入圖層名稱", file.name.replace('.kml', ''));
            if (layerName) {
                const id = Date.now().toString();
                try {
                    await setDoc(doc(window.db, DB_PATH, id), {
                        name: layerName, 
                        geojsonContent: content, 
                        createdAt: serverTimestamp()
                    });
                    alert("上傳成功"); window.updateKmlSelect();
                } catch (err) { alert("上傳失敗"); }
            }
        };
        reader.readAsText(file);
    };
    input.click();
};

// 修正 3-3: 刪除功能
window.deleteCurrentKml = async () => {
    const id = document.getElementById('kmlLayerSelect').value;
    if (!id || !confirm("確定刪除此圖層？")) return;
    try {
        await deleteDoc(doc(window.db, DB_PATH, id));
        alert("已刪除"); window.updateKmlSelect();
        window.App.markers.clearLayers();
    } catch (e) { alert("刪除失敗"); }
};