/**
 * 檔名：data.js
 * 版本：v2.1.0
 * 權責：資料 CRUD 處理、地圖圖徵樣式控制
 */
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const DB_PATH = `artifacts/kmldata-d22fb/public/data/kmlLayers`;

// 紅點樣式與導航按鈕
window.addGeoJsonLayers = (features) => {
    window.App.markers.clearLayers();
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
                        <a href="${navUrl}" target="_blank" class="nav-btn" style="background:#4285f4;color:white;padding:5px 10px;text-decoration:none;border-radius:3px;display:inline-block;">Google 導航</a>`);
            window.App.markers.addLayer(m);
            } else {
            window.App.geoJsonLayers.addLayer(L.geoJSON(f));
        }
    });
    const bounds = L.featureGroup([window.App.markers, window.App.geoJsonLayers]).getBounds();
    if (bounds.isValid()) window.App.map.fitBounds(bounds, { padding: [50, 50] });
        }
    });
};

// 讀取資料庫清單
window.updateKmlSelect = async () => {
    const sel = document.getElementById('kmlLayerSelect');
    if (!sel) return;
    try {
        const snap = await getDocs(collection(window.db, DB_PATH));
        sel.innerHTML = '<option value="">請選擇圖層</option>';
        snap.forEach(d => {
            const opt = new Option(d.data().name || d.id, d.id);
            sel.add(opt);
        });
    } catch (e) { console.error("讀取資料庫失敗", e); }
};

// 觸發檔案選取並上傳
window.triggerUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.kml';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            // 這裡應加入 kml 轉 geojson 的邏輯，以下簡化展示上傳流程
            const content = event.target.result; 
            const layerName = file.name.replace('.kml', '');
            await window.saveToFirestore(layerName, content);
        };
        reader.readAsText(file);
    };
    input.click();
};

window.saveToFirestore = async (name, data) => {
    const id = Date.now().toString();
    try {
        await setDoc(doc(window.db, DB_PATH, id), {
            name, geojsonContent: data, createdAt: serverTimestamp()
        });
        alert("上傳成功"); window.updateKmlSelect();
    } catch (e) { alert("上傳失敗"); }
};

//  刪除功能
window.deleteCurrentKml = async () => {
    const id = document.getElementById('kmlLayerSelect').value;
    if (!id || !confirm("確定刪除此圖層？")) return;
    try {
        await deleteDoc(doc(window.db, DB_PATH, id));
        alert("已刪除"); window.updateKmlSelect();
        window.App.markers.clearLayers();
    } catch (e) { alert("刪除失敗"); }
};