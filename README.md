# 윷놀이 멀티플레이 V3

V3 주요 기능:
- 2~4인 실시간 Socket.IO 멀티플레이
- 방 코드 + 초대 링크
- 실제 윷놀이판 형태의 시각적 보드
- 윷/모/도/개/걸
- 윷/모 추가 턴
- 상대 말 잡기 + 잡으면 추가 턴
- 지름길 분기
- 말 4개와 완주
- 최근 게임 기록
- PC/휴대폰 반응형
- 간단한 윷/이동/승리 효과음
- Render 배포용 구조

실행:
npm install
npm start

브라우저:
http://localhost:3000

인터넷 배포:
GitHub에 파일을 올린 후 Render Web Service로 연결.
Build Command: npm install
Start Command: npm start

주의: 현재 V3의 '업기'는 같은 칸에 도착한 아군 말을 시각적으로 겹치게 표현하는 기본 구조이며, 개별 말의 묶음 이동/분리 규칙까지 완전한 전통 윷놀이 규칙으로 구현한 버전은 아닙니다.
