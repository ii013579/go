/**
 * survey-logic.js
 * 負責處理點位清查、拍照壓縮、Firestore 更新與數據打包下載
 */

const SurveyManager = {
    // --- 設定區 ---
    requiredPhotoCount: 3, // 預設需要 3 張，可由外部修改
    pointConditions: ['存在', '損壞', '遺失'],
    
    // --- 內部狀態 ---
    currentFeature: null,
    selectedCondition: null,
    capturedPhotos: [], // 存放 Blob 物件
    surveyorAccount: '',

    /**
     * 初始化清查表單
     * @param {Object} feature Leaflet feature 物件
     */
    init: function(feature) {
        this.currentFeature = feature;
        this.selectedCondition = null;
        this.capturedPhotos = new Array(this.requiredPhotoCount).fill(null);
        
        // 自動獲取當前登入帳號
        const user = firebase.auth().currentUser;
        this.surveyorAccount = user ? (user.email || user.displayName) : "Unknown_User";

        this.renderForm();
        this.bindEvents();
    },

    /**
     * 渲染捲動式表單介面
     */
    renderForm: function() {
        const modal = document.getElementById('surveyModalOverlay'); // 需在 index.html 增加此容器
        const name = this.currentFeature.properties.name || "未命名點位";
        
        let photoSlotsHtml = '';
        for (let i = 0; i < this.requiredPhotoCount; i++) {
            photoSlotsHtml += `
                <div class="photo-slot" id="slot-${i}" onclick="document.getElementById('file-${i}').click()">
                    <div class="slot-placeholder">
                        <span class="material-symbols-outlined">photo_camera</span>
                        <p>第 ${i+1} 張相片</p>
                    </div>
                    <input type="file" id="file-${i}" accept="image/*" capture="camera" style="display:none" onchange="SurveyManager.handleFileUpload(event, ${i})">
                </div>
            `;
        }

        modal.innerHTML = `
            <div class="survey-container">
                <div class="survey-header">
                    <h2>點位清查：${name}</h2>
                    <p class="surveyor-info">清查人員：${this.surveyorAccount}</p>
                </div>
                
                <div class="survey-body">
                    <section class="survey-section">
                        <label class="section-label">1. 點位現況 <span class="required">*</span></label>
                        <div class="condition-picker">
                            ${this.pointConditions.map(c => `<button class="cond-btn" data-value="${c}">${c}</button>`).join('')}
                        </div>
                    </section>

                    <section class="survey-section">
                        <label class="section-label">2. 現場說明與備註</label>
                        <textarea id="sv_description" placeholder="輸入現場描述..."></textarea>
                        <textarea id="sv_remarks" placeholder="輸入其他備註..."></textarea>
                    </section>

                    <section class="survey-section">
                        <label class="section-label">3. 現場拍照 (必拍 ${this.requiredPhotoCount} 張) <span class="required">*</span></label>
                        <div class="photo-grid">
                            ${photoSlotsHtml}
                        </div>
                    </section>
                </div>

                <div class="survey-footer">
                    <button id="survey-cancel-btn">取消</button>
                    <button id="survey-submit-btn" disabled>請完成必填項目</button>
                </div>
            </div>
        `;
        modal.classList.add('visible');
    },

    /**
     * 處理圖片上傳與壓縮 (1024x768)
     */
    handleFileUpload: function(event, index) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 1024;
                const MAX_HEIGHT = 768;
                canvas.width = MAX_WIDTH;
                canvas.height = MAX_HEIGHT;

                const ctx = canvas.getContext('2d');
                // 強制拉伸或縮放到 1024x768
                ctx.drawImage(img, 0, 0, MAX_WIDTH, MAX_HEIGHT);

                canvas.toBlob((blob) => {
                    this.capturedPhotos[index] = blob;
                    // 更新預覽圖
                    const slot = document.getElementById(`slot-${index}`);
                    slot.innerHTML = `<img src="${URL.createObjectURL(blob)}" class="preview-img">`;
                    this.validateForm();
                }, 'image/jpeg', 0.85);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    },

    /**
     * 表單驗證：決定提交按鈕是否可用
     */
    validateForm: function() {
        const submitBtn = document.getElementById('survey-submit-btn');
        const photoReady = this.capturedPhotos.every(p => p !== null);
        const conditionReady = this.selectedCondition !== null;

        if (photoReady && conditionReady) {
            submitBtn.disabled = false;
            submitBtn.classList.add('ready');
            submitBtn.innerText = "確認上傳提交";
        } else {
            submitBtn.disabled = true;
            submitBtn.classList.remove('ready');
            submitBtn.innerText = "資料未齊全";
        }
    },

    /**
     * 綁定事件監聽
     */
    bindEvents: function() {
        // 取消按鈕
        document.getElementById('survey-cancel-btn').onclick = () => {
            if (confirm("確定要取消清查嗎？已拍的照片將消失。")) {
                document.getElementById('surveyModalOverlay').classList.remove('visible');
            }
        };

        // 現況按鈕點擊
        const condBtns = document.querySelectorAll('.cond-btn');
        condBtns.forEach(btn => {
            btn.onclick = (e) => {
                condBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.selectedCondition = e.target.getAttribute('data-value');
                this.validateForm();
            };
        });

        // 提交按鈕
        document.getElementById('survey-submit-btn').onclick = () => this.submitData();
    },

    /**
     * 執行數據上傳至 Firebase
     */
    submitData: async function() {
        const submitBtn = document.getElementById('survey-submit-btn');
        submitBtn.disabled = true;
        submitBtn.innerText = "正在上傳照片...";

        try {
            const photoUrls = [];
            const timestamp = new Date().getTime();
            const pointName = this.currentFeature.properties.name;

            // 1. 上傳照片到 Storage
            for (let i = 0; i < this.capturedPhotos.length; i++) {
                const storageRef = firebase.storage().ref(`surveys/${pointName}/${timestamp}_${i}.jpg`);
                await storageRef.put(this.capturedPhotos[i]);
                const url = await storageRef.getDownloadURL();
                photoUrls.push(url);
            }

            // 2. 更新 Firestore (假設數據在 kmlLayers 下)
            const kmlId = window.currentKmlLayerId;
            const docRef = db.collection('artifacts').doc(appId)
                            .collection('public').doc('data')
                            .collection('kmlLayers').doc(kmlId);

            // 這裡需要讀取舊的 GeoJSON 並更新該點位的 properties
            const doc = await docRef.get();
            const data = doc.data();
            let geojson = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson;

            const featureIndex = geojson.features.findIndex(f => f.properties.name === pointName);
            if (featureIndex > -1) {
                geojson.features[featureIndex].properties = {
                    ...geojson.features[featureIndex].properties,
                    status: 'completed',
                    surveyor_id: this.surveyorAccount,
                    point_condition: this.selectedCondition,
                    survey_description: document.getElementById('sv_description').value,
                    remarks: document.getElementById('sv_remarks').value,
                    photos: photoUrls,
                    survey_date: new Date().toISOString()
                };
            }

            await docRef.update({ geojson: JSON.stringify(geojson) });

            alert("提交成功！");
            document.getElementById('surveyModalOverlay').classList.remove('visible');
            
            // 重新載入圖層或更新本地地圖圖示
            if (window.loadKmlFeatures) window.loadKmlFeatures(kmlId);

        } catch (error) {
            console.error("提交失敗:", error);
            alert("提交過程中發生錯誤。");
            submitBtn.disabled = false;
        }
    },

    /**
     * 下載 ZIP 包 (包含 CSV 與照片)
     */
    downloadZip: async function(kmlFeatures) {
        const zip = new JSZip();
        let csvContent = "\ufeff點位名稱,現況,清查人,時間,說明,備註,照片連結\n";

        for (const f of kmlFeatures) {
            const p = f.properties;
            if (p.status === 'completed') {
                const row = `"${p.name}","${p.point_condition}","${p.surveyor_id}","${p.survey_date}","${p.survey_description}","${p.remarks}","${p.photos.join(';')}"\n`;
                csvContent += row;
                
                // 下載照片並放入 ZIP
                for (let i = 0; i < p.photos.length; i++) {
                    const imgData = await fetch(p.photos[i]).then(res => res.blob());
                    zip.file(`${p.name}_${i+1}.jpg`, imgData);
                }
            }
        }

        zip.file("清查結果總表.csv", csvContent);
        const content = await zip.generateAsync({type:"blob"});
        saveAs(content, "清查成果打包.zip");
    }
};