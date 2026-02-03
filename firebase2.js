/*************************************************
 * firebase.js
 *************************************************/

if (!firebase.apps.length) {
    firebase.initializeApp({
       apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
       authDomain: "kmldata-d22fb.firebaseapp.com",
       projectId: "kmldata-d22fb",
       storageBucket: "kmldata-d22fb.firebasestorage.app",
       messagingSenderId: "6673236901",
       appId: "1:6673236901:web:5aac773cbb512a14b8de4c",
       measurementId: "G-TJFH5SXNJX"
    });
}

window.firebaseApp = firebase.app();
window.firebaseAuth = firebase.auth();
window.firebaseDB = firebase.firestore();
window.firebaseStorage = firebase.storage();

firebaseDB.enablePersistence({ synchronizeTabs: true })
    .catch(err => {
        console.warn('[firebase] persistence disabled:', err.code);
    });

firebaseDB.settings({
    ignoreUndefinedProperties: true
});
