/* 위로해요 · privacy-first and dependency-free encrypted local PWA. */
'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const TODAY = new Intl.DateTimeFormat('ko-KR', {year:'numeric',month:'long',day:'numeric',weekday:'long'});
const DATE = new Intl.DateTimeFormat('ko-KR', {year:'numeric',month:'short',day:'numeric'});
const DB_NAME = 'wirohaeyo-vault-v1';
const KDF_ITERATIONS = 310000;
const MAX_IMPORT_BYTES = 6 * 1024 * 1024;
const MAX_RECORD_TEXT = 60000;
const MAX_IMPORT_BATCH_BYTES = 32 * 1024 * 1024;
const BACKGROUND_LOCK_MS = 5 * 60 * 1000;
const THEME_STOPWORDS = new Set(['오늘','내가','나의','나는','너무','정말','그리고','하지만','그래서','이렇게','저렇게','어제','내일','우리','그냥','조금','다시','계속','있는','없는','했다','합니다','것을','것이','것은','대한','위로','기록','사진','메시지','내용','파일','사용자','shared','true','false','null']);
const KNOWN_TYPES = {moment:['오늘의 이야기','☼'],achievement:['내가 해낸 일','✦'],gratitude:['고마운 순간','♡'],letter:['나에게 보내는 말','✉'],checkin:['마음 기록','☁'],import:['가져온 기억','▤'],comfort:['간직한 위로','✧']};
const PHRASES = {
  gentle:[
    '오늘의 나에게 굳이 더 잘해야 한다고 말하지 않아도 괜찮아요.',
    '모든 날이 반짝일 필요는 없어요. 조용한 날에도 나는 소중해요.',
    '당신의 속도로 여기까지 왔어요. 그걸 잠시 알아봐 주고 싶어요.',
    '애써 괜찮은 척하지 않아도 돼요. 오늘의 마음도 환대받을 수 있어요.',
    '나를 향한 말 한마디가 조금 부드러워지는 하루였으면 해요.'
  ],
  recognition:[
    '아무도 보지 못했던 수고가 있었다면, 오늘은 내가 그것을 알아줄게요.',
    '당신은 지나온 시간을 살아냈어요. 그 사실은 작게 취급하지 않아도 돼요.',
    '결과로 설명하지 못하는 노력도 내 삶의 일부로 남아 있어요.',
    '버티는 힘이 언제나 보이는 건 아니지만, 기록은 그 시간을 잊지 않아요.',
    '당신이 스스로를 돌보려는 이 순간도 충분히 의미 있어요.'
  ],
  admire:[
    '당신의 삶은 남과 겨룰 필요 없이, 그 자체로 깊이 존중받을 이야기예요.',
    '눈에 보이지 않는 수고까지 내 역사로 남길게요. 당신을 높이 대할 이유예요.',
    '당신이 지나온 수많은 순간에 경의를 보내요. 오늘의 나 역시 그 일부예요.',
    '나를 추앙한다는 건 과장하는 일이 아니라, 내 존재를 함부로 줄이지 않는 일이에요.',
    '나를 아끼는 데 다른 사람의 허락은 필요하지 않아요.'
  ]
};
let db = null, key = null, records = [], tone = 'gentle', selectedMood = null, recordType = 'moment';
let comfortIndex = 0, lastComfort = null, pendingShareText = null, pendingShareImage = null, toastTimer = null, pendingNativeBackup = null;
let backgroundAt = null, backgroundLockTimer = null;

function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3500);}
function safeDate(date){try{return DATE.format(new Date(date));}catch{return ''}}
function dateKey(date = new Date()){return new Date(date).toLocaleDateString('sv-SE');}
function makeId(){return crypto.randomUUID();}
function toB64(bytes){const u8=new Uint8Array(bytes);let out='';for(let i=0;i<u8.length;i+=32766){out+=btoa(String.fromCharCode(...u8.slice(i,i+32766)));}return out;}
function fromB64(str){const bin=atob(str);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);return arr;}
function randomB64(size){return toB64(crypto.getRandomValues(new Uint8Array(size)));}
async function deriveKey(password,salt,iterations=KDF_ITERATIONS){const input=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:fromB64(salt),iterations,hash:'SHA-256'},input,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function encrypt(value,secret=key){const iv=crypto.getRandomValues(new Uint8Array(12));const data=new TextEncoder().encode(JSON.stringify(value));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},secret,data);return {iv:toB64(iv),ct:toB64(ct)};}
async function decrypt(blob,secret=key){const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(blob.iv)},secret,fromB64(blob.ct));return JSON.parse(new TextDecoder().decode(data));}
function transaction(store,mode,action){return new Promise((resolve,reject)=>{const tr=db.transaction(store,mode);let result;tr.oncomplete=()=>resolve(result);tr.onerror=()=>reject(tr.error);tr.onabort=()=>reject(tr.error);try{const req=action(tr.objectStore(store));if(req&&typeof req.onsuccess!=='undefined')req.onsuccess=()=>{result=req.result;};}catch(err){tr.abort();reject(err);}});}
function openDatabase(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('meta'))d.createObjectStore('meta');if(!d.objectStoreNames.contains('records'))d.createObjectStore('records',{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
const getMeta=()=>transaction('meta','readonly',s=>s.get('vault'));
const putMeta=obj=>transaction('meta','readwrite',s=>s.put(obj,'vault'));
async function fetchRecords(){const encrypted=await transaction('records','readonly',s=>s.getAll());const fresh=[];for(const item of encrypted){try{fresh.push(await decrypt(item.blob));}catch(error){console.warn('A record could not be decrypted; it was not removed.');}}records=fresh.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));const prefs=records.find(r=>r.type==='preference');tone=PHRASES[prefs?.tone]?prefs.tone:'gentle';}
async function saveRecord(entry,{refresh=true}={}){if(!key)throw Error('보관함이 잠겨 있습니다.');const val={id:entry.id||makeId(),createdAt:entry.createdAt||new Date().toISOString(),...entry};const blob=await encrypt(val);await transaction('records','readwrite',s=>s.put({id:val.id,blob}));const existing=records.findIndex(x=>x.id===val.id);if(existing>=0)records.splice(existing,1);records.unshift(val);records.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));if(refresh){renderHome();renderMemories();renderInsights();}return val;}
async function removeRecord(id){await transaction('records','readwrite',s=>s.delete(id));records=records.filter(r=>r.id!==id);await snapshotInsights();renderHome();renderMemories();renderInsights();}
async function saveTone(value){tone=value;let pref=records.find(x=>x.type==='preference');await saveRecord({...(pref||{}),type:'preference',tone}, {refresh:false});renderComfort();toast('위로의 말투를 바꾸었어요.');}
async function initialize(){if(!crypto?.subtle||!indexedDB){$('#splash').textContent='이 브라우저에서는 암호화 보관함을 열 수 없어요. 최신 브라우저의 HTTPS 주소에서 열어 주세요.';return;}try{db=await openDatabase();await showGate();if(location.protocol==='https:'&&location.host!=='appassets.androidplatform.net'&&'serviceWorker'in navigator){navigator.serviceWorker.register('./sw.js').catch(()=>{});}}catch(e){console.error(e);$('#splash').textContent='기기 저장소에 접근하지 못했어요. 브라우저의 저장소 설정을 확인해 주세요.';}}
async function showGate(){
  // Remove decrypted text/images from the DOM as well as the in-memory working set.
  key=null;records=[];lastComfort=null;tone='gentle';selectedMood=null;
  for(const selector of ['#home-recent','#memory-items','#stat-cards','#mood-chart','#evidence-list','#theme-list','#insight-history'])$(selector).replaceChildren();
  $('#comfort-quote').textContent='';$('#comfort-evidence').textContent='';
  $('#memory-search').value='';$('#record-form').reset();
  $('#app').classList.add('hidden');$('#splash').classList.add('hidden');$('#gate').classList.remove('hidden');$('#gate-error').textContent='';$('#gate-form').reset();const meta=await getMeta();$('#confirm-row').classList.toggle('hidden',!!meta);$('#passphrase').minLength=meta?1:10;$('#gate-mode').textContent=meta?'돌아오셨군요. 암호를 입력해 주세요.':'처음 시작하는 공간';$('#gate-submit').textContent=meta?'나의 공간 열기':'나의 공간 만들기';}
async function handleGate(event){event.preventDefault();const submit=$('#gate-submit');submit.disabled=true;$('#gate-error').textContent='';try{const password=$('#passphrase').value;let meta=await getMeta();if(!meta){if(password.length<10)throw Error('암호는 10자 이상으로 만들어 주세요.');if(password!==$('#passphrase-confirm').value)throw Error('암호 확인이 일치하지 않아요.');const salt=randomB64(16);const freshKey=await deriveKey(password,salt);meta={version:1,salt,iterations:KDF_ITERATIONS,verifier:await encrypt({tag:'wirohaeyo:secure:v1'},freshKey),createdAt:new Date().toISOString()};await putMeta(meta);key=freshKey;}else{const freshKey=await deriveKey(password,meta.salt,meta.iterations);let verifier;try{verifier=await decrypt(meta.verifier,freshKey);}catch{throw Error('암호가 맞지 않아요. 다시 입력해 주세요.');}if(verifier.tag!=='wirohaeyo:secure:v1')throw Error('백업 데이터가 올바르지 않아요.');key=freshKey;}$('#passphrase').value='';$('#passphrase-confirm').value='';await fetchRecords();await openApp();}catch(e){$('#gate-error').textContent=e.message||'보관함을 열지 못했어요.';}finally{submit.disabled=false;}}
async function openApp(){$('#gate').classList.add('hidden');$('#app').classList.remove('hidden');$('#today-date').textContent=TODAY.format(new Date());$('#tone-select').value=tone;await markVisit();await snapshotInsights();changeView('home');renderAll();if(pendingShareText){const shared=pendingShareText;pendingShareText=null;await askImportSharedText(shared);}if(pendingShareImage){const shared=pendingShareImage;pendingShareImage=null;await askImportSharedImage(shared);}}
async function markVisit(){const date=dateKey();if(records.some(r=>r.type==='visit'&&r.day===date))return;await saveRecord({type:'visit',day:date},{refresh:false});}
async function snapshotInsights(){const today=dateKey();const source=records.filter(r=>r.type!=='insight'&&r.type!=='preference'&&r.type!=='visit');const count=source.length;const moods=source.filter(r=>r.type==='checkin'&&typeof r.mood==='number');const average=moods.length?Math.round(moods.reduce((s,r)=>s+r.mood,0)/moods.length*10)/10:null;const current=records.find(r=>r.type==='insight'&&r.day===today);if(!current||current.total!==count||current.moodCount!==moods.length||current.average!==average){await saveRecord({...(current||{}),type:'insight',day:today,total:count,moodCount:moods.length,average,updatedAt:new Date().toISOString()},{refresh:false});}}
function changeView(view){$$('.view').forEach(v=>v.classList.toggle('hidden',v.id!==`view-${view}`));$$('[data-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===view));window.scrollTo({top:0,behavior:'instant'});if(view==='insight')renderInsights();if(view==='memories')renderMemories();if(view==='home')renderHome();}
function entryDate(entry){return safeDate(entry.createdAt)}
function typeName(entry){return (KNOWN_TYPES[entry.type]||['기억','✧'])[0];}
function getPersonalRecords(){return records.filter(r=>KNOWN_TYPES[r.type]&&!['checkin','comfort'].includes(r.type));}
function selectedEvidence(){return records.filter(r=>['achievement','gratitude','letter','moment'].includes(r.type)&&r.includeInInsights!==false&&((r.body||'').trim()||(r.title||'').trim()));}
function quoteText(entry){return (entry.title||entry.body||'').replace(/\s+/g,' ').trim().slice(0,45);}
function normalizeThemeTerm(word){
  if(!/^[가-힣]+$/.test(word)||word.length<4)return word;
  for(const suffix of ['에서','으로','에게','부터','까지','처럼','하고','하며','을','를','은','는','이','가','도','만','과','와','의','에','로']){
    if(word.endsWith(suffix)&&word.length-suffix.length>=2)return word.slice(0,-suffix.length);
  }
  return word;
}
function localThemes(items,limit=7){
  const counts=new Map();
  for(const item of items){
    if(item.includeInInsights===false||!['moment','achievement','gratitude','letter','import'].includes(item.type))continue;
    const text=`${item.title||''} ${item.body||''}`.slice(0,MAX_RECORD_TEXT);
    const terms=new Set((text.toLowerCase().match(/[가-힣]{2,}|[a-z]{3,}/g)||[])
      .map(normalizeThemeTerm).filter(word=>word.length<=20&&!THEME_STOPWORDS.has(word)));
    for(const term of terms)counts.set(term,(counts.get(term)||0)+1);
  }
  return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ko')).slice(0,limit);
}
function importTextFromJson(raw){
  let obj;try{obj=JSON.parse(raw)}catch{return raw}
  const fields=new Set(['text','content','body','caption','description','title','message','comment','story','text_content']);
  const result=[];let nodes=0;
  function visit(value,depth){
    if(depth>7||nodes++>3000||result.join('').length>MAX_RECORD_TEXT)return;
    if(Array.isArray(value)){for(const v of value.slice(0,400))visit(v,depth+1);return;}
    if(!value||typeof value!=='object')return;
    for(const [key,val] of Object.entries(value)){
      if(fields.has(key.toLowerCase())&&typeof val==='string'&&val.trim())result.push(val.trim().slice(0,2000));
      else if(typeof val==='object'&&val!==null)visit(val,depth+1);
    }
  }
  visit(obj,0);
  // An unfamiliar export stays readable; it is not silently discarded.
  return result.length?result.join('\n\n').slice(0,MAX_RECORD_TEXT):raw.slice(0,MAX_RECORD_TEXT);
}
function renderComfort(){if(!key)return;const options=PHRASES[tone];const base=options[comfortIndex%options.length];const eligible=selectedEvidence().filter(r=>r.type==='achievement'||r.type==='gratitude');const evidence=eligible[comfortIndex%Math.max(1,eligible.length)];let quote=base,evidenceText='이 공간에 쌓이는 당신의 이야기에서 다정한 증거를 찾아갈게요.';if(evidence&&comfortIndex%2===1){const snippet=quoteText(evidence);quote=`“${snippet}”라는 기록을 당신이 남겼어요. 나는 이 순간을 작게 여기지 않을래요.`;evidenceText=`${entryDate(evidence)} · ${typeName(evidence)}에 남긴 말에서 찾았어요.`;}else if(records.some(r=>r.type==='checkin'&&r.mood<=2&&r.day===dateKey())){evidenceText='오늘 마음이 무거웠다고 적어주었어요. 그런 마음에도 자리가 있어요.';}lastComfort={quote,evidenceText};$('#comfort-quote').textContent=quote;$('#comfort-evidence').textContent=evidenceText;}
function renderHome(){if(!key)return;renderComfort();const latest=records.filter(r=>KNOWN_TYPES[r.type]&&!['checkin'].includes(r.type)).slice(0,3);renderEntries('#home-recent',latest,{allowDelete:false});const mood=records.find(r=>r.type==='checkin'&&r.day===dateKey());$$('[data-mood]').forEach(btn=>btn.classList.toggle('selected',Number(btn.dataset.mood)===mood?.mood));}
function newNode(tag,klass,text){const node=document.createElement(tag);if(klass)node.className=klass;if(text!==undefined)node.textContent=text;return node;}
function renderEntries(selector,items,{allowDelete=true}={}){const root=$(selector);root.replaceChildren();if(items.length===0){root.append(newNode('div','empty','아직 보관된 기록이 없어요. 오늘 마음속 한 문장부터 시작해도 좋아요.'));return;}for(const entry of items){const wrap=newNode('article','entry');const icon=newNode('span','entry-symbol',(KNOWN_TYPES[entry.type]||['','✧'])[1]);const details=newNode('div','entry-details');const title=newNode('h3','',entry.title||typeName(entry));const body=newNode('p','entry-excerpt',entry.body||entry.quote||'사진으로 남긴 기억');const date=newNode('span','entry-date',`${entryDate(entry)} · ${typeName(entry)}${entry.source&&entry.type==='import'?` · ${entry.source}`:''}`);details.append(title,body);if(entry.imageData&&/^data:image\/(png|jpeg|webp);base64,/.test(entry.imageData)){const img=newNode('img');img.src=entry.imageData;img.alt='사용자가 보관한 사진';img.loading='lazy';details.append(img);}details.append(date);wrap.append(icon,details);if(allowDelete){const actions=newNode('div','entry-actions');const del=newNode('button','','×');del.type='button';del.title='기록 삭제';del.setAttribute('aria-label',`${entry.title||typeName(entry)} 삭제`);del.addEventListener('click',async()=>{if(await confirmAction('이 기록을 지울까요?','이 기기에서만 삭제돼요. 이전에 내보낸 백업에는 남아 있을 수 있어요.','기록 삭제')){await removeRecord(entry.id);toast('기록을 지웠어요.');}});if(entry.type==='import'){
      const consent=newNode('button','consent-toggle',entry.includeInInsights?'분석 포함 ✓':'분석 제외');
      consent.type='button';consent.title='이 자료를 내 기록 키워드 분석에 포함할지 선택';
      consent.setAttribute('aria-pressed',String(entry.includeInInsights===true));
      consent.addEventListener('click',async()=>{
        consent.disabled=true;
        try{const next=!entry.includeInInsights;await saveRecord({...entry,includeInInsights:next});await snapshotInsights();toast(next?'이 자료를 키워드 분석에 포함했어요.':'이 자료를 분석에서 제외했어요.');}
        catch{toast('설정을 저장하지 못했어요.');consent.disabled=false;}
      });
      actions.append(consent);
    }
    actions.append(del);wrap.append(actions);}root.append(wrap);}}
function renderMemories(){if(!key)return;const type=$('#memory-filter').value||'all';const query=$('#memory-search').value.trim().toLowerCase();const selected=records.filter(r=>KNOWN_TYPES[r.type]&&(type==='all'||r.type===type)&&(!query||`${r.title||''} ${r.body||''} ${r.quote||''}`.toLowerCase().includes(query)));renderEntries('#memory-items',selected);}
function renderInsights(){if(!key)return;const content=records.filter(r=>KNOWN_TYPES[r.type]);const mood=content.filter(r=>r.type==='checkin');const evidence=selectedEvidence();const recent=content.filter(r=>new Date(r.createdAt).getTime()>=Date.now()-7*86400000);const stats=[['쌓아온 나의 기록',content.length,'개'],['내가 인정한 순간',evidence.filter(r=>r.type==='achievement').length,'개'],['최근 7일의 기록',recent.length,'개']];const root=$('#stat-cards');root.replaceChildren();for(const [label,value,unit] of stats){const card=newNode('div','stat-card');card.append(newNode('span','',label),newNode('strong','',String(value)),newNode('small','',unit));root.append(card);}const chart=$('#mood-chart');chart.replaceChildren();for(let daysAgo=6;daysAgo>=0;daysAgo--){const day=new Date();day.setHours(12,0,0,0);day.setDate(day.getDate()-daysAgo);const dayRecords=mood.filter(x=>x.day===dateKey(day));const avg=dayRecords.length?dayRecords.reduce((sum,x)=>sum+x.mood,0)/dayRecords.length:0;const col=newNode('div',daysAgo===0?'chart-day highlight':'chart-day');const bar=newNode('div','chart-bar');bar.style.height=`${avg?avg*23:3}px`;bar.title=avg?`평균 마음 기록 ${avg.toFixed(1)} / 5`:'기록 없음';col.append(bar,newNode('span','',`${day.getMonth()+1}/${day.getDate()}`));chart.append(col);}const list=$('#evidence-list');list.replaceChildren();const chosen=evidence.filter(x=>x.type==='achievement'||x.type==='gratitude').slice(0,4);if(chosen.length){for(const r of chosen){const line=newNode('div','evidence',`“${quoteText(r)}”`);line.append(newNode('small','',`${entryDate(r)} · 직접 남긴 ${typeName(r)}`));list.append(line);}}else{list.append(newNode('div','empty','내가 해낸 일이나 고마운 순간을 적어주세요. 기록에 없는 장점을 지어내지는 않을게요.'));}const themes=$('#theme-list');themes.replaceChildren();
  const keywords=localThemes(records);
  if(keywords.length){for(const [word,count] of keywords){const chip=newNode('span','theme-chip',`${word} · ${count}건`);themes.append(chip);}}
  else themes.append(newNode('div','empty','기록이 모이면, 내가 반복해서 남긴 말들을 여기에서 살펴볼 수 있어요.'));
  const history=$('#insight-history');history.replaceChildren();const snaps=records.filter(r=>r.type==='insight').sort((a,b)=>(b.day||'').localeCompare(a.day||'')).slice(0,10);for(const item of snaps){const line=newNode('div','evidence',`${item.day} · 기록 ${item.total}개 · 마음 체크 ${item.moodCount}회${item.average===null?'':` · 평균 ${item.average}`}`);history.append(line);}if(snaps.length===0)history.append(newNode('div','empty','첫 발견을 준비하고 있어요.'));}
function renderAll(){renderHome();renderMemories();renderInsights();}
async function handleCheckin(mood){selectedMood=mood;const today=dateKey();const existing=records.find(r=>r.type==='checkin'&&r.day===today);await saveRecord({...(existing||{}),type:'checkin',day:today,mood});await snapshotInsights();toast('오늘의 마음을 판단 없이 기억할게요.');}
async function handleRecord(event){event.preventDefault();const content=$('#record-body').value.trim(),title=$('#record-title').value.trim();if(!content){toast('한 문장만 적어도 괜찮아요.');return;}const submit=$('#record-form [type=submit]');submit.disabled=true;try{await saveRecord({type:recordType,title,body:content,includeInInsights:$('#record-include').checked,source:'나의 기록'});await snapshotInsights();$('#record-form').reset();recordType='moment';setRecordType('moment');changeView('home');toast('나의 이야기를 안전하게 보관했어요.');}catch(e){toast('저장하지 못했어요. 기기 공간을 확인해 주세요.');}finally{submit.disabled=false;}}
function setRecordType(type){recordType=type;$$('[data-type]').forEach(btn=>btn.classList.toggle('active',btn.dataset.type===type));}
async function askImportSharedText(text){if(!key){pendingShareText=text;return;}if(!text||text.length>MAX_RECORD_TEXT){toast('공유받은 텍스트가 비어 있거나 너무 길어요.');return;}if(await confirmAction('공유받은 글을 보관할까요?',text.slice(0,180)+(text.length>180?'…':'')+'\n\n분석에는 기본적으로 포함하지 않습니다.','보관하기')){await saveRecord({type:'import',title:'다른 앱에서 공유한 글',body:text,source:'Android 공유하기',includeInInsights:false});await snapshotInsights();toast('공유받은 글을 암호화해 보관했어요.');}}
// Exposed only for Android's explicit ACTION_SEND share intent, not network access.
window.receiveSharedText=function(text){if(typeof text!=='string')return;pendingShareText=text.slice(0,MAX_RECORD_TEXT);if(key){const p=pendingShareText;pendingShareText=null;askImportSharedText(p);}};
async function askImportSharedImage(payload){
  if(!key){pendingShareImage=payload;return;}
  if(!payload||!/^image\/(png|jpeg|webp)$/.test(payload.mime)||!payload.base64||payload.base64.length>2800000){toast('공유된 사진이 올바르지 않거나 너무 커요.');return;}
  if(!await confirmAction('다른 앱에서 공유한 사진을 보관할까요?','사진은 기기에 암호화해 저장합니다. 사진의 내용은 자동으로 분석하지 않습니다.','사진 보관하기'))return;
  try{
    const bytes=fromB64(payload.base64);
    const fingerprint=toB64(await crypto.subtle.digest('SHA-256',bytes));
    if(records.some(r=>r.fingerprint===fingerprint)){toast('이미 보관된 사진이에요.');return;}
    await saveRecord({type:'import',title:'공유한 사진',body:'다른 앱에서 공유한 사진',source:'Android 사진 공유하기',fingerprint,
      imageData:`data:${payload.mime};base64,${payload.base64}`,originalMime:payload.mime,originalSize:bytes.length,includeInInsights:false});
    await snapshotInsights();toast('공유한 사진을 암호화해 보관했어요.');
  }catch{toast('사진을 보관하지 못했어요.');}
}
window.receiveSharedImage=function(mime,base64){
  if(typeof mime!=='string'||typeof base64!=='string'||!/^image\/(png|jpeg|webp)$/.test(mime)||base64.length>2800000)return;
  const payload={mime,base64};if(!key){pendingShareImage=payload;return;}
  askImportSharedImage(payload).catch(()=>toast('사진을 보관하지 못했어요.'));
};
async function importSelectedFiles(files){
  if(!files?.length)return;
  const allowAnalysis=$('#import-analyze').checked;
  let imported=0,skipped=0,duplicates=0,bytesTotal=0;
  const fingerprints=new Set(records.filter(r=>r.fingerprint).map(r=>r.fingerprint));
  for(const file of Array.from(files).slice(0,20)){
    if(file.size>MAX_IMPORT_BYTES||bytesTotal+file.size>MAX_IMPORT_BATCH_BYTES){skipped++;continue;}
    const isImage=/^image\/(jpeg|png|webp)$/.test(file.type)||/\.(jpe?g|png|webp)$/i.test(file.name);
    const isText=/\.(txt|md|json|csv)$/i.test(file.name)||/^(text\/|application\/json)/.test(file.type);
    if(!isImage&&!isText){skipped++;continue;}
    const bytes=await file.arrayBuffer();
    const digest=toB64(await crypto.subtle.digest('SHA-256',bytes));
    if(fingerprints.has(digest)){duplicates++;continue;}
    let imageData,body;
    if(isImage){imageData=await readDataUrl(file);body=`선택한 사진: ${file.name}`;}
    else{
      const raw=new TextDecoder('utf-8',{fatal:false}).decode(bytes);
      if(!raw.trim()){skipped++;continue;}
      body=/\.json$/i.test(file.name)||file.type==='application/json'?importTextFromJson(raw):raw.slice(0,MAX_RECORD_TEXT);
      if(body.length>=MAX_RECORD_TEXT)body=body.slice(0,MAX_RECORD_TEXT)+'\n\n[내용 일부만 가져왔습니다.]';
    }
    // File contents are sealed in IndexedDB, not uploaded to a server.
    await saveRecord({type:'import',title:file.name.slice(0,200),body,source:'사용자 선택 파일',
      originalMime:file.type||'application/octet-stream',originalSize:file.size,
      fingerprint:digest,imageData,includeInInsights:allowAnalysis},{refresh:false});
    bytesTotal+=file.size;fingerprints.add(digest);imported++;
  }
  $('#import-analyze').checked=false;
  renderAll();await snapshotInsights();
  toast(`${imported}개 파일을 보관했어요.${duplicates?` 중복 ${duplicates}개 제외.`:''}${skipped?` 형식·크기로 ${skipped}개 제외.`:''}`);
}
function readDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file);});}
async function exportBackup(){const meta=await getMeta();const encrypted=await transaction('records','readonly',s=>s.getAll());const backup={format:'wirohaeyo-encrypted-backup',version:1,exportedAt:new Date().toISOString(),meta,records:encrypted};const text=JSON.stringify(backup);const blob=new Blob([text],{type:'application/json'});const url=URL.createObjectURL(blob);if(window.WiroNative?.requestBackupFile){URL.revokeObjectURL(url);pendingNativeBackup=new TextEncoder().encode(text);window.WiroNative.requestBackupFile(`wirohaeyo-${dateKey()}.encrypted.json`);toast('암호화 백업을 저장할 위치를 선택해 주세요.');return;}const link=document.createElement('a');link.href=url;link.download=`wirohaeyo-${dateKey()}.encrypted.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('암호화된 백업을 만들었어요. 안전한 곳에 보관해 주세요.');}
// Android Storage Access Framework: user picks the location; only already encrypted bytes leave the vault.
window.onNativeBackupReady=function(approved){if(!approved){pendingNativeBackup=null;toast('백업 저장을 취소했어요.');return;}const bytes=pendingNativeBackup;pendingNativeBackup=null;if(!bytes){window.WiroNative.finishBackup();return;}try{for(let i=0;i<bytes.length;i+=12288){const chunk=toB64(bytes.subarray(i,i+12288));if(!window.WiroNative.appendBackupChunk(chunk))throw Error('파일에 쓰지 못했어요.');}window.WiroNative.finishBackup();}catch(error){window.WiroNative.cancelBackup();toast('백업을 저장하지 못했어요. 다시 시도해 주세요.');}};
window.onNativeBackupComplete=function(success){toast(success?'암호화 백업을 선택한 위치에 저장했어요.':'백업을 완료하지 못했어요. 다시 시도해 주세요.');};
function validateBackup(b){return b?.format==='wirohaeyo-encrypted-backup'&&b.version===1&&b.meta?.version===1&&typeof b.meta.salt==='string'&&b.meta.iterations>=100000&&b.meta.iterations<=1000000&&typeof b.meta.verifier?.iv==='string'&&typeof b.meta.verifier?.ct==='string'&&Array.isArray(b.records)&&b.records.length<=20000&&b.records.every(r=>typeof r.id==='string'&&r.id.length<90&&typeof r.blob?.iv==='string'&&typeof r.blob?.ct==='string');}
async function restoreBackup(input){const file=input.files?.[0];input.value='';if(!file)return;if(file.size>80*1024*1024){toast('80MB 이하의 백업 파일을 선택해 주세요.');return;}let backup;try{backup=JSON.parse(await file.text());if(!validateBackup(backup))throw Error('암호화된 위로해요 백업 파일이 아니에요.');}catch(e){toast(e.message||'백업 파일을 읽지 못했어요.');return;}const password=await requestBackupPassword();if(password===null)return;try{const proposedKey=await deriveKey(password,backup.meta.salt,backup.meta.iterations);const check=await decrypt(backup.meta.verifier,proposedKey);if(check.tag!=='wirohaeyo:secure:v1')throw Error('암호 확인 실패');const seen=new Set();for(const item of backup.records){if(seen.has(item.id))throw Error('중복된 기록');seen.add(item.id);const decoded=await decrypt(item.blob,proposedKey);if(decoded?.id!==item.id||typeof decoded.type!=='string')throw Error('기록 무결성 확인 실패');}}catch{toast('백업 암호가 맞지 않거나 파일이 손상됐어요. 기존 기록을 유지합니다.');return;}if(!await confirmAction('기존 보관함을 교체할까요?',`검증된 백업 ${backup.records.length}개 기록으로 현재 기기 데이터를 전부 교체합니다. 기존 기록은 복구할 수 없어요. 먼저 백업했는지 확인해 주세요.`,'전체 교체'))return;
try{await new Promise((resolve,reject)=>{const tr=db.transaction(['records','meta'],'readwrite');tr.objectStore('records').clear();for(const r of backup.records)tr.objectStore('records').put({id:r.id,blob:r.blob});tr.objectStore('meta').put(backup.meta,'vault');tr.oncomplete=resolve;tr.onerror=()=>reject(tr.error);tr.onabort=()=>reject(tr.error);});await showGate();toast('복원했습니다. 백업 암호로 다시 열어 주세요.');}catch{toast('복원하지 못했어요. 기기 공간을 확인해 주세요.');}}
function requestBackupPassword(){return new Promise(resolve=>{const dialog=$('#restore-dialog');$('#restore-pass').value='';const submit=$('#restore-submit');const cancel=$('#restore-cancel');const done=result=>{submit.removeEventListener('click',yes);cancel.removeEventListener('click',no);dialog.removeEventListener('cancel',no);dialog.close();resolve(result);};const yes=()=>done($('#restore-pass').value||'');const no=e=>{e?.preventDefault?.();done(null);};submit.addEventListener('click',yes);cancel.addEventListener('click',no);dialog.addEventListener('cancel',no);dialog.showModal();$('#restore-pass').focus();});}
function confirmAction(title,message,okLabel='확인'){return new Promise(resolve=>{const dialog=$('#dialog');$('#dialog-title').textContent=title;$('#dialog-message').textContent=message;$('#dialog-ok').textContent=okLabel;const cancel=$('#dialog-cancel'),ok=$('#dialog-ok');const done=result=>{ok.removeEventListener('click',yes);cancel.removeEventListener('click',no);dialog.removeEventListener('cancel',no);dialog.close();resolve(result);};const yes=()=>done(true),no=e=>{e?.preventDefault?.();done(false);};ok.addEventListener('click',yes);cancel.addEventListener('click',no);dialog.addEventListener('cancel',no);dialog.showModal();});}
async function wipeVault(){if(!await confirmAction('나의 모든 기록을 정말 지울까요?','보관함의 암호와 모든 기록을 완전히 제거합니다. 백업 파일이 없다면 복구할 수 없어요.','모두 삭제'))return;if(!await confirmAction('마지막으로 확인해 주세요','이 동작은 취소할 수 없습니다. 나의 기록을 기기에서 모두 삭제할까요?','네, 삭제합니다'))return;await new Promise((resolve,reject)=>{const tr=db.transaction(['records','meta'],'readwrite');tr.objectStore('records').clear();tr.objectStore('meta').clear();tr.oncomplete=resolve;tr.onerror=()=>reject(tr.error);});await showGate();toast('이 기기에 보관된 기억을 모두 삭제했어요.');}
function installEvents(){
  $('#gate-form').addEventListener('submit',handleGate);
  $$('[data-view]').forEach(button=>button.addEventListener('click',()=>changeView(button.dataset.view)));
  $$('[data-go]').forEach(button=>button.addEventListener('click',()=>changeView(button.dataset.go)));
  $('#hero-record').addEventListener('click',()=>changeView('write'));
  $('#lock-btn').addEventListener('click',showGate);
  $('#settings-lock').addEventListener('click',showGate);
  $('#new-comfort').addEventListener('click',()=>{comfortIndex++;renderComfort();});
  $('#save-comfort').addEventListener('click',async()=>{if(!lastComfort)return;await saveRecord({type:'comfort',title:'나에게 건넨 위로',quote:lastComfort.quote,body:lastComfort.quote,source:'앱의 위로',includeInInsights:false});await snapshotInsights();toast('이 말을 나의 기억에 담았어요.');});
  $$('[data-mood]').forEach(button=>button.addEventListener('click',()=>handleCheckin(Number(button.dataset.mood)).catch(()=>toast('마음 기록을 저장하지 못했어요.'))));
  $$('[data-type]').forEach(button=>button.addEventListener('click',()=>setRecordType(button.dataset.type)));
  $('#record-form').addEventListener('submit',handleRecord);
  $('#record-form').addEventListener('reset',()=>setRecordType('moment'));
  $('#memory-filter').addEventListener('change',renderMemories);
  $('#memory-search').addEventListener('input',renderMemories);
  $('#import-open').addEventListener('click',()=>$('#import-file').click());
  $('#import-file').addEventListener('change',async event=>{try{await importSelectedFiles(event.target.files);}catch(e){console.warn(e);toast('파일을 가져오지 못했어요. 남은 기기 저장 공간을 확인해 주세요.');}finally{event.target.value='';}});
  $('#tone-select').addEventListener('change',event=>saveTone(event.target.value));
  $('#export-backup').addEventListener('click',()=>exportBackup().catch(()=>toast('백업 파일을 만들지 못했어요.')));
  $('#gate-backup-input').addEventListener('change',event=>restoreBackup(event.target));
  $('#settings-backup-input').addEventListener('change',event=>restoreBackup(event.target));
  $('#delete-everything').addEventListener('click',()=>wipeVault().catch(()=>toast('삭제하지 못했어요.')));
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
      clearTimeout(toastTimer);
      if(key){backgroundAt=Date.now();clearTimeout(backgroundLockTimer);
        backgroundLockTimer=setTimeout(()=>{if(document.hidden&&key)showGate().catch(()=>{});},BACKGROUND_LOCK_MS);}
    }else{
      clearTimeout(backgroundLockTimer);
      if(key&&backgroundAt&&Date.now()-backgroundAt>=BACKGROUND_LOCK_MS){showGate().then(()=>toast('기록을 보호하기 위해 자동으로 잠갔어요.')).catch(()=>{});}
      backgroundAt=null;
    }
  });
}
installEvents();initialize();
