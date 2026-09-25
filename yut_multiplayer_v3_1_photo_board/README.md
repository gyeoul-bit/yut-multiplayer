# Yut Multiplayer V3.1

Render Web Service용 윷놀이 멀티플레이 게임입니다.

## Render 설정
- Type: Web Service
- Runtime: Node
- Build Command: npm install
- Start Command: npm start
- Root Directory: 프로젝트 파일이 저장된 위치

## GitHub 구조
package.json
server.js
render.yaml
README.md
public/
  index.html
  app.js
  style.css

V3.1에서는 Render의 PORT 환경변수와 0.0.0.0 바인딩을 사용하고 `/` 경로를 명시적으로 public/index.html로 연결합니다.
