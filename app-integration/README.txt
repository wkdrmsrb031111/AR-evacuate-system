[총알받이] 앱 담당자에게 전달할 서버 연동 준비 자료

1. 지금 할 작업
Unity에서 서버의 장소 목록을 받아 화면에 표시하고, 장소를 선택하면 출입문 사진을 불러온다.
제공 Unity 예제에는 AR·위치 추적·경로 계산·AI가 없다. 먼저 조회 연결만 시험한다. 서버에는 아래 경로 계산 API가 추가되어 있다.
API는 서버에서 구현·테스트했으나 제공 C# 파일은 팀의 Unity 프로젝트와 갤럭시에서 아직 실행 검증하지 않은 연동 예제다.

2. 서버와 주소
관리자 서버: PC 전용 http://127.0.0.1:8000
앱 읽기 전용 서버: 준비된 기본 실행 주소 http://127.0.0.1:8001
PC 브라우저 테스트: http://127.0.0.1:8001/app-test
두 서버는 같은 SQLite 데이터베이스를 사용한다. 읽기 전용 서버에는 관리자 수정·삭제·사진 업로드 API가 없다.

127.0.0.1은 실행 중인 기기 자신이다. 친구 PC나 갤럭시에는 서버 PC의 테스트 네트워크 주소가 필요하다. 현재 자료를 전달했다고 다른 기기에서 즉시 접속되는 것은 아니다.
현재 PC는 유선 네트워크에 연결돼 있고 Wi-Fi는 연결되지 않은 상태다. 실제 휴대폰 테스트 때 주소와 기기 간 통신 가능 여부를 다시 확인한다.
이번 준비 작업에서는 네트워크 공개 범위와 방화벽을 변경하지 않는다.

3. 앱용 조회 API (schemaVersion: 1)
GET /api/app/status
  응답: {"status":"ok","service":"AR Evacuate App API","schemaVersion":1}

GET /api/app/places
  응답: {schemaVersion, generatedAt, count, places:[...]}
  places의 각 항목:
  id: 장소 고유 UUID. 이름 대신 이 ID로 선택한 장소를 구분한다.
  building: 건물 이름(문자열).
  floor: 층 이름(문자열). 숫자라고 가정하지 않는다.
  room: 장소 이름(문자열). 회의실뿐 아니라 복도·계단·출구 이름에도 사용한다.
  kind: 장소 종류. room=일반 장소, corridor=복도·갈림길, stairs=비상계단 입구, exit=건물 밖 출구.
  kind는 추가 필드이며 기존 조회 경로·ID는 그대로다. 계단 입구는 건물 밖 대피 완료를 의미하지 않는다.
  hasPhoto: 사진 등록 여부(true/false).
  photoUrl: 사진이 있으면 "/api/app/places/{id}/photo", 없으면 null.
  photoUpdatedAt: 사진 서버 저장 시각. 없으면 null.

GET /api/app/places/{id}
  응답: {"schemaVersion":1,"place":{위와 같은 장소 항목}}

GET /api/app/places/{id}/photo
  응답: image/jpeg 이미지 바이트. JSON이 아니다.

GET /api/app/connections
  응답: {"schemaVersion":1,"count":0,"connections":[]}
  각 연결: id, sourceId, targetId, distanceMeters, forwardInstruction, reverseInstruction, bidirectional:true, createdAt, blocked, blockedReason, blockedAt.
  sourceId와 targetId는 장소 API의 id에 대응한다. source→target은 forwardInstruction, target→source는 reverseInstruction을 쓴다.
  현재 같은 건물·층의 양방향 구간만 등록한다. 삭제한 구간, 삭제한 장소가 연결된 구간, 통행 불가 구간은 제외한다.
  이 API는 구간 목록이며 최단 경로·화살표·안전 판정을 계산해 주는 API가 아니다.
  제공 Unity 예제는 장소·사진 조회용이다. 연결 API 사용 코드는 아직 포함하지 않는다.

GET /api/app/routes/nearest-stairs?sourceId={실제 장소 UUID}
  같은 건물·층의 등록된 연결 거리를 합산해 가장 가까운 stairs 장소를 찾는다. 읽기 전용 서버(8001)도 지원한다.
  응답 필드: schemaVersion:1, calculatedAt, criterion:"distanceMeters", status, source, destination, totalDistanceMeters, places, steps, message, notice.
  status: found=경로 찾음 / already_at_stairs=출발지가 계단 입구 / no_stairs=이 층에 활성 계단 미등록 / unreachable=활성 계단은 있지만 연결이 끊김.
  found: places는 출발→도착 순서의 장소 객체(id,building,floor,room,kind) 배열이며 steps는 같은 순서의 구간 배열이다.
  각 step: connectionId, fromPlaceId, toPlaceId, distanceMeters, instruction. instruction은 실제 이동 방향에 맞게 서버가 선택한다.
  already_at_stairs: 총 거리 0, places에 출발지 1개, steps는 빈 배열.
  no_stairs/unreachable: destination과 totalDistanceMeters는 null, places와 steps는 빈 배열. 200 응답이므로 status를 확인한다.
  없는/삭제된 출발지는 404, 잘못된 UUID나 누락된 sourceId는 422다.
  경로 결과를 다시 호출하면 최신 등록 데이터를 기준으로 계산한다. 삭제한 장소·구간과 다른 건물·층은 사용하지 않는다.
  관리자가 등록한 양방향 통행 불가 구간을 제외한다. 화재·연기·실제 통행 가능 여부를 자동 감지하지 않는다. stairs 도착은 건물 밖 대피 완료를 의미하지 않는다.
  제공 Unity 예제에는 이 API를 호출하거나 AR로 표시하는 코드가 아직 포함되지 않는다.

중요: 앱용 API는 삭제한 장소와 해당 사진을 제외한다. 일반 관리자용 GET /api/places를 앱에서 대신 쓰지 않는다.
photoUrl은 상대 주소이므로 서버의 기준 주소와 결합한다. 서버가 반환한 장소 ID와 경로를 그대로 사용하며 예시 UUID를 실제 데이터 ID로 하드코딩하지 않는다.
사진 404는 사진이 없거나 장소가 삭제된 경우다. 422는 잘못된 ID 형식이다. 목록을 다시 불러오고 안내 문구·대체 화면을 표시한다. 빈 목록도 정상 응답이다.

4. Unity 예제 사용
① ArEvacuateApiClient.cs를 Unity Assets/Scripts에 복사한다.
② 빈 GameObject에 ArEvacuateApiClient 컴포넌트를 붙인다.
③ 같은 PC에서 테스트한다면 Inspector의 Server Base Url을 기본값 그대로 사용한다.
④ UI 버튼 OnClick에 LoadPlaces()를 연결한다.
⑤ PlacesLoaded 이벤트에서 목록을 받아 기존 건물·층·방 선택 UI에 표시한다.
⑥ 사용자가 고른 ArEvacuatePlace를 LoadPhoto(place)에 전달한다.
⑦ PhotoLoaded 이벤트에서 받은 Texture2D를 기존 RawImage 등에 표시한다.
⑧ PhotoCleared 이벤트에서 이전 장소 사진을 숨기고 RequestFailed 이벤트에서 오류를 표시한다.
표시된 사진을 근거로 실제 위치가 자동 확인됐다고 판단하지 않는다.

JsonUtility는 public 필드가 있는 Serializable 클래스와 최상위 응답 객체를 사용한다. 예제는 API 응답을 places 배열이 들어 있는 객체로 읽는다.
Unity 개발 환경의 C# 컴파일·화면 연결·실기기 시험은 앱 담당자가 실제 프로젝트에서 진행해야 한다. Unity 버전과 UI 구성을 확인해 필요한 부분만 붙인다.

5. 나중에 갤럭시를 빌렸을 때
① 서버 PC와 갤럭시가 서로 통신 가능한 테스트 네트워크인지 확인한다.
② 서버 담당자가 로컬 테스트용 주소를 확인하고 앱 읽기 전용 서버만 해당 주소로 실행한다.
   프로젝트 최상위 폴더에서:
   server\.venv\Scripts\python.exe -m uvicorn server.app_reader:app --host <서버PC의테스트네트워크IPv4> --port 8001
   꺾쇠 부분은 실제 주소로 바꾼다. 0.0.0.0을 휴대폰에 입력하지 않는다.
③ 갤럭시 브라우저에서 http://<서버PC주소>:8001/app-test를 열어 목록 조회부터 확인한다.
④ 앱 Server Base Url을 같은 주소로 바꾼다.
⑤ 학교 네트워크 격리·Windows 방화벽·IP 변경 여부를 확인한다. 방화벽 전체 해제나 관리자 서버의 외부 공개는 하지 않는다.

HTTP 개발 연결이 Unity에서 차단되면 앱 담당자가 버전에 맞는 Player Settings를 확인한다. 공식 문서의 Allow downloads over HTTP / Development Only 설정과 Development Build를 참고하되, 실제 설정 변경은 담당자가 시험용 프로젝트에 적용한다. 배포 환경에는 HTTPS를 사용한다.
https://docs.unity.com/en-us/engine/7000.0/script-reference/unityeditor/insecurehttpoption
https://docs.unity3d.com/ja/6000.0/ScriptReference/JsonUtility.FromJson.html
https://uvicorn.dev/settings/

6. 성공 기준
관리자에서 장소 등록 → 앱 목록에 표시.
관리자에서 출입문 사진 저장 → 앱에서 같은 장소의 사진 표시.
관리자에서 장소 삭제 → 목록 재조회 시 앱에서 제외, 이전 사진 주소는 404.
서버 연결 실패 → 성공으로 표시하지 않고 오류·다시 시도 제공.

첨부 api-example.json은 형식 설명용 예시이며 실제 서버 데이터가 아니다.

추가된 우회 결과 필드:
blockedConnectionCount: 이 층의 유효한 통행 불가 구간 수.
rerouted: 차단 상태를 적용하지 않은 비교 경로가 막혀 있어 우회가 발생했는지.
destinationChanged: 우회 결과 비상계단 입구가 달라졌는지.
originalDestination: 차단 상태를 적용하지 않은 비교 경로의 목적지. 우회가 아니면 null. 과거 요청 기록이 아니다.
차단 구간은 반환되는 steps에서 제외한다. 모든 길이 끊기면 status=unreachable, destination/totalDistanceMeters=null, places/steps=[]다.
관리자 웹은 해당 화면에서 통행 상태를 저장하면 계산한 경로를 자동 재호출한다. Unity 앱에는 아직 실시간 푸시나 자동 재호출 코드가 없으므로 최신 결과가 필요할 때 경로 API를 다시 요청해야 한다.
