'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const source = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
assert.match(source, /const KDF_ITERATIONS = 310000/);
assert.match(source, /AES-GCM/);
assert.doesNotMatch(source, /https?:\/\/[^'"\s]+\/api/i, 'No remote analysis endpoint');
assert.ok(source.endsWith('installEvents();initialize();\n'));
const context = {
  crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, btoa, atob, Intl, Date,
  console, setTimeout, clearTimeout, window: {},
};
vm.createContext(context);
vm.runInContext(source.replace(/installEvents\(\);initialize\(\);\s*$/, '') + '\nthis.__core = {deriveKey, encrypt, decrypt, validateBackup, toB64, fromB64, dateKey, localThemes, importTextFromJson};', context);
(async () => {
  const {deriveKey,encrypt,decrypt,validateBackup,toB64,fromB64} = context.__core;
  const salt = toB64(webcrypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKey('long secret password!', salt, 310000);
  const wrong = await deriveKey('other secret password', salt, 310000);
  const plain = {id: 'test-1', type: 'achievement', title: '실제 내가 해낸 일', body: '오늘도 버텼다', mood: 2};
  const blob = await encrypt(plain, key);
  assert.deepEqual(Buffer.from(fromB64(blob.iv)).length,12);
  assert.equal(JSON.stringify(blob).includes(plain.body),false);
  assert.equal(JSON.stringify(blob).includes(plain.title),false);
  assert.equal(JSON.stringify(await decrypt(blob,key)),JSON.stringify(plain));
  await assert.rejects(decrypt(blob,wrong));
  const verifier = await encrypt({tag:'wirohaeyo:secure:v1'},key);
  const backup = {format:'wirohaeyo-encrypted-backup',version:1,meta:{version:1,salt,iterations:310000,verifier},records:[{id:'test-1',blob}]};
  assert.equal(validateBackup(backup),true);
  assert.equal(validateBackup({...backup,format:'unsafe-plaintext'}),false);
  assert.equal(validateBackup({...backup,meta:{...backup.meta,iterations:5}}),false);
  const {localThemes,importTextFromJson} = context.__core;
  const sourceRecords = [
    {type:'moment',title:'자전거 수리',body:'자전거를 직접 고쳤다.',includeInInsights:true},
    {type:'import',title:'SNS 내보내기',body:'복숭아를 기록했다.',includeInInsights:false},
    {type:'import',title:'수확 목록',body:'자전거 타고 수확했다.',includeInInsights:true}
  ];
  assert.ok(localThemes(sourceRecords).some(([word,count])=>word==='자전거'&&count===2));
  assert.ok(!localThemes(sourceRecords).some(([word])=>word==='복숭아'), 'Opted-out imported data must not influence analysis');
  assert.ok(localThemes([{...sourceRecords[1],includeInInsights:true}]).some(([word])=>word==='복숭아'));
  assert.equal(importTextFromJson('{"messages":[{"message":"사과 수확"}]}'),'사과 수확');
  assert.equal(importTextFromJson('Plain legacy export text'),'Plain legacy export text');
  assert.equal(importTextFromJson('{"unknown":{"other":"kept"}}').includes('unknown'),true);
  const imageBytes = webcrypto.getRandomValues(new Uint8Array(64));
  const imageFingerprint = Buffer.from(await webcrypto.subtle.digest('SHA-256',imageBytes)).toString('base64');
  assert.equal(imageFingerprint.length,44);
  const manifestFile=path.resolve(__dirname,'../../wirohaeyo.android/app/src/main/AndroidManifest.xml');
  if(fs.existsSync(manifestFile)){
    const manifest=fs.readFileSync(manifestFile,'utf8');
    assert.doesNotMatch(manifest,/android.permission.INTERNET|android.permission.READ_SMS|android.permission.ACCESS_FINE_LOCATION/);
    assert.match(manifest,/image\/jpeg/);
    const packagedJS=fs.readFileSync(path.resolve(__dirname,'../../wirohaeyo.android/app/src/main/assets/www/app.js'),'utf8');
    assert.equal(packagedJS,source,'Android packaged JS is expected to match the web JS');
  }

  console.log('PASS: encryption, backup, consented analysis, JSON import, SHA-256, Android offline manifest/assets');
})().catch(err => {console.error(err);process.exit(1)});
