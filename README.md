# Yut Multiplayer V3.1

사진형 윷판을 사용하는 2~4인 멀티플레이 윷놀이입니다.

## 적용된 규칙
- 사진 속 오른쪽 아래 노란 원을 시작점으로 사용
- 말 4개를 각각 1~4번으로 표시
- 내 말의 남은 개수 / 도착한 개수 표시
- 윷 결과가 나온 뒤 이동할 말을 직접 선택
- 이동한 말은 사진 속 원 중심에 맞춰 표시
- 상대 말이 있는 위치에 도착하면 잡기
- 잡으면 한 번 더 던지기
- 자신의 말이 있는 위치에 도착하면 업기 여부를 직접 선택
- 업은 말은 한 덩어리로 함께 이동
- 윷/모 또는 잡기 시 한 번 더 던지기
- 말 4개를 모두 도착시키면 승리

## Render 설정
- Type: Web Service
- Runtime: Node
- Build Command: npm install
- Start Command: npm start

## GitHub 구조
package.json
server.js
render.yaml
README.md
public/
  index.html
  app.js
  style.css
  yut-board.png
