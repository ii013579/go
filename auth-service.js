// auth-service.js v2.0 (身份與權限模組)
(function () {
    'use strict';
    const $ = id => document.getElementById(id);

    const els = {
        loginForm: $('loginForm'),
        userEmail: $('userEmailDisplay'),
        adminSec: $('userManagementSection'),
        regSec: $('registrationSettingsSection'),
        regDisplay: $('registrationCodeDisplay'),
        regTimer: $('registrationCodeCountdown')
    };

    window.currentUserRole = null;
    let timer = null;

    const getRoleName = role => {
        const roles = { 'unapproved': '未審核', 'user': '一般', 'editor': '編輯者', 'owner': '擁有者' };
        return roles[role] || role || '';
    };

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            if (els.userEmail) els.userEmail.textContent = user.email;
            // 角色判定邏輯... (此處對接您的 Firestore 角色檢查)
            window.currentUserRole = 'admin'; 
            if (els.adminSec) els.adminSec.style.display = 'block';
        } else {
            if (els.adminSec) els.adminSec.style.display = 'none';
        }
    });

    window.AuthService = {
        startRegTimer: (seconds) => {
            clearInterval(timer);
            let left = seconds;
            timer = setInterval(() => {
                if (left <= 0) clearInterval(timer);
                if (els.regTimer) els.regTimer.textContent = left--;
            }, 1000);
        }
    };
})();