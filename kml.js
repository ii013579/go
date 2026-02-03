// kml.js — v2.0 baseline，集中 KML Firebase 監聽（不重複）

let kmlUnsubscribe = null;

window.allKmlFeatures = [];

window.loadKmlLayer = function (kmlId) {
    if (!window.APP_ID || !kmlId) return;

    // ?? 只保留一個 listener（解決重複讀取）
    if (typeof kmlUnsubscribe === 'function') {
        kmlUnsubscribe();
        kmlUnsubscribe = null;
    }

    const ref = db
        .collection('artifacts')
        .doc(window.APP_ID)
        .collection('public')
        .doc('data')
        .collection('kmlLayers')
        .doc(kmlId);

    kmlUnsubscribe = ref.onSnapshot((snap) => {
        if (!snap.exists) return;
        const data = snap.data();
        if (!data.geojsonContent) return;

        const geojson = data.geojsonContent;

        window.allKmlFeatures = geojson.features || [];

        // === 清空地圖 ===
        window.markers.clearLayers();
        window.navButtons.clearLayers();

        geojson.features.forEach(f => {
            if (f.geometry?.type !== 'Point') return;

            const [lon, lat] = f.geometry.coordinates;
            const latlng = L.latLng(lat, lon);
            const name = f.properties?.name || '未命名';
            const labelId = `label-${lat}-${lon}`.replace(/\./g, '_');

            const dot = L.marker(latlng, {
                icon: L.divIcon({
                    className: 'custom-dot-icon',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                }),
                interactive: true
            });

            const label = L.marker(latlng, {
                icon: L.divIcon({
                    className: 'marker-label',
                    html: `<span id="${labelId}">${name}</span>`
                }),
                interactive: false,
                zIndexOffset: 1000
            });

            dot.on('click', (e) => {
                L.DomEvent.stopPropagation(e);

                document
                    .querySelectorAll('.marker-label span.label-active')
                    .forEach(el => el.classList.remove('label-active'));

                const target = document.getElementById(labelId);
                if (target) target.classList.add('label-active');

                window.createNavButton(latlng, name);
            });

            window.markers.addLayer(dot);
            window.markers.addLayer(label);
        });
    });
};
