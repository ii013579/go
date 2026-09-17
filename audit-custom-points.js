/**
 * audit-custom-points.js
 * 將 kmlLayers/{kmlId}/auditRecords/{pointKey} 中的自訂點位加入目前地圖展點。
 * 請在 map-logic.js 與 audit-module.js 之後載入。
 */
(function () {
    'use strict';

    const APP_PATH = 'artifacts/kmldata-d22fb/public/data/kmlLayers';
    const listeners = {};
    let wrapped = false;
    let lastKmlId = null;

    function getDb() {
        if (typeof db !== 'undefined' && db?.collection) return db;
        if (typeof firebase !== 'undefined' && firebase.firestore) return firebase.firestore();
        return null;
    }

    function getPointKey(record, fallback) {
        return String(record?.pointName || record?.name || record?.pointKey || fallback || '').trim();
    }

    function isValidCoordinate(value) {
        return value !== null && value !== undefined && Number.isFinite(Number(value));
    }

    function mergeCustomPoints(kmlId, records) {
        const ns = window.mapNamespace;
        if (!ns || ns.currentKmlLayerId !== kmlId || !Array.isArray(ns.allKmlFeatures)) return;

        const customRecords = Object.entries(records || {}).filter(([, record]) =>
            record?.isCustomPoint === true &&
            isValidCoordinate(record.lat) &&
            isValidCoordinate(record.lng)
        );

        const customKeys = new Set(customRecords.map(([docId, record]) => getPointKey(record, docId)));

        // 移除已從 auditRecords 消失的自訂點位，避免刪除後仍殘留在地圖上。
        ns.allKmlFeatures = ns.allKmlFeatures.filter(feature => {
            const props = feature?.properties || {};
            return !props.isCustomPoint || customKeys.has(String(props.auditPointKey || props.name || props.title || ''));
        });

        customRecords.forEach(([docId, record]) => {
            const pointKey = getPointKey(record, docId);
            if (!pointKey) return;

            const feature = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [Number(record.lng), Number(record.lat)]
                },
                properties: {
                    name: pointKey,
                    title: pointKey,
                    kmlId,
                    auditPointKey: pointKey,
                    isCustomPoint: true,
                    isAudited: true,
                    deviceStatus: record.deviceStatus || record.status || '新增',
                    auditStatus: record.auditStatus || record.deviceStatus || record.status || '新增',
                    auditNote: record.note || record.remark || '',
                    photos: Array.isArray(record.photos) ? record.photos : [],
                    fillColor: '#FCD770',
                    color: '#ffffff',
                    radius: 8,
                    fillOpacity: 0.85
                }
            };

            const index = ns.allKmlFeatures.findIndex(existing => {
                const props = existing?.properties || {};
                return String(props.auditPointKey || props.name || props.title || '') === pointKey;
            });

            if (index >= 0) ns.allKmlFeatures[index] = feature;
            else ns.allKmlFeatures.push(feature);
        });

        window.allKmlFeatures = ns.allKmlFeatures;
    }

    function renderCurrentLayer() {
        const ns = window.mapNamespace;
        if (ns?.map && Array.isArray(ns.allKmlFeatures) && typeof window.addGeoJsonLayers === 'function') {
            window.addGeoJsonLayers(ns.allKmlFeatures);
        }
    }

    function listenToAuditRecords(kmlId) {
        if (!kmlId || listeners[kmlId]) return;
        const firestore = getDb();
        if (!firestore) return;

        listeners[kmlId] = firestore.collection(APP_PATH).doc(kmlId)
            .collection('auditRecords')
            .onSnapshot(snapshot => {
                const records = {};
                snapshot.forEach(doc => { records[doc.id] = doc.data(); });

                window.auditLayersState = window.auditLayersState || {};
                window.auditLayersState[kmlId] = {
                    ...(window.auditLayersState[kmlId] || {}),
                    ...records
                };

                mergeCustomPoints(kmlId, records);
                if (window.mapNamespace?.currentKmlLayerId === kmlId) {
                    if (typeof window.forceMapRefresh === 'function') window.forceMapRefresh();
                    else renderCurrentLayer();
                }
            }, error => console.warn('[audit-custom-points] auditRecords 監聽失敗:', error));
    }

    function watchCurrentLayer() {
        const ns = window.mapNamespace;
        const kmlId = ns?.currentKmlLayerId;
        if (!kmlId || kmlId === lastKmlId) return;

        lastKmlId = kmlId;
        listenToAuditRecords(kmlId);
    }

    function install() {
        if (wrapped || typeof window.addGeoJsonLayers !== 'function') return;

        const originalAddGeoJsonLayers = window.addGeoJsonLayers;
        window.addGeoJsonLayers = function (features) {
            const kmlId = window.mapNamespace?.currentKmlLayerId;
            const records = kmlId ? window.auditLayersState?.[kmlId] : null;
            if (kmlId && records && Array.isArray(features)) {
                mergeCustomPoints(kmlId, records);
                features = window.mapNamespace?.allKmlFeatures || features;
            }
            return originalAddGeoJsonLayers.call(this, features);
        };
        wrapped = true;
    }

    const timer = setInterval(() => {
        install();
        watchCurrentLayer();

        if (window.mapNamespace?.map && typeof window.addGeoJsonLayers === 'function') {
            // 保留輪詢以偵測 map-logic.js 切換的下一個 kmlId；不需要時可安全停止。
            return;
        }
    }, 500);

    window.addEventListener('beforeunload', () => {
        clearInterval(timer);
        Object.values(listeners).forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') unsubscribe();
        });
    });
})();
