// Optional cloud transport. No remote imports or authentication before user action.
let client,ready,autoUid=null,timer=null,busy=false,lastChecksum='',pendingBackup=false;
let connecting=false,offUser;
const $=s=>document.querySelector(s),note=m=>{$('#cloud-status').textContent=m;$('#web-account-state').textContent=m;};
async function connect(mode='login'){
  if(location.hostname==='appassets.androidplatform.net')throw Error('현재 Android 패키지는 오프라인 모드입니다. 웹에서 공통 계정과 백업을 사용할 수 있습니다.');
  if(connecting)return;
  const popup=window.open('about:blank','_blank','popup,width=520,height=760');if(!popup)throw Error('로그인 팝업을 허용해 주세요.');
  connecting=true;$('#web-login').disabled=$('#web-signup').disabled=true;note('로그인 화면을 열고 있습니다.');
  try{ready ||= import('https://softm.github.io/shared/platform/v1/sdk.mjs');
  const sdk=await ready;client ||= await sdk.createSiteClient({siteId:'wirohaeyo'});
  await client.login({popup,mode});
  offUser ||= client.onUser(user=>{$('#web-login').hidden=$('#web-signup').hidden=!!user;$('#web-logout').hidden=!user;if(autoUid&&autoUid!==user?.uid)disableAuto();$('#cloud-account').textContent=user?'공통 계정에 연결됨':'공통 계정에 로그인해 주세요.';});
  note('로그인했습니다. 백업·복원은 내 보관소에서 별도로 이용하세요.');document.querySelector('#web-account-state').textContent='로그인됨';}catch(error){popup.close();throw error;}finally{connecting=false;$('#web-login').disabled=$('#web-signup').disabled=false;}
}
function requireClient(){if(!client?.currentUser)throw Error('먼저 공통 계정을 연결해 주세요.');return client;}
async function backup(){
  const c=requireClient(),uid=c.currentUser.uid;if(busy){pendingBackup=true;return;}busy=true;
  try{const text=await window.WiroCloudBridge.exportEncrypted();if(!text)throw Error('백업할 보관함이 없습니다.');if(c.currentUser?.uid!==uid)throw Error('계정이 바뀌었습니다. 다시 시도해 주세요.');
    const {sha256}=await import('https://softm.github.io/shared/platform/v1/crypto.mjs');const content=JSON.parse(text);delete content.exportedAt;const digest=await sha256(JSON.stringify(content));
    if(lastChecksum===uid+digest){note('변경된 기록이 없어 기존 백업을 유지합니다.');return;}
    note('암호화된 기억을 백업하고 있어요.');await c.uploadEncryptedBackup(text,{format:'wirohaeyo-encrypted-backup'});lastChecksum=uid+digest;note('암호화 백업을 완료했습니다. 복원에는 보관함 암호가 필요합니다.');await renderBackups();
  }finally{busy=false;if(pendingBackup&&autoUid===client?.currentUser?.uid){pendingBackup=false;clearTimeout(timer);timer=setTimeout(guard(backup),15000);}}
}
function disableAuto(){autoUid=null;clearTimeout(timer);$('#cloud-auto').checked=false;}
async function renderBackups(){const c=requireClient(),list=$('#cloud-backups');list.replaceChildren();for(const b of await c.listBackups()){
  const row=document.createElement('div'),label=document.createElement('span');label.textContent=(b.createdAt?.toDate?.().toLocaleString('ko-KR')||'저장 시간 확인 중')+(b.state==='complete'?' · 백업 완료':' · 업로드 미완료');row.append(label);
  const restore=document.createElement('button');restore.type='button';restore.className='outline-btn';restore.textContent='검증 후 복원';restore.disabled=b.state!=='complete';restore.addEventListener('click',guard(async()=>{const text=await c.downloadBackup(b.id);disableAuto();await window.WiroCloudBridge.restoreEncrypted(text);}));row.append(restore);
  const del=document.createElement('button');del.type='button';del.className='outline-btn';del.textContent='백업 삭제';del.addEventListener('click',guard(async()=>{if(!await window.WiroCloudBridge.confirm('클라우드 백업 삭제','선택한 원격 백업을 삭제합니다. 이 기기의 기록은 유지됩니다.','백업 삭제'))return;await c.deleteBackup(b.id);lastChecksum='';await renderBackups();note('선택한 클라우드 백업을 삭제했습니다.');}));row.append(del);list.append(row);
}}
function guard(fn){return async()=>{try{await fn();}catch(e){note(e.message||'클라우드 연결을 완료하지 못했습니다. 기기 내 기록은 유지됩니다.');}};}
$('#cloud-connect').addEventListener('click',guard(()=>connect()));
$('#web-login').addEventListener('click',guard(()=>connect('login')));$('#web-signup').addEventListener('click',guard(()=>connect('signup')));$('#web-vault').addEventListener('click',()=>{const settings=document.querySelector('[data-view="settings"]');if(document.querySelector('#app').classList.contains('hidden')){document.querySelector('#web-account-state').textContent='기기 보관함을 연 뒤 내 공간 관리에서 백업·복원할 수 있습니다.';return;}settings.click();document.querySelector('#cloud-account').scrollIntoView({behavior:'smooth'});});$('#cloud-backup-now').addEventListener('click',guard(backup));$('#cloud-list').addEventListener('click',guard(renderBackups));
$('#cloud-disconnect').addEventListener('click',guard(async()=>{disableAuto();lastChecksum='';await client?.logout();$('#cloud-backups').replaceChildren();note('공통 계정 연결과 자동 백업을 껐습니다.');document.querySelector('#web-account-state').textContent='로그아웃됨';}));
$('#cloud-auto').addEventListener('change',()=>{if(!$('#cloud-auto').checked){disableAuto();note('자동 백업을 껐습니다.');return;}if(!client?.currentUser){disableAuto();note('먼저 공통 계정을 연결해 주세요.');return;}autoUid=client.currentUser.uid;note('이 창에서 기록 변경 후 자동 백업합니다. 앱이 종료된 동안에는 실행되지 않습니다.');guard(backup)();});
window.addEventListener('wiro:vault-change',()=>{clearTimeout(timer);if(autoUid&&autoUid===client?.currentUser?.uid)timer=setTimeout(guard(backup),15000);});
window.addEventListener('wiro:vault-reset',()=>{disableAuto();lastChecksum='';});
window.addEventListener('pagehide',()=>clearTimeout(timer));


$('#web-logout').addEventListener('click',guard(async()=>{disableAuto();await client?.logout();note('로그아웃했습니다. 기기 보관함은 별도로 잠글 수 있습니다.');}));
