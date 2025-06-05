// js/firebase-init.js

// 您的 Firebase 配置 (已帶入您提供的資訊)
const firebaseConfig = {
  apiKey: "AIzaSyC-uaCnvgtYacPf_7BtwbwdDUw-WMx4d8s",
  authDomain: "kmldata-d22fb.firebaseapp.com",
  projectId: "kmldata-d22fb",
  storageBucket: "kmldata-d22fb.firebasestorage.app",
  messagingSenderId: "6673236901",
  appId: "1:6673236901:web:5aac773cbb512a14b8de4c",
  measurementId: "G-TJFH5SXNJX"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// 輔助函數：在指定元素中顯示訊息
function showMessage(elementId, msg, isError = true) {
  const messageDisplay = document.getElementById(elementId);
  if (messageDisplay) {
    messageDisplay.textContent = msg;
    messageDisplay.style.color = isError ? 'red' : 'green';
  }
}

// 輔助函數：控制按鈕的載入狀態和旋轉圖示
function setLoading(buttonId, spinnerId, isLoading) {
  const button = document.getElementById(buttonId);
  const spinner = document.getElementById(spinnerId);
  if (button) button.disabled = isLoading;
  if (spinner) spinner.style.display = isLoading ? 'block' : 'none';
}