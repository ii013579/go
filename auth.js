// auth.js (v2.0, Firebase v9+)

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import { auth, db } from "./firebase-init.js";

/* =========================
   全域狀態（v1.9.6 對齊）
========================= */

export const AUTH = {
  user: null,
  role: null,
  nickname: null
};

/* =========================
   DOM
========================= */

const loginBtn = document.getElementById('googleSignInBtn');
const logoutBtn = document.getElementById('logoutBtn');
const loginForm = document.getElementById('loginForm');
const dashboard = document.getElementById('loggedInDashboard');
const emailDisplay = document.getElementById('userEmailDisplay');

const generateCodeBtn = document.getElementById('generateRegistrationCodeBtn');
const registrationDisplay = document.getElementById('registrationCodeDisplay');
const registrationCountdown = document.getElementById('registrationCodeCountdown');

/* =========================
   Google 登入 / 登出
========================= */

loginBtn?.addEventListener('click', async () => {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (err) {
    showMessage('登入失敗', err.message);
  }
});

logoutBtn?.addEventListener('click', async () => {
  await signOut(auth);
});

/* =========================
   Auth 狀態監聽（核心）
========================= */

onAuthStateChanged(auth, async user => {
  AUTH.user = user;

  if (!user) {
    AUTH.role = null;
    AUTH.nickname = null;

    loginForm.style.display = '';
    dashboard.style.display = 'none';
    return;
  }

  loginForm.style.display = 'none';
  dashboard.style.display = '';
  emailDisplay.textContent = user.email;

  const userRef = doc(db, 'users', user.uid);

  onSnapshot(userRef, snap => {
    const data = snap.data() || {};
    AUTH.role = data.role || 'unapproved';
    AUTH.nickname = data.nickname || '';

    document.dispatchEvent(
      new CustomEvent('auth:role', { detail: AUTH.role })
    );
  });

  document.dispatchEvent(
    new CustomEvent('auth:changed', { detail: user })
  );
});

/* =========================
   Owner：產生一次性註冊碼
========================= */

generateCodeBtn?.addEventListener('click', async () => {
  if (AUTH.role !== 'owner') {
    showMessage('權限不足', '只有管理員可以產生註冊碼');
    return;
  }

  const code =
    Math.random().toString(36).substring(2, 6).toUpperCase() +
    Math.random().toString(36).substring(2, 6).toUpperCase();

  const expireAt = Date.now() + 60 * 1000;

  await setDoc(
    doc(db, 'settings', 'registration'),
    {
      oneTimeCode: code,
      oneTimeCodeExpiry: expireAt
    },
    { merge: true }
  );

  registrationDisplay.textContent = code;
  registrationDisplay.style.display = 'inline';
  registrationCountdown.style.display = 'inline';

  let remain = 60;
  const timer = setInterval(() => {
    registrationCountdown.textContent = `剩餘 ${remain--} 秒`;
    if (remain < 0) {
      clearInterval(timer);
      registrationCountdown.textContent = '已過期';
    }
  }, 1000);
});

/* =========================
   使用者：註冊碼驗證（v1.9.6 行為）
========================= */

export async function verifyRegistrationCode({ code, nickname }) {
  const user = AUTH.user;
  if (!user) return;

  const regRef = doc(db, 'settings', 'registration');
  const userRef = doc(db, 'users', user.uid);

  try {
    await runTransaction(db, async tx => {
      const regSnap = await tx.get(regRef);
      if (!regSnap.exists()) throw '註冊碼不存在';

      const data = regSnap.data();
      if (data.oneTimeCode !== code) throw '註冊碼錯誤';
      if (Date.now() > data.oneTimeCodeExpiry) throw '註冊碼已過期';

      // consume（一次性）
      tx.update(regRef, {
        oneTimeCode: '',
        oneTimeCodeExpiry: 0
      });

      tx.set(
        userRef,
        {
          role: 'editor',
          nickname,
          approvedAt: serverTimestamp()
        },
        { merge: true }
      );
    });

    showMessage('成功', '註冊完成，權限已開通');
  } catch (err) {
    showMessage('驗證失敗', err.toString());
  }
};

/* =========================
   觸發註冊碼 Modal（v1.9.6 對齊）
========================= */

document.addEventListener('auth:requireRegistration', () => {
  showRegistrationCodeModal(result => {
    if (!result) return;
    verifyRegistrationCode(result);
  });
});

