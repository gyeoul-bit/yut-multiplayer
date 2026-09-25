const socket=io(),$=id=>document.getElementById(id);let code="",myId;const pts=[[50,50],[15,10],[32,10],[50,10],[68,10],[85,10],[85,25],[85,40],[85,50],[85,60],[85,85],[68,85],[50,85],[32,85],[15,85],[15,75],[15,60],[15,50],[15,40],[15,25],[15,10],[32,25],[50,40],[68,55],[82,72],[68,25],[50,40],[32,55],[18,72],[50,50]];
$("create").onclick=()=>socket.emit("createRoom",{name:$("name").value||"플레이어"});
$("join").onclick=()=>socket.emit("joinRoom",{code:$("code").value,name:$("name").value||"플레이어"});
$("copy").onclick=async()=>{await navigator.clipboard.writeText(location.origin+"/?room="+code);$("copy").textContent="복사됨!";setTimeout(()=>$("copy").textContent="초대 링크 복사",1200)};
$("start").onclick=()=>socket.emit("startGame");$("throw").onclick=()=>{playSound("throw");socket.emit("throwYut")};$("reset").onclick=()=>socket.emit("resetGame");
const q=new URLSearchParams(location.search).get("room");if(q)$("code").value=q;
socket.on("connect",()=>myId=socket.id);socket.on("roomCreated",c=>{code=c;show()});socket.on("errorMsg",m=>$("error").textContent=m);socket.on("state",render);
function show(){$("lobby").hidden=true;$("game").hidden=false;$("roomCode").textContent=code}
function render(s){
 $("players").innerHTML=s.players.map((p,i)=>`<span class="player ${i===s.turn&&s.phase!=="waiting"?"active":""}" style="border:2px solid ${p.color}">${p.name}</span>`).join("");
 $("msg").textContent=s.msg;$("throw").disabled=!(s.phase==="playing"&&s.players[s.turn]?.id===myId);$("start").hidden=!(s.phase==="waiting"&&s.players[0]?.id===myId);$("start").disabled=s.players.length<2;$("reset").hidden=!(s.phase==="finished"&&s.players[0]?.id===myId);
 $("yut").textContent=s.last?`결과: ${s.last.result} (${s.last.n}개)`:"";$("sticks").innerHTML=s.last?s.last.sticks.map(x=>`<span class="stick">${x?"●":"○"}</span>`).join(""):"";
 $("moves").innerHTML=s.phase==="select"&&s.players[s.turn]?.id===myId?s.players[s.turn].pieces.map((v,i)=>`<button class="move" onclick="choose(${i})">말 ${i+1} · ${v>=29?"완주":v===0?"대기":v}</button>`).join(""):"";
 $("history").innerHTML=s.history.length?s.history.slice().reverse().map(h=>`<div class="log">🎯 ${h.player} · 말 ${h.move} · ${h.result} · ${h.from} → ${h.to}${h.captured.length?" · 💥 "+h.captured.join(", "):""}</div>`).join(""):"-";
 drawBoard(s);if(s.winner)playSound("win");
}
function drawBoard(s){
 $("nodes").innerHTML=pts.slice(1,29).map((p,i)=>`<div class="node" style="left:${p[0]}%;top:${p[1]}%">${i+1}</div>`).join("");
 $("tokens").innerHTML="";
 s.players.forEach((p,pi)=>p.pieces.forEach((v,mi)=>{let pos=pts[v]||pts[0],e=document.createElement("div");e.className="token";e.style.background=p.color;e.style.left=pos[0]+"%";e.style.top=pos[1]+"%";e.textContent=mi+1;e.title=p.name+" 말 "+(mi+1);$("tokens").appendChild(e)}));
}
window.choose=i=>{playSound("move");socket.emit("choosePiece",{index:i})};
let audio;
function playSound(type){try{audio=audio||new (window.AudioContext||window.webkitAudioContext)();let o=audio.createOscillator(),g=audio.createGain();o.frequency.value=type==="win"?880:type==="throw"?180:420;g.gain.value=.035;o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+.12)}catch(e){}}
