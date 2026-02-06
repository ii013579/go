// ui.js
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const els = {
    kmlSelect: $('kmlLayerSelect'),
    kmlSelectDashboard: $('kmlLayerSelectDashboard'),
    uploadBtn: $('uploadKmlSubmitBtnDashboard'),
    deleteBtn: $('deleteSelectedKmlBtn'),
    fileInput: $('hiddenKmlFileInput'),
    fileName: $('selectedKmlFileNameDashboard'),
    codeInput: $('registrationCodeInput'),
    verifyBtn: $('verifyRegistrationCodeBtn'),
    genCodeBtn: $('generateRegistrationCodeBtn'),
    status: $('registrationCodeStatus'),
    countdown: $('registrationCodeCountdown')
  };

  let countdownTimer = null;
  
  window.UI = {
    updateKmlSelect(list = []) {
      if (!els.kmlSelect) return;

      els.kmlSelect.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
      if (els.kmlSelectDashboard) {
        els.kmlSelectDashboard.innerHTML = '<option value="">-- 請選擇 KML 圖層 --</option>';
      }

      list.forEach(k => {
        els.kmlSelect.appendChild(new Option(k.name, k.id));
        els.kmlSelectDashboard?.appendChild(new Option(k.name, k.id));
      });
    }
  };

  // KML 選擇
  els.kmlSelect?.addEventListener('change', e => {
    document.dispatchEvent(
      new CustomEvent('kml:select', { detail: e.target.value })
    );
  });

  // 上傳檔案
  els.uploadBtn?.addEventListener('click', () => {
    const file = els.fileInput?.files?.[0];
    document.dispatchEvent(
      new CustomEvent('kml:upload', { detail: file })
    );
  });

  // 刪除 KML
  els.deleteBtn?.addEventListener('click', () => {
    const id = els.kmlSelectDashboard?.value;
    document.dispatchEvent(
      new CustomEvent('kml:delete', { detail: id })
    );
  });

  // 產生註冊碼
  els.genCodeBtn?.addEventListener('click', () => {
    document.dispatchEvent(new Event('auth:generateCode'));
  });
  
   /* ========================
     UX 工具
  ======================== */

  function setStatus(msg, type = 'info') {
    if (!els.status) return;
    els.status.textContent = msg;
    els.status.className = `status ${type}`;
  }

  function disableVerify(disabled) {
    if (els.verifyBtn) els.verifyBtn.disabled = disabled;
    if (els.codeInput) els.codeInput.disabled = disabled;
  }

  function startCountdown(expireAt) {
    clearInterval(countdownTimer);

    function tick() {
      const diff = Math.max(0, expireAt - Date.now());
      const sec = Math.ceil(diff / 1000);

      if (els.countdown) {
        els.countdown.textContent = sec > 0
          ? `剩餘 ${sec} 秒`
          : '已過期';
      }

      if (sec <= 0) {
        clearInterval(countdownTimer);
        disableVerify(true);
        setStatus('註冊碼已過期', 'error');
      }
    }

    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  /* ========================
     使用者操作
  ======================== */

  els.verifyBtn?.addEventListener('click', () => {
    const code = els.codeInput?.value?.trim();
    if (!code) {
      setStatus('請輸入註冊碼', 'error');
      return;
    }

    disableVerify(true);
    setStatus('驗證中…');

    document.dispatchEvent(
      new CustomEvent('auth:verifyCode', { detail: code })
    );
  });

  els.genCodeBtn?.addEventListener('click', () => {
    document.dispatchEvent(new Event('auth:generateCode'));
  });

  /* ========================
     Auth 事件回饋
  ======================== */

  document.addEventListener('auth:codeGenerated', e => {
    const { code, expireAt } = e.detail;
    setStatus(`註冊碼：${code}`, 'success');
    disableVerify(false);
    startCountdown(expireAt);
  });

  document.addEventListener('auth:verifySuccess', () => {
    setStatus('註冊成功，權限已開通', 'success');
    disableVerify(true);
    clearInterval(countdownTimer);
  });

  document.addEventListener('auth:verifyFail', e => {
    setStatus(e.detail, 'error');
    disableVerify(false);
  });

})();
