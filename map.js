// map.js
const map = L.map('map', { zoomControl: false, maxZoom: 20 }).setView([23.6, 120.9], 8);
L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}').addTo(map);
const markersGroup = L.featureGroup().addTo(map);

window.renderMarkers = (features) => {
    markersGroup.clearLayers();
    features.forEach(f => {
        const isDone = f.properties.inspectionStatus === '已完成';
        const marker = L.circleMarker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
            radius: 8, fillColor: isDone ? "#808080" : "#FF0000", color: "#FFF", fillOpacity: 0.9
        });
        marker.on('click', () => {
            if (window.isEditMode) window.openInspectionModal(f); // 呼叫 inspection.js
            else window.showNavigationPopup(f, marker);
        });
        marker.addTo(markersGroup);
    });
};