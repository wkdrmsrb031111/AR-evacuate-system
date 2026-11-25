# AR Evacuate 로컬 API 서버

장소·사진을 이 PC의 `data/evacuate.sqlite3`에 저장합니다. 사진은 JPG BLOB으로 같은 데이터베이스에 저장해 장소·사진 복사를 한 트랜잭션으로 처리합니다. 데이터 폴더와 가상환경은 Git에서 제외됩니다.

## 설치 (프로젝트 최상위 폴더)

```powershell
python -m venv server\.venv
server\.venv\Scripts\python.exe -m pip install -r server\requirements.txt
```

## 실행 (터미널 1)

```powershell
server\.venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000
```

웹은 별도 터미널에서 `admin-web` 폴더로 이동해 `npm.cmd run dev`로 실행합니다. 관리자 주소는 http://127.0.0.1:5173/ 입니다. 종료는 각각 Ctrl+C입니다.

기존 브라우저 데이터가 있으면 관리자 화면에서 **기존 데이터 서버로 복사**를 누릅니다. 브라우저 원본은 지우지 않습니다. 같은 복사를 반복해도 이미 있는 ID·사진을 덮어쓰지 않습니다. 이름 충돌 또는 파일 오류가 있으면 전체 복사를 취소하므로 일부만 복사되지 않습니다.

## 현재 범위

- 장소 목록·등록·수정·삭제(휴지통)·복원
- 장소별 사진 저장·메타데이터·사진 응답, 서버의 이미지 검증·크기 축소
- 서버 재시작 후에도 저장 유지
- 서버가 꺼져 있으면 웹에서 오류를 표시하고 성공으로 처리하지 않음
- 현재는 이 PC 전용. 로그인·인터넷 배포·휴대폰 네트워크 연결은 별도 단계

API 문서: http://127.0.0.1:8000/docs

| 기능 | 메서드·경로 |
| --- | --- |
| 연결 상태 | GET /api/status |
| 장소 목록 (삭제한 장소 포함) | GET /api/places |
| 장소 생성 | POST /api/places |
| 이름 수정 | PUT /api/places/{id} |
| 휴지통 이동 | DELETE /api/places/{id} |
| 복원 | POST /api/places/{id}/restore |
| 사진 정보 (없으면 null) | GET /api/places/{id}/photo |
| 사진 JPG | GET /api/places/{id}/photo/content |
| 사진 저장 | PUT /api/places/{id}/photo (multipart: file, name) |
| 브라우저 백업 복사 | POST /api/import (multipart: manifest, files) |

장소 JSON은 `id, building, floor, room, kind, createdAt, deletedAt?` 형식입니다. 승인 문구 API는 아직 구현하지 않았습니다.

## 앱용 조회 API

`GET /api/app/status`, `GET /api/app/places`, `GET /api/app/places/{id}`, `GET /api/app/places/{id}/photo`를 구현했습니다. 삭제한 장소와 사진은 앱용 응답에서 제외됩니다. 브라우저에서 `/app-test`를 열어 같은 API를 시험할 수 있습니다.

프로젝트 최상위 폴더의 `앱조회서버_실행.cmd`는 같은 DB를 읽는 **별도의 읽기 전용 서버**를 `127.0.0.1:8001`로 실행합니다. 이 서버에는 관리자 API가 없으며, 실제 SQLite 연결도 읽기 전용입니다. 현재 기본 실행은 PC 내부 테스트용입니다. 네트워크·방화벽 설정은 변경하지 않았습니다.

Unity 예제, API 응답 예시, 친구에게 전달할 안내는 `../app-integration/`에 있습니다. 실제 갤럭시·다른 PC에서의 연결과 Unity 예제 실행 검증은 아직 하지 않았습니다.

## 테스트

```powershell
server\.venv\Scripts\python.exe -m pip install -r server\requirements-dev.txt
server\.venv\Scripts\python.exe -m unittest discover -s server -p "test_*.py" -v
```

테스트는 별도의 임시 DB를 사용하고 실제 저장 DB를 변경하지 않습니다. 백업하려면 서버 종료 후 `data/evacuate.sqlite3` 파일을 복사하세요.


## 이동 구간 API

관리자: `GET /api/connections`, `POST /api/connections`, `PUT /api/connections/{id}`, `DELETE /api/connections/{id}`, `POST /api/connections/{id}/restore`.

앱 조회 전용: `GET /api/app/connections` → `{schemaVersion:1,count,connections:[...]}`.
각 구간은 `id, sourceId, targetId, distanceMeters, forwardInstruction, reverseInstruction`과 양방향 `Direction, FacingHint, SignText`, `bidirectional:true, createdAt`을 포함합니다. 관리자 응답에는 삭제된 구간의 `deletedAt`이 추가됩니다.
같은 건물·층의 활성 장소 두 곳만 연결할 수 있으며 반대 순서의 중복도 금지합니다. 거리는 0 초과 1000m 이하, 안내 문장은 방향마다 1~300자입니다. 삭제한 구간과 삭제한 장소에 연결된 구간은 앱에서 제외합니다. 층간 연결은 미구현입니다. 통행 불가 상태는 아래 API로 관리합니다. 같은 층의 최단 거리 계산은 아래 API를 사용합니다.


## 가장 가까운 비상계단 입구 API

`GET /api/app/routes/nearest-stairs?sourceId={UUID}` (관리자 서버와 앱 읽기 전용 서버 모두 지원). 같은 건물·층의 활성 구간을 양방향 그래프로 만들고 Dijkstra 알고리즘으로 가장 가까운 `stairs` 장소를 찾습니다. 기준은 등록된 거리의 합이며 동률은 장소 ID 순으로 안정적으로 하나를 고릅니다. 입력 데이터는 하나의 읽기 트랜잭션에서 조회합니다.

응답: `schemaVersion, calculatedAt, criterion, status, source, destination, totalDistanceMeters, places, steps, message, notice`. 단계별 `instruction`은 source→target 또는 역방향 안내 중 실제 이동 방향에 맞는 문장입니다.

`status`는 `found`, `already_at_stairs`(0m), `no_stairs`(이 층에 계단 미등록), `unreachable`(계단은 있으나 연결이 끊김)입니다. 경로가 없으면 destination/totalDistanceMeters는 null, places/steps는 빈 배열입니다. 모두 정상적인 계산 결과이므로 HTTP 200입니다. 없는/삭제된 출발지는 404, 잘못되거나 누락된 UUID는 422입니다. 삭제한 장소·구간, 다른 층·건물은 제외합니다. 관리자가 등록한 통행 불가 구간을 제외하며 화재·연기·실제 통행 가능 여부를 자동 판단하지 않는 시연용 계산입니다.


## 통행 불가 상태 API

`PATCH /api/connections/{id}/availability` 요청: `{blocked: true, reason: "통로 장애물"}`. blocked는 JSON boolean이며 true일 때 1~200자의 사유가 필요합니다. false로 해제하면 사유는 빈 문자열, 시각은 null이 됩니다. 삭제된 연결은 409, 삭제된 장소가 연결된 구간은 422입니다. 앱 읽기 전용 서버는 이 쓰기 API를 제공하지 않습니다.

연결 JSON에 `blocked, blockedReason, blockedAt`을 추가합니다. 기존 구간은 blocked=false로 이전되며 ID·거리·안내는 유지합니다. 편집·삭제 후 복원도 차단 상태를 보존합니다. 앱의 `GET /api/app/connections`는 차단 구간을 아예 제외합니다.

경로 결과에 `blockedConnectionCount, rerouted, destinationChanged, originalDestination`이 추가됩니다. 해당 층의 유효한 차단 구간 수를 제공하며, 차단 구간이 무관하면 rerouted=false입니다. 우회 여부는 동일 데이터에서 차단 상태를 적용하지 않은 최단 경로와 비교해 판단합니다. originalDestination은 그 비교 경로의 목적지이며 과거 요청 기록이 아닙니다. 실제 반환 steps에는 차단 구간이 절대 포함되지 않습니다. 모든 길이 끊기면 unreachable과 빈 경로를 반환합니다.


## 관리자 시연 데이터 점검 API

`GET /api/checks/demo-readiness`는 관리자 서버(8000)의 조회 전용 API입니다. 앱 조회 서버(8001)에는 제공하지 않습니다. 한 읽기 트랜잭션에서 활성 일반 장소의 경로를 기존 계산기로 확인하고 모든 활성 장소의 사진 등록 여부를 집계합니다. 데이터를 수정하지 않으며 응답은 Cache-Control: no-store입니다.

응답: `schemaVersion, checkedAt, summary, checks, missingPhotoPlaces, notice`. summary는 `activePlaceCount, roomCount, reachableRoomCount, needsRouteCount, missingPhotoCount`입니다. checks의 각 항목은 `place, status, destination, totalDistanceMeters, message, rerouted, blockedConnectionCount`이며 상태는 found/no_stairs/unreachable입니다. 계단·복도·출구는 출발 일반 장소 점검에서 제외하지만 사진 집계에는 포함합니다. 삭제한 장소와 사진은 집계에서 제외합니다. 빈 데이터는 0개와 빈 배열로 응답하며 준비 완료 판정을 하지 않습니다. 사진 누락은 경로 계산 오류와 구분합니다.


## 백업 다운로드 API

관리자 서버의 `GET /api/backup`은 `application/zip` 첨부 파일을 반환하며 앱 조회 서버에는 제공하지 않습니다. SQLite backup API로 일관된 복사본을 만든 뒤 그 복사본에서 JSON·사진·데이터베이스를 압축합니다. 원본 데이터는 수정하지 않습니다. 응답은 Cache-Control: no-store입니다.

`data.json`은 format=ar-evacuate-backup, formatVersion=1, exportedAt(UTC), databaseId, summary, places, connections, photos를 포함합니다. 사진 원래 이름은 메타데이터로만 보관하고 ZIP 경로는 순번 이름을 사용하며 SHA-256을 기록합니다. 삭제 기록과 차단 상태도 보존합니다. 스냅샷 SQLite 파일은 ZIP 안의 database/evacuate.sqlite3에 있으며 사진 BLOB도 포함합니다.

테스트: 빈 ZIP 데이터, 사진·경로·삭제·차단 상태 보존, 원본 미변경, ZIP CRC, 사진 해시, SQLite integrity_check를 검증했습니다. 관리자 웹 복원 API/UI는 아직 구현하지 않았습니다.
