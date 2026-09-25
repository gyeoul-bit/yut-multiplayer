const socket=io();
const $=id=>document.getElementById(id);
let myId=null,state=null;

// yut-board.png 274x294 기준. 모든 말의 중심점을 실제 사진 속 원 중심에 맞춥니다.
const P={
  BR:{x:94.16,y:95.24}, B1:{x:76.28,y:95.24}, B2:{x:57.66,y:95.24}, B3:{x:39.42,y:95.24}, B4:{x:21.17,y:95.24}, BL:{x:4.74,y:95.24},
  L1:{x:4.74,y:80.27}, L2:{x:4.74,y:61.56}, L3:{x:4.74,y:42.86}, L4:{x:4.74,y:23.81}, TL:{x:4.74,y:7.48},
  T1:{x:21.17,y:7.48}, T2:{x:39.42,y:7.48}, T3:{x:57.66,y:7.48}, T4:{x:76.28,y:7.48}, TR:{x:94.16,y:7.48},
  R1:{x:94.16,y:23.81}, R2:{x:94.16,y:42.86}, R3:{x:94.16,y:61.56}, R4:{x:94.16,y:80.27},
  BL_A1:{x:21.17,y:80.27}, BL_A2:{x:35.77,y:61.56}, C_A:{x:50,y:50.34}, TR_A1:{x:63.50,y:42.86}, TR_A2:{x:76.28,y:23.81},
  TL_B1:{x:21.17,y:23.81}, TL_B2:{x:35.77,y:42.86}, C_B:{x:50,y:50.34}, BR_B1:{x:63.50,y:61.56}, BR_B2:{x:76.28,y:80.27},
  TR_C1:{x:76.28,y:23.81}, TR_C2:{x:63.50,y:42.86}, C_C:{x:50,y:50.34}, BL_C1:{x:35.77,y:61.56}, BL_C2:{x:21.17,y:80.27}
};

function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function isMine(){return state?.players.findIndex(p=>p.id===myId)===state?.turn}
function me(){return state?.players.find(p=>p.id===myId)}
function posKey(pos){return P[pos] ? pos : null}
function groupLabel(piece){return piece.group.slice().sort((a,b)=>a-b).join("+")}

function render(s){
  state=s;
  const mine=me();
  const myIndex=s.players.findIndex(p=>p.id===myId);
  const myTurn=s.started && myIndex===s.turn;
  const pendingMine=s.pending && s.pending.playerId===myId;

  $("roomInfo").textContent=`방 코드: ${s.code} · ${s.players.length}/4명`;
  $("copy").hidden=false;
  $("players").innerHTML=s.players.map((p,i)=>{
    const remaining=p.pieces.filter(x=>x.pos!==30).length;
    return `<div class="player ${i===s.turn&&s.started?'active':''}" style="border-left-color:${p.color}">${i===s.turn&&s.started?'▶ ':''}${esc(p.name)} <span>${remaining}개 남음</span></div>`;
  }).join("");

  if(mine){
    const remaining=mine.pieces.filter(x=>x.pos!==30).length;
    const arrived=4-remaining;
    $("myPieces").innerHTML=`<div class="piece-summary"><b>내 말</b> · ${remaining}개 남음 · ${arrived}개 도착</div>`+
      mine.pieces.map(x=>`<button class="piece-chip ${x.pos===30?'done':''} ${pendingMine&&s.pending.selectedPiece===x.id?'selected':''}" data-piece="${x.id}">말 ${x.id}${x.group.length>1?` · 업힌 말 ${groupLabel(x)}`:''} ${x.pos===30?'✓':''}</button>`).join("");
    document.querySelectorAll(".piece-chip").forEach(btn=>btn.onclick=()=>{
      if(myTurn && s.pending) socket.emit("selectPiece",{pieceId:Number(btn.dataset.piece)});
    });
  } else $("myPieces").innerHTML="";

  $("status").textContent=s.started
    ? (myTurn ? (s.pending ? `윷 결과: ${s.pending.rollName} · 이동할 말 ${s.pending.selectedPiece?'선택됨':'선택하세요'}` : "내 차례입니다. 윷을 던지세요.") : `현재 차례: ${esc(s.players[s.turn]?.name||'-')}`)
    : (s.history.some(x=>x.includes("승리!")) ? s.history[s.history.length-1] : "2명 이상 모이면 게임을 시작할 수 있습니다.");

  $("roll").disabled=!s.started||!myTurn||!!s.pending;
  $("start").disabled=s.players.length<2||s.started;
  $("restart").disabled=!s.players.length;

  const mp=$("movePanel");
  if(s.pending && myTurn){
    mp.classList.remove("hidden");
    $("moveText").textContent=s.pending.selectedPiece
      ? `말 ${s.pending.selectedPiece} 선택 · ${s.pending.rollName} ${s.pending.roll}칸`
      : `윷 결과: ${s.pending.rollName} · 이동할 말 1~4를 선택하세요.`;
    $("moveBtn").classList.toggle("hidden",!s.pending.selectedPiece || s.pending.mergeAvailable);
    $("mergeBtn").classList.toggle("hidden",!s.pending.selectedPiece || !s.pending.mergeAvailable);
    $("separateBtn").classList.toggle("hidden",!s.pending.selectedPiece || !s.pending.mergeAvailable);
  } else mp.classList.add("hidden");

  $("history").innerHTML=s.history.slice().reverse().map(x=>`<div>• ${esc(x)}</div>`).join("");

  document.querySelectorAll(".token").forEach(x=>x.remove());
  s.players.forEach((p,pi)=>{
    const groups=new Map();
    p.pieces.forEach(piece=>{
      if(piece.pos===0||piece.pos===30) return;
      const key=`${piece.pos}:${piece.group.slice().sort((a,b)=>a-b).join(',')}`;
      if(!groups.has(key)) groups.set(key,piece);
    });
    let groupIndex=0;
    groups.forEach(piece=>{
      const q=P[posKey(piece.pos)]; if(!q) return;
      const t=document.createElement("button");
      t.className=`token ${pi===myIndex?'mine-token':''} ${s.pending?.selectedPiece && piece.group.includes(s.pending.selectedPiece)?'token-selected':''}`;
      t.style.background=p.color;
      const stack=piece.group.slice().sort((a,b)=>a-b);
      t.textContent=stack.length>1?stack.join('·'):String(stack[0]);
      t.title=`${p.name} · 말 ${stack.join(', ')}`;
      const spread=[[-5,-5],[5,-5],[-5,5],[5,5]];
      const off=spread[groupIndex%spread.length]; groupIndex++;
      t.style.left=`calc(${q.x}% + ${off[0]}px)`;
      t.style.top=`calc(${q.y}% + ${off[1]}px)`;
      if(myTurn && s.pending && p.id===myId) t.onclick=()=>socket.emit("selectPiece",{pieceId:stack[0]});
      $("board").appendChild(t);
    });
  });
}

$("create").onclick=()=>socket.emit("createRoom",{name:$("name").value.trim()||"플레이어"});
$("join").onclick=()=>socket.emit("joinRoom",{name:$("name").value.trim()||"플레이어",code:$("room").value});
$("start").onclick=()=>socket.emit("startGame");
$("roll").onclick=()=>socket.emit("roll");
$("restart").onclick=()=>socket.emit("restartGame");
$("moveBtn").onclick=()=>socket.emit("moveSelected",{merge:false});
$("mergeBtn").onclick=()=>socket.emit("moveSelected",{merge:true});
$("separateBtn").onclick=()=>socket.emit("moveSelected",{merge:false});
$("copy").onclick=async()=>{
  const url=`${location.origin}/?room=${encodeURIComponent(state.code)}`;
  try{await navigator.clipboard.writeText(url);$("copy").textContent="복사 완료!";setTimeout(()=>$("copy").textContent="초대 링크 복사",1200)}catch{prompt("이 링크를 복사하세요:",url)}
};
socket.on("connect",()=>myId=socket.id);
socket.on("state",render);
socket.on("errorMessage",m=>alert(m));
const r=new URLSearchParams(location.search).get("room"); if(r)$("room").value=r.toUpperCase();
