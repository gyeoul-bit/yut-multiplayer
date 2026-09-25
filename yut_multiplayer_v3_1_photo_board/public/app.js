const socket=io();
const $=id=>document.getElementById(id);
let myId=null,state=null;

// 사진 속 실제 윷판의 이동 경로 좌표(%)
// 0~27은 바깥쪽 사각형 + 대각선 경로를 이어서 사용합니다.
const points=[
  // 바깥쪽: 좌상단 → 우상단 → 우하단 → 좌하단 → 좌상단
  {x:3.5,y:5.5},{x:20,y:5.5},{x:36.5,y:5.5},{x:53,y:5.5},{x:69.5,y:5.5},{x:96.5,y:5.5},
  {x:96.5,y:25.5},{x:96.5,y:45.5},{x:96.5,y:65.5},{x:96.5,y:85.5},{x:96.5,y:98.5},
  {x:80,y:98.5},{x:64,y:98.5},{x:48,y:98.5},{x:32,y:98.5},{x:17,y:98.5},{x:3.5,y:98.5},
  {x:3.5,y:82},{x:3.5,y:62},{x:3.5,y:42},{x:3.5,y:22},
  // 대각선: 좌상단 → 중앙 → 우하단
  {x:18,y:22},{x:35,y:42},{x:50,y:50},{x:65,y:60},{x:82,y:82},
  // 대각선 교차 지점에서 우상단 방향을 지원
  {x:82,y:22},{x:65,y:42},{x:50,y:50}
];

function buildBoard(){
  const b=$("board");
  b.innerHTML="";
  // 사진 자체가 윷판이므로 별도의 노드/완주 원은 만들지 않습니다.
}

function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

function render(s){
  state=s;
  const me=s.players.findIndex(p=>p.id===myId);
  $("roomInfo").textContent=`방 코드: ${s.code} · ${s.players.length}/4명`;
  $("copy").hidden=false;
  $("players").innerHTML=s.players.map((p,i)=>`<div class="player" style="border-left-color:${p.color}">${i===s.turn&&s.started?"▶ ":""}${esc(p.name)}</div>`).join("");
  $("status").textContent=s.started?`현재 차례: ${s.players[s.turn]?.name||"-"}`:"2명 이상 모이면 게임을 시작할 수 있습니다.";
  $("roll").disabled=!s.started||me!==s.turn;
  $("start").disabled=s.players.length<2||s.started;
  $("restart").disabled=!s.started;
  $("history").innerHTML=s.history.slice().reverse().map(x=>`<div>• ${esc(x)}</div>`).join("");

  document.querySelectorAll(".token").forEach(x=>x.remove());
  s.players.forEach(p=>p.pieces.forEach((pos,k)=>{
    if(pos<=0||pos>=29)return;
    const q=points[(pos-1)%points.length];
    const t=document.createElement("div");
    t.className="token";
    t.style.background=p.color;
    t.style.left=`calc(${q.x}% + ${(k%2)*12}px)`;
    t.style.top=`calc(${q.y}% + ${Math.floor(k/2)*12}px)`;
    t.title=p.name;
    $("board").appendChild(t);
  }));
}

function pname(){return $("name").value.trim()||"플레이어"}
$("create").onclick=()=>socket.emit("createRoom",{name:pname()});
$("join").onclick=()=>socket.emit("joinRoom",{name:pname(),code:$("room").value});
$("start").onclick=()=>socket.emit("startGame");
$("roll").onclick=()=>socket.emit("roll");
$("restart").onclick=()=>socket.emit("restartGame");
$("copy").onclick=async()=>{
  const url=`${location.origin}/?room=${encodeURIComponent(state.code)}`;
  try{await navigator.clipboard.writeText(url);$("copy").textContent="복사 완료!";setTimeout(()=>$("copy").textContent="초대 링크 복사",1200)}
  catch{prompt("이 링크를 복사하세요:",url)}
};

socket.on("connect",()=>myId=socket.id);
socket.on("state",render);
socket.on("errorMessage",m=>alert(m));
const r=new URLSearchParams(location.search).get("room");
if(r)$("room").value=r.toUpperCase();
buildBoard();
