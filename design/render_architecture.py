from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent
im = Image.new('RGB', (1720, 1080), '#F6FAFB')
d = ImageDraw.Draw(im)

def font(size, bold=False):
    return ImageFont.truetype('C:/Windows/Fonts/malgunbd.ttf' if bold else 'C:/Windows/Fonts/malgun.ttf', size)

def text(x,y,value,size=25,fill='#23424B',bold=False):
    d.multiline_text((x,y),value,font=font(size,bold),fill=fill,spacing=14)

def card(rect,title,subtitle,body):
    d.rounded_rectangle(rect,22,fill='white',outline='#C9DDE0',width=2)
    x,y,r,b=rect
    d.rounded_rectangle((x+22,y+24,x+142,y+61),10,fill='#E4F3ED')
    text(x+38,y+27,'구현 완료',21,fill='#157A63',bold=True)
    text(x+28,y+90,title,34,bold=True)
    text(x+28,y+146,subtitle,23,fill='#557B76')
    d.line((x+28,y+196,r-28,y+196),fill='#E3EDEF',width=2)
    text(x+28,y+221,body,25)

def arrow(x1,y,x2,label,reverse=False):
    d.line((x1,y,x2,y),fill='#188B78',width=4)
    if reverse: d.polygon([(x1,y),(x1+14,y-8),(x1+14,y+8)],fill='#188B78')
    else: d.polygon([(x2,y),(x2-14,y-8),(x2-14,y+8)],fill='#188B78')
    text(x1+10,y-43,label,22,fill='#537A73')

text(60,40,'Frontend & Backend Server Design',46,bold=True)
text(60,111,'총알받이 · AI·AR 기반 실내 대피 안내 서비스',28,fill='#56757D')
text(60,162,'현재 구현 범위: 관리자 장소·출입문 사진 서버 저장',24,fill='#56757D')
card((60,235,500,715),'관리자 웹','React · TypeScript · Vite','장소 등록·수정·목록\n삭제 확인·삭제 장소 복원\n사진 선택·미리보기·저장\n서버 연결 상태·오류 표시')
card((640,235,1080,715),'로컬 API 서버','Python · FastAPI · Uvicorn','입력·중복 이름 검증\n장소·사진 API 처리\n사진 검증·JPG 변환\n기존 데이터 복사·응답')
card((1220,235,1660,715),'데이터베이스','SQLite · 서버 PC에 보관','places: 장소·삭제 상태\nphotos: JPG·파일명·시각\nsettings: DB 식별 값\n장소 ID로 사진 연결')
arrow(500,410,640,'요청')
arrow(500,502,640,'응답',True)
arrow(1080,410,1220,'저장')
arrow(1080,502,1220,'조회',True)
text(88,658,'127.0.0.1:5173',23,fill='#5F7E85')
text(668,658,'127.0.0.1:8000',23,fill='#5F7E85')
text(1248,658,'evacuate.sqlite3',23,fill='#5F7E85')
d.rounded_rectangle((60,760,1660,890),18,fill='#E6F2EE')
text(86,780,'실제 데이터 흐름',27,bold=True)
text(86,829,'장소·사진 입력  →  /api 요청  →  서버 검증  →  SQLite 저장  →  결과를 화면에 표시',27)
d.rounded_rectangle((60,920,1660,1035),18,fill='#EFF2F5',outline='#D3DBE1',width=2)
text(86,935,'다음 단계 · 아직 구현하지 않은 기능',26,bold=True,fill='#657785')
text(86,982,'Android 앱 연결·앱용 조회 API   /   이동 지점·통로·대피 경로   /   AI 초안·관리자 승인',24,fill='#657785')
im.save(OUT/'frontend_backend_architecture.png')
print(OUT/'frontend_backend_architecture.png')
