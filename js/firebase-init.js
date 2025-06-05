// js/firebase-init.js

// 您的 Firebase 配置 (請替換成您自己的配置)
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// 輔助函數：顯示訊息 (通用)
function showMessage(elementId, msg, isError = true) {
  const messageDisplay = document.getElementById(elementId);
  if (messageDisplay) {
    messageDisplay.textContent = msg;
    messageDisplay.style.color = isError ? 'red' : 'green';
  }
}

// 輔助函數：顯示/隱藏載入中狀態 (通用)
function setLoading(buttonId, spinnerId, isLoading) {
  const button = document.getElementById(buttonId);
  const spinner = document.getElementById(spinnerId);
  if (button) button.disabled = isLoading;
  if (spinner) spinner.style.display = isLoading ? 'block' : 'none';
}

// 將 auth 和 db 導出，以便其他模組可以使用
// (在非模組化環境下，它們將是全域變數，但在嚴謹的 ES 模組中會使用 export)
// 由於這是簡單的 HTML script 標籤引用，這些會是全域變數。
// 所以其他 JS 文件可以直接使用 auth 和 db