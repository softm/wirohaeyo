# 위로해요 — 나를 잊지 않는 작은 공간

**위로해요 (wirohaeyo)** 는 내가 남긴 이야기를 근거로 내 노력과 삶을 다시 발견하고, 조금 더 내 편이 될 수 있도록 돕는 **로컬 우선 개인 기록·위로 앱**입니다.

> 슬로건: 나를 추앙한다는 건, 내 삶을 과장하는 일이 아니라 소중하게 대하는 일.

## 구현된 기능 (v0.2)

| 영역 | 기능 | 구현 방식 |
| --- | --- | --- |
| 시작·보안 | 비밀번호 생성/잠금/해제·5분 비활성 잠금 | PBKDF2-SHA-256(310,000회)로 AES-GCM 256비트 키 파생 |
| 기록 | 일상·해낸 일·감사·나에게 쓴 글 | 항목별 암호화, IndexedDB 보관 |
| 마음 확인 | 하루 한 번 1~5단계 기록 | 진단 대신 개인 기록으로 해석 |
| 위로 | 살며시 / 노력 인정 / 나를 높여주기 | 과장하지 않고 입력된 기록을 인용해 근거와 함께 표시 |
| 분석 | 최근 기록 수·해낸 일·7일 마음 변화·일별 스냅샷·사용자 동의 기반 반복 키워드 | **로컬에서만** 계산 후 암호화하여 보관 |
| 사진·자료 | TXT/MD/CSV/JSON/JPEG/PNG/WebP 수동 가져오기 | 사용자 파일 선택, 개별 6MB / 한 번에 총 32MB 제한, 최대 20건/회, 이미지 내용 분석 안 함 |
| SNS 연결 | Android 공유하기에서 텍스트 및 2MB 이하 JPEG/PNG/WebP 사진 수신 | **사용자가 명시적으로 공유한 자료만** 확인 후 저장 |
| 데이터 통제 | 검색, 자료 삭제, 분석 포함 여부 | 가져온 파일은 기본적으로 분석 대상 아님; 파일별 분석 동의 변경·중복 파일 제외 |
| 백업 | 암호화 JSON 내보내기/암호 검사 후 전체 복원 | 사용자 직접 백업·복원, 서버 없음 |
| 오프라인 | PWA 서비스워커, Android 로컬 정적 자산 | 외부 API/광고/통계 SDK 없음 |

**현재 하지 않는 일:** 몰래 SMS, 카카오톡, SNS, 통화기록, 위치 또는 다른 앱의 데이터를 읽거나 클라우드에 전송하지 않습니다. 자동 SNS 연동, AI 기반 성격 진단, 무인 클라우드 백업, 백그라운드 상시 수집은 구현되지 않았습니다. 모든 데이터는 원 소유자의 선택과 각 플랫폼 권한 규칙을 존중해야 합니다.

## 실행

`index.html`을 **HTTPS** 웹서버에 배포하거나 로컬에서 `python3 -m http.server 8080` 후 `http://localhost:8080`로 열면 됩니다. 로컬 파일(`file://`)로 직접 여는 방식은 브라우저에 따라 암호화·IndexedDB가 제한될 수 있습니다.

* 정식 배포 대상: GitHub Pages — `https://softm.github.io/wirohaeyo/` (**배포 완료 전에는 열리지 않습니다**)
* 저장소: `https://github.com/softm/wirohaeyo` (**생성 필요**)
* Android 래퍼 소스: `https://github.com/softm/wirohaeyo.android` (**생성 필요**)

## 데이터 모델

IndexedDB(`wirohaeyo-vault-v1`)는 `meta`와 `records` 두 개의 object store를 사용합니다. `meta.vault`는 salt, KDF 반복 수 및 검증용 암호문만 포함합니다. `records`의 각 항목은 임의의 ID와 `{iv,ct}` 암호문으로 저장됩니다. 모든 제목, 텍스트, 감정, 이미지, 분석 스냅샷은 암호문 **안에** 포함됩니다. 서버 측 복구 키는 없습니다.

## 백업 주의

백업 파일에 기록이 평문으로 담기지는 않지만, 비밀번호를 잃으면 백업도 열지 못합니다. GitHub Pages의 저장소와 Android 앱은 저장 공간이 **별개**이므로 기기 간 이전에는 내보내기/가져오기가 필요합니다. Android는 시스템 파일 선택기로 사용자가 결정한 저장 위치에 암호화 백업을 씁니다. 브라우저에서 사이트 데이터 삭제, 앱 삭제 또는 디바이스 초기화 전에 백업해야 합니다.

암호화는 노출 위험을 줄이지만 악성코드·루팅된 기기·화면에 나타난 평문 등을 방어할 수 있는 만능 보안 수단은 아닙니다. 중요 개인정보가 있는 사진을 공개 GitHub 저장소에 넣지 마세요.

## 포함된 개인정보 처리 안내

공개 웹에 배포되는 `privacy.html`은 저장 범위, 백업·삭제, 플랫폼 호스팅 제약을 설명합니다. 웹과 Android에는 같은 안내를 동봉합니다.

## 품질 검증

```bash
node --check app.js
node --check sw.js
node tests/core.test.cjs
# 별도 E2E(선택): pip install playwright && python -m playwright install chromium
# python tests/e2e_smoke.py
```

Android 연동과 배포 절차는 [Android README](https://github.com/softm/wirohaeyo.android#readme) 및 `docs/PRODUCT_SPEC.md` 참조. Android 실기기에서 공유, 파일 선택, 백업/복원, 앱 종료 뒤 잠금 동작을 확인한 후 Play 배포를 준비하세요. Android 16(API 36) 타기팅 설정이며 Android APK와 AAB 서명 배포는 아직 검증되지 않았습니다.
