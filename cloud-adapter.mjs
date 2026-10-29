// Shared identity UI plus the existing, optional encrypted Wiro transport.
// Restoring an auth session never opens, reads or uploads the local vault.
let client,account,accountUi,autoUid=null,timer=null,busy=false,lastChecksum='',pendingBackup=false;
const $=s=>document.querySelector(s);
const note=message=>{for(const id of ['#cloud-status','#web-account-state']){const el=$(id);if(el)el.textContent=message;}};
const nativeOffline=location.hostname==='appassets.androidplatform.net'||location.protocol==='file:';

async function initializeAccount(){
  if(nativeOffline){note('오프라인 앱 · 공통 계정과 클라우드 백업은 웹에서 사용할 수 있습니다.');return;}
  try{
    const {createAccountContext,mountSiteAccount}=await import('https://softm.github.io/shared/platform/v1/site-account.mjs?v=20261030-menu-1');
    account=createAccountContext({siteId:'wirohaeyo',sdkLoader:async()=>{
      const sdk=await import('https://softm.github.io/shared/platform/v1/sdk.mjs?v=20261030-menu-1');
      return {createSiteClient:async options=>(client=await sdk.createSiteClient(options))};
    }});
    account.subscribe(user=>{
      if(autoUid&&autoUid!==user?.uid)disableAuto();
      if(!user){lastChecksum='';$('#cloud-backups')?.replaceChildren();}
      $('#cloud-account').textContent=user?(user.displayName||'내 계정')+' · 공통 계정에 로그인됨':'공통 계정에 로그인해 주세요.';
    });
    accountUi=mountSiteAccount({siteId:'wirohaeyo',name:'위로해요',accountTarget:'.web-account',account,vault:{open:openVault}});
    // Retain legacy DOM IDs during the cache transition, but never expose
    // duplicate login, signup or vault controls beside the shared icon.
    document.querySelectorAll('.web-account > button,.web-account > a').forEach(el=>{el.hidden=true;el.style.display='none';});
    window.SoftmAccounts ||= new Map();window.SoftmAccounts.set('wirohaeyo',account);
    window.dispatchEvent(new CustomEvent('softm:account-ready',{detail:{siteId:'wirohaeyo',account}}));
  }catch{
    note('계정 메뉴를 준비하지 못했습니다. 기기 내 기능은 그대로 사용할 수 있습니다.');
  }
}
function requireClient(){if(!client?.currentUser)throw Error('먼저 상단 계정 아이콘에서 로그인해 주세요.');return client;}
function openVault(){
  if($('#app').classList.contains('hidden')){note('기기 보관함을 연 뒤 내 공간 관리에서 백업·복원할 수 있습니다.');return;}
  document.querySelector('[data-view="settings"]').click();
  $('#cloud-account').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}
async function backup(){
  const c=requireClient(),uid=c.currentUser.uid;if(busy){pendingBackup=true;return;}busy=true;
  try{
    const text=await window.WiroCloudBridge.exportEncrypted();if(!text)throw Error('백업할 보관함이 없습니다.');
    if(c.currentUser?.uid!==uid)throw Error('계정이 바뀌었습니다. 다시 시도해 주세요.');
    const {sha256}=await import('https://softm.github.io/shared/platform/v1/crypto.mjs');
    const content=JSON.parse(text);delete content.exportedAt;const digest=await sha256(JSON.stringify(content));
    if(lastChecksum===uid+digest){note('변경된 기록이 없어 기존 백업을 유지합니다.');return;}
    if(c.currentUser?.uid!==uid)throw Error('계정이 바뀌었습니다. 다시 시도해 주세요.');
    note('암호화된 기억을 백업하고 있어요.');await c.uploadEncryptedBackup(text,{format:'wirohaeyo-encrypted-backup'});
    if(c.currentUser?.uid!==uid)return;
    lastChecksum=uid+digest;note('암호화 백업을 완료했습니다. 복원에는 보관함 암호가 필요합니다.');await renderBackups();
  }finally{busy=false;if(pendingBackup&&autoUid===client?.currentUser?.uid){pendingBackup=false;clearTimeout(timer);timer=setTimeout(guard(backup),15000);}}
}
function disableAuto(){autoUid=null;pendingBackup=false;clearTimeout(timer);$('#cloud-auto').checked=false;}
async function renderBackups(){
  const c=requireClient(),uid=c.currentUser.uid,list=$('#cloud-backups');list.replaceChildren();
  const backups=await c.listBackups();if(c.currentUser?.uid!==uid)return;
  for(const b of backups){
    const row=document.createElement('div'),label=document.createElement('span');
    label.textContent=(b.createdAt?.toDate?.().toLocaleString('ko-KR')||'저장 시간 확인 중')+(b.state==='complete'?' · 백업 완료':' · 업로드 미완료');row.append(label);
    const restore=document.createElement('button');restore.type='button';restore.className='outline-btn';restore.textContent='검증 후 복원';restore.disabled=b.state!=='complete';
    restore.addEventListener('click',guard(async()=>{
      if(c.currentUser?.uid!==uid)throw Error('계정이 바뀌었습니다. 백업 목록을 다시 열어 주세요.');
      const text=await c.downloadBackup(b.id);if(c.currentUser?.uid!==uid)throw Error('계정이 바뀌어 복원을 중단했습니다.');
      disableAuto();await window.WiroCloudBridge.restoreEncrypted(text);
    }));row.append(restore);
    const del=document.createElement('button');del.type='button';del.className='outline-btn';del.textContent='백업 삭제';
    del.addEventListener('click',guard(async()=>{
      if(!await window.WiroCloudBridge.confirm('클라우드 백업 삭제','선택한 원격 백업을 삭제합니다. 이 기기의 기록은 유지됩니다.','백업 삭제'))return;
      if(c.currentUser?.uid!==uid)throw Error('계정이 바뀌어 삭제를 중단했습니다.');
      await c.deleteBackup(b.id);lastChecksum='';await renderBackups();note('선택한 클라우드 백업을 삭제했습니다.');
    }));row.append(del);list.append(row);
  }
}
function guard(fn){return async()=>{try{await fn();}catch(e){note(e.message||'클라우드 연결을 완료하지 못했습니다. 기기 내 기록은 유지됩니다.');}};}
function openAccount(){if(accountUi)accountUi.open();else note(nativeOffline?'현재 Android 패키지는 오프라인 모드입니다. 웹에서 로그인해 주세요.':'계정 연결을 확인한 뒤 페이지를 다시 열어 주세요.');}
$('#cloud-connect').addEventListener('click',openAccount);
for(const id of ['#web-login','#web-signup'])$(id)?.addEventListener('click',openAccount);
$('#web-vault')?.addEventListener('click',openVault);
$('#cloud-backup-now').addEventListener('click',guard(backup));$('#cloud-list').addEventListener('click',guard(renderBackups));
const disconnect=guard(async()=>{disableAuto();lastChecksum='';if(account)await account.logout();$('#cloud-backups').replaceChildren();note('로그아웃했습니다. 기기 보관함은 별도로 잠글 수 있습니다.');});
$('#cloud-disconnect').addEventListener('click',disconnect);$('#web-logout')?.addEventListener('click',disconnect);
$('#cloud-auto').addEventListener('change',()=>{
  if(!$('#cloud-auto').checked){disableAuto();note('자동 백업을 껐습니다.');return;}
  if(!client?.currentUser){disableAuto();note('먼저 상단 계정 아이콘에서 로그인해 주세요.');return;}
  autoUid=client.currentUser.uid;note('이 창에서 기록 변경 후 자동 백업합니다. 앱이 종료된 동안에는 실행되지 않습니다.');guard(backup)();
});
window.addEventListener('wiro:vault-change',()=>{clearTimeout(timer);if(autoUid&&autoUid===client?.currentUser?.uid)timer=setTimeout(guard(backup),15000);});
window.addEventListener('wiro:vault-reset',()=>{disableAuto();lastChecksum='';});
window.addEventListener('pagehide',()=>clearTimeout(timer));
initializeAccount();
