// ui.js (v2.0, Firebase v9+)

import { AUTH } from "./auth.js";
import { KML_DB } from "./kml-db.js";
import { db } from "./firebase-init.js";

import {
  collection,
  getDocs,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* =========================
   DOM 快捷
========================= */

const $ = id => document.getElementById(id);

/* =========================
   DOM 元件
========================= */

const editBtn = $('editButton');
const searchBox = $('searchBox');
const searchResults = $('searchResults');

const registrationSection = $('registrationSettingsSection');
const userMgmtSection = $('userManagementSection');
const refreshUsersBtn = $('refreshUsersBtn');
const userList = $('userList');

/* =========================
   編輯模式（v1.9.6）
========================= */

(function () {
  let editMode = false;

  const btn = document.getElementById('editButton');
  if (!btn) return;

  btn.addEventListener('click', () => {
    editMode = !editMode;

    btn.classList.toggle('active', editMode);
    document.body.classList.toggle('edit-mode', editMode);

    document.dispatchEvent(
      new CustomEvent('edit:toggle', { detail: editMode })
    );
  });
})();

/* =========================
   搜尋（v1.9.6）
========================= */

let searchCache = [];

async function buildSearchIndex() {
  const list = await KML_DB.list();
  searchCache = [];

  for (const item of list) {
    const features = await KML_DB.getGeoJSON(item.id);
    features.forEach(f => {
      const name = f.properties?.name;
      if (name) {
        searchCache.push({
          name,
          feature: f
        });
      }
    });
  }
}

searchBox?.addEventListener('focus', buildSearchIndex);

searchBox?.addEventListener('input', () => {
  const q = searchBox.value.trim().toLowerCase();
  searchResults.innerHTML = '';
  if (!q) return;

  searchCache
    .filter(i => i.name.toLowerCase().includes(q))
    .slice(0, 20)
    .forEach(item => {
      const div = document.createElement('div');
      div.textContent = item.name;
      div.addEventListener('click', () => {
        MAP.render([item.feature]);
        searchResults.innerHTML = '';
        searchBox.value = item.name;
      });
      searchResults.appendChild(div);
    });
});

/* =========================
   Auth / Role UI 切換
========================= */

document.addEventListener('auth:changed', e => {
  const user = e.detail;
  document.getElementById('loginForm').style.display = user ? 'none' : '';
  document.getElementById('loggedInDashboard').style.display = user ? '' : 'none';
});

document.addEventListener('auth:role', e => {
  const role = e.detail;
  document.getElementById('registrationSettingsSection').style.display =
    role === 'owner' ? '' : 'none';
  document.getElementById('userManagementSection').style.display =
    role === 'owner' ? '' : 'none';

  if (role === 'unapproved') {
    document.dispatchEvent(
      new Event('auth:requireRegistration')
    );
  }
});

/* =========================
   使用者管理（v1.9.6）
========================= */

refreshUsersBtn?.addEventListener('click', loadUsers);

async function loadUsers() {
  userList.querySelectorAll('.user-row').forEach(e => e.remove());

  const snap = await getDocs(collection(db, 'users'));

  snap.forEach(docSnap => {
    const u = docSnap.data();
    const row = document.createElement('div');
    row.className = 'user-row';

    row.innerHTML = `
      <div>${u.email || ''}</div>
      <div>${u.nickname || ''}</div>
      <div>${u.role || ''}</div>
      <div>
        <button data-role="editor">Editor</button>
        <button data-role="viewer">Viewer</button>
      </div>
    `;

    row.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async () => {
        await updateDoc(doc(db, 'users', docSnap.id), {
          role: btn.dataset.role
        });
        loadUsers();
      });
    });

    userList.appendChild(row);
  });
}
