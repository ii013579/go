// kml.js (v2.0, Firebase v9+)

import { KML_DB } from "./kml-db.js";
import { AUTH } from "./auth.js";

/* =========================
   DOM
========================= */

const kmlSelect = document.getElementById('kmlLayerSelect');
const kmlSelectDashboard = document.getElementById('kmlLayerSelectDashboard');

const fileInput = document.getElementById('hiddenKmlFileInput');
const fileNameLabel = document.getElementById('selectedKmlFileNameDashboard');
const uploadBtn = document.getElementById('uploadKmlSubmitBtnDashboard');
const deleteBtn = document.getElementById('deleteSelectedKmlBtn');

const pinBtn = document.getElementById('pinButton');

/* =========================
   狀態
========================= */

let currentKmlId = null;
let lastPinnedId = localStorage.getItem('pinnedKmlId');

/* =========================
   初始化
========================= */

document.addEventListener('auth:changed', refreshKmlList);
document.addEventListener('auth:role', refreshKmlList);

document.addEventListener('DOMContentLoaded', () => {
  if (lastPinnedId) {
    loadKml(lastPinnedId);
  }
});

/* =========================
   KML 清單
========================= */

async function refreshKmlList() {
  const list = await KML_DB.list();

  fillSelect(kmlSelect, list, '-- 請選擇 KML --');
  fillSelect(kmlSelectDashboard, list, '-- 請選擇 KML 圖層 --');

  kmlSelectDashboard.disabled = AUTH.role !== 'owner';
}

/* =========================
   Select helper
========================= */

function fillSelect(select, list, placeholder) {
  if (!select) return;

  select.innerHTML = `<option value="">${placeholder}</option>`;
  list.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.filename || item.id;
    select.appendChild(opt);
  });
}

/* =========================
   載入並顯示 KML
========================= */

async function loadKml(id) {
  if (!id || id === currentKmlId) return;

  const features = await KML_DB.getGeoJSON(id);
  MAP.render(features);

  currentKmlId = id;
  kmlSelect.value = id;
  pinBtn.disabled = false;
}

/* =========================
   下拉選單事件
========================= */

kmlSelect?.addEventListener('change', e => {
  loadKml(e.target.value);
});

/* =========================
   Pin（v1.9.6 行為）
========================= */

pinBtn?.addEventListener('click', () => {
  if (!currentKmlId) return;

  localStorage.setItem('pinnedKmlId', currentKmlId);
  showMessage('已釘選', '此 KML 將在下次開啟時自動載入');
});

/* =========================
   檔案選擇
========================= */

fileNameLabel?.addEventListener('click', () => {
  fileInput.click();
});

fileInput?.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;

  fileNameLabel.textContent = file.name;
  uploadBtn.disabled = false;
});

/* =========================
   上傳 KML（v1.9.6）
========================= */

uploadBtn?.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  uploadBtn.disabled = true;

  try {
    const text = await file.text();
    const xml = new DOMParser().parseFromString(text, "text/xml");
    const geojson = toGeoJSON.kml(xml);

    await KML_DB.upload({
      file,
      geojson,
      filename: file.name
    });

    showMessage('成功', 'KML 上傳完成');
    fileInput.value = '';
    fileNameLabel.textContent = '尚未選擇檔案';

    await refreshKmlList();
  } catch (err) {
    showMessage('上傳失敗', err.toString());
  } finally {
    uploadBtn.disabled = false;
  }
});

/* =========================
   刪除 KML（v1.9.6）
========================= */

deleteBtn?.addEventListener('click', () => {
  const id = kmlSelectDashboard.value;
  if (!id) return;

  showConfirmation(
    '確認刪除',
    '確定要刪除此 KML 圖層嗎？',
    async () => {
      await KML_DB.remove(id);
      showMessage('完成', 'KML 已刪除');
      currentKmlId = null;
      MAP.clear();
      refreshKmlList();
    }
  );
});

/* =========================
   Confirmation Modal（共用）
========================= */

function showConfirmation(title, message, onConfirm) {
  const overlay = document.getElementById('confirmationModalOverlay');
  const titleEl = document.getElementById('confirmationModalTitle');
  const msgEl = document.getElementById('confirmationModalMessage');
  const yesBtn = document.getElementById('confirmYesBtn');
  const noBtn = document.getElementById('confirmNoBtn');

  titleEl.textContent = title;
  msgEl.textContent = message;
  overlay.classList.add('visible');

  const cleanup = () => {
    overlay.classList.remove('visible');
    yesBtn.removeEventListener('click', yesHandler);
    noBtn.removeEventListener('click', noHandler);
  };

  const yesHandler = () => {
    cleanup();
    onConfirm();
  };

  const noHandler = () => cleanup();

  yesBtn.addEventListener('click', yesHandler);
  noBtn.addEventListener('click', noHandler);
}

