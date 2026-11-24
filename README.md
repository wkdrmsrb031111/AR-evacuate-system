# AR-evacuate-system

**총알받이 팀 · 카메라 기반 AR 대피 안내 프로젝트 !**

휴대폰 카메라로 표지판을 인식해 현재 장소를 확인하고, 카메라 화면 위에 대피 방향을 내비게이션처럼 표시하는 시제품을 목표로 합니다.

> 현재 구현은 관리자 웹, 경로 계산 서버, 사진 기반 표지판 OCR 테스트까지입니다. 실시간 카메라 영상과 AR 화살표, 실내 위치·방향 추적은 아직 구현하지 않았습니다. 경로에 표시되는 사진은 보조 자료입니다.

## 진행 상황 — 2026-11-24

| 구분 | 구현 상태 |
| --- | --- |
| 장소 관리 | 건물·층·장소 이름 등록·수정·삭제·복원 |
| 사진 관리 | 장소별 사진 업로드 및 서버 저장 |
| 길 관리 | 장소 간 연결, 거리와 이동 설명, 통행 불가 설정 |
| 경로 계산 | 같은 건물·층의 가장 가까운 비상계단 입구 탐색, 막힌 구간 제외 및 우회 |
| 관리자 사용성 | 작업 3개 영역, 검색, 큰 글씨·큰 버튼 |
| 점검·백업 | 등록 정보 점검, ZIP 백업 다운로드 |
| AI 테스트 | 브라우저에서 한국어·영어 표지판 사진 OCR, 장소 후보 표시 |
| OCR → 경로 | 사용자가 후보를 선택하면 서버에서 경로 조회 |
| 사진 보조 안내 | 구간별 다음 장소의 등록 사진 표시 |
| 카메라·AR | 미구현: 친구 프로젝트 확인 후 통합 예정 |
| 갤럭시 실기기 | 미검증 |

자세한 기록: [작업 현황](docs/PROGRESS.md) · [OCR 테스트 기록](admin-web/OCR-테스트.md)

## 실행 방법 (Windows)

Python 3.12와 Node.js 22.12 이상을 권장합니다. 서버와 웹은 별도 터미널에서 실행합니다.

### 1. 서버 설치 및 실행

프로젝트 최상위 폴더에서:

```powershell
python -m venv server\.venv
server\.venv\Scripts\python.exe -m pip install -r server\requirements.txt
server\.venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000
```

### 2. 관리자 웹 설치 및 실행

새 터미널에서:

```powershell
cd admin-web
npm.cmd ci
npm.cmd run dev
```

관리자 웹: http://127.0.0.1:5173/ · API 문서: http://127.0.0.1:8000/docs

최초 실행 시 DB는 비어 있습니다. 개인 PC에서 등록했던 DB와 백업은 저장소에 포함하지 않습니다.

### 3. 가상 회사 예제 등록 (선택)

서버가 실행 중인 상태에서 프로젝트 최상위 폴더에서:

```powershell
server\.venv\Scripts\python.exe -m pip install -r server\requirements-dev.txt
server\.venv\Scripts\python.exe scripts\seed_demo_photos.py
```

`[테스트] 가상 회사 / 2층`의 장소 4곳, 연결 3개, 생성 사진 4장을 등록합니다. `ai 듣기`는 임시 예제 이름입니다. 예제 경로는 계단까지 20m이며, 동쪽 구간을 막으면 서쪽 계단 60m로 우회합니다. 이 사진과 건물은 실제 현장이 아닙니다.

OCR 확인: **확인·점검 → 표지판 인식 테스트 → 예제 사진 사용 → 글자 인식 시작 → 후보 선택**.

## 구조와 기술

```text
관리자 웹 (React / TypeScript / Vite)
  ├─ 장소·사진·길·통행 상태 등록
  ├─ 브라우저 OCR (Tesseract.js / 한국어·영어 모델)
  └─ 장소 후보 확인 → 경로 조회
                 ↓ HTTP API
서버 (Python / FastAPI)
  ├─ SQLite: 장소·사진·연결 정보
  ├─ Dijkstra: 최단 경로·통행 불가 구간 우회
  └─ 읽기 전용 앱 API → 사용자 앱 연결 예정
```

| 폴더 | 내용 |
| --- | --- |
| `admin-web/` | 관리자 UI와 OCR 테스트 |
| `server/` | 저장·조회 API, 경로 계산, 서버 테스트 |
| `app-integration/` | 앱 연동 안내와 과거 Unity C# 예제. 최종 앱 기술 선택을 의미하지 않음 |
| `demo-assets/` | 실제 장소가 아닌 생성 예제 사진 |
| `scripts/` | 가상 회사 예제 등록 도구 |
| `design/` | 기존 설계 자료. 최신 구현 범위는 이 README와 작업 현황 기준 |

사진 OCR은 브라우저에서 수행하며 유료 AI API를 호출하지 않습니다. 설치 시 인터넷이 필요하고 OCR 실행 파일·모델은 PC 서버에서 제공합니다. 전체 웹의 오프라인 실행을 보장하는 PWA는 아닙니다.

## 앱 담당자에게

주요 조회 API는 다음과 같습니다. 상세 문서는 [서버 안내](server/README.md)를 참고하세요.

- `GET /api/app/places` — 사용 가능한 장소 목록
- `GET /api/app/places/{id}/photo` — 등록 사진
- `GET /api/app/connections` — 통행 가능한 연결
- `GET /api/app/routes/nearest-stairs?sourceId={id}` — 최단·우회 경로

선택 사항으로 `server.app_reader:app`을 `127.0.0.1:8001`에서 실행하면 관리자 쓰기 API가 없는 별도 조회 서버를 사용할 수 있습니다. `127.0.0.1`은 각 기기 자신이므로 휴대폰 연결은 별도 네트워크 설정과 실기기 검증이 필요합니다.

## 검증

```powershell
server\.venv\Scripts\python.exe -m pip install -r server\requirements-dev.txt
server\.venv\Scripts\python.exe -m unittest discover -s server -p "test_*.py"
cd admin-web
npm.cmd run build
```

PC에서 서버 테스트 34개와 웹 빌드를 확인했습니다. OCR → 후보 선택 → 가상 회사 동쪽 계단 20m 조회, 건물 변경 시 이전 경로 제거, 계단 미등록 안내, 등록 사진 표시를 브라우저에서 확인했습니다. 혼합 표지판의 일부 글자 오인식이 있어 자동 위치 확정은 하지 않습니다.

현재는 발표·개발용 시제품입니다. 실제 화재·연기를 감지하지 않으며 비상계단 입구까지의 계산은 건물 밖 대피 완료를 뜻하지 않습니다. 로그인·공개 배포·실제 재난 사용 검증도 아직 진행하지 않았습니다.
