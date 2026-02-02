/*************************************************                     
 * auth.js                                                             
 * 使用者 / 角色管理（users 只讀一次）                                 
 * v1.9.6 相容                                                         
 *************************************************/                    
                                                                       
// ===== 全域 Auth 狀態（唯一真實來源）=====                           
window.authState = {                                                   
    uid: null,                                                         
    email: null,                                                       
    role: 'guest',   // guest | user | editor | owner | unapproved     
    loaded: false                                                      
};                                                                     
                                                                       
const auth = window.firebaseAuth;                                      
const db = window.firebaseDB;                                          
                                                                       
// ===== Auth 狀態監聽（只此一處）=====                                
auth.onAuthStateChanged(async (user) => {                              
                                                                       
    // ===== Guest =====                                               
    if (!user) {                                                       
        authState.uid = null;                                          
        authState.email = null;                                        
        authState.role = 'guest';                                      
        authState.loaded = true;                                       
                                                                       
        console.log('[auth] guest');                                   
        notifyAuthReady();                                             
        return;                                                        
    }                                                                  
                                                                       
    // ===== 已載入過，避免重複讀取 =====                              
    if (authState.loaded && authState.uid === user.uid) {              
        console.log('[auth] user already loaded:', authState.role);    
        notifyAuthReady();                                             
        return;                                                        
    }                                                                  
                                                                       
    // ===== 讀取 users 文件（只一次）=====                            
    try {                                                              
        const snap = await db.collection('users').doc(user.uid).get(); 
                                                                       
        let role = 'unapproved';                                       
        if (snap.exists && snap.data()?.role) {                        
            role = snap.data().role;                                   
        }                                                              
                                                                       
        authState.uid = user.uid;                                      
        authState.email = user.email;                                  
        authState.role = role;                                         
        authState.loaded = true;                                       
                                                                       
        console.log('[auth] loaded user role:', role);                 
        notifyAuthReady();                                             
                                                                       
    } catch (err) {                                                    
        console.error('[auth] failed to load user profile', err);      
                                                                       
        // 保底：當成 guest，避免整站壞掉                              
        authState.uid = null;                                          
        authState.email = null;                                        
        authState.role = 'guest';                                      
        authState.loaded = true;                                       
                                                                       
        notifyAuthReady();                                             
    }                                                                  
});                                                                    
                                                                       
// ===== Auth Ready 事件（給其他模組掛）=====                          
function notifyAuthReady() {                                           
    document.dispatchEvent(                                            
        new CustomEvent('auth-ready', { detail: { ...authState } })    
    );                                                                 
}                                                                      
                                                                       
// ===== 權限判斷（不讀 Firestore）=====                               
window.isOwner = function () {                                         
    return authState.role === 'owner';                                 
};                                                                     
                                                                       
window.isEditor = function () {                                        
    return authState.role === 'editor';                                
};                                                                     
                                                                       
window.isEditorOrOwner = function () {                                 
    return authState.role === 'editor' || authState.role === 'owner';  
};                                                                     
                                                                       
window.isLoggedInUser = function () {                                  
    return authState.role !== 'guest';                                 
};                                                                     
                                                                       
// ===== KML 相關權限（v1.9.6 相容）=====                              
window.canUploadKml = function () {                                    
    return isEditorOrOwner();                                          
};                                                                     
                                                                       
window.canDeleteKml = function (uploadedByEmail) {                     
    if (isOwner()) return true;                                        
    if (isEditor() && uploadedByEmail === authState.email) return true;
    return false;                                                      
};                                                                     
                                                                       
// ===== 舊程式可能會用到的 Getter =====                               
window.getCurrentUserRole = function () {                              
    return authState.role;                                             
};                                                                     
                                                                       
window.getCurrentUserEmail = function () {                             
    return authState.email;                                            
};                                                                     
                                                                       
window.getCurrentUserUid = function () {                               
    return authState.uid;                                              
};                                                                     