// ui-components.js v2.0 (通用組件模組)
(function () {
    'use strict';
    const $ = id => document.getElementById(id);

    window.UIComponents = {
        els: {
            modal: $('confirmationModalOverlay'),
            title: $('confirmationModalTitle'),
            msg: $('confirmationModalMessage'),
            yesBtn: $('confirmYesBtn'),
            noBtn: $('confirmNoBtn')
        },

        showConfirmation: function(title, message, onConfirm) {
            if (!this.els.modal) return;
            this.els.title.textContent = title;
            this.els.msg.textContent = message;
            this.els.modal.classList.add('visible');

            const handleYes = () => {
                onConfirm();
                this.closeModal();
            };
            const handleNo = () => this.closeModal();

            this.els.yesBtn.onclick = handleYes;
            this.els.noBtn.onclick = handleNo;
        },

        closeModal: function() {
            this.els.modal.classList.remove('visible');
        }
    };

    // 為了相容舊版呼叫
    window.showMessageCustom = (cfg) => {
        alert(`${cfg.title}: ${cfg.message}`); // 建議之後統一改為漂亮的 Toast
    };
})();