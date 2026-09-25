const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const rooms = new Map();
const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f"];
const ROLLS = [["빽도", -1, false], ["도", 1, false], ["개", 2, false], ["걸", 3, false], ["윷", 4, true], ["모", 5, true]];

const N = {
  BR:"BR", B1:"B1", B2:"B2", B3:"B3", B4:"B4", BL:"BL",
  L1:"L1", L2:"L2", L3:"L3", L4:"L4", TL:"TL",
  T1:"T1", T2:"T2", T3:"T3", T4:"T4", TR:"TR",
  R1:"R1", R2:"R2", R3:"R3", R4:"R4"
};

// BR(노란색 원)은 '출발 대기 위치'일 뿐 1칸이 아닙니다.
// 실제 1칸은 BR 바로 위의 R4입니다. 이후 시계 반대방향으로 이동합니다.
const outer = [N.R4,N.R3,N.R2,N.R1,N.TR,N.T4,N.T3,N.T2,N.T1,N.TL,N.L4,N.L3,N.L2,N.L1,N.BL,N.B4,N.B3,N.B2,N.B1];
const outerNext = new Map();
const outerPrev = new Map();
for(let i=0;i<outer.length;i++){
  outerNext.set(outer[i], outer[i+1] || null); // null = BR 도착 = 완주
  outerPrev.set(outer[i], i===0 ? "START" : outer[i-1]);
}

const D = {
  BR1:"BR1", BR2:"BR2", C1:"C1", TL2:"TL2", TL3:"TL3",
  TL1:"TL1", TL_C:"TL_C", C2:"C2", BR3:"BR3", BR4:"BR4",
  TR1:"TR1", TR2:"TR2", C3:"C3", BL2:"BL2", BL3:"BL3",
  BL1:"BL1", BL_C:"BL_C", C4:"C4", TR3:"TR3", TR4:"TR4"
};

// 대각선의 순방향. 각 corner -> center -> 반대 corner.
const diagonal = {
  [N.BR]: [D.BR1,D.BR2,D.C1,D.TL2,D.TL3,N.TL],
  [N.TL]: [D.TL1,D.TL_C,D.C2,D.BR3,D.BR4,N.BR],
  [N.TR]: [D.TR1,D.TR2,D.C3,D.BL2,D.BL3,N.BL],
  [N.BL]: [D.BL1,D.BL_C,D.C4,D.TR3,D.TR4,N.TR]
};
const diagNext = new Map();
for(const [start,path] of Object.entries(diagonal)){
  let from=start;
  for(const to of path){ diagNext.set(`${from}>${to}`, to); from=to; }
}

const DIAG_INFO = new Map([
  [D.BR1,{kind:"diag",dir:"BR-TL",prev:N.BR,next:D.BR2,center:D.C1}],
  [D.BR2,{kind:"diag",dir:"BR-TL",prev:D.BR1,next:D.C1,center:D.C1}],
  [D.C1,{kind:"center",dir:"BR-TL",prev:D.BR2,next:D.TL2}],
  [D.TL2,{kind:"diag",dir:"BR-TL",prev:D.C1,next:D.TL3,center:D.C1}],
  [D.TL3,{kind:"diag",dir:"BR-TL",prev:D.TL2,next:N.TL,center:D.C1}],
  [D.TL1,{kind:"diag",dir:"TL-BR",prev:N.TL,next:D.TL_C,center:D.C2}],
  [D.TL_C,{kind:"diag",dir:"TL-BR",prev:D.TL1,next:D.C2,center:D.C2}],
  [D.C2,{kind:"center",dir:"TL-BR",prev:D.TL_C,next:D.BR3}],
  [D.BR3,{kind:"diag",dir:"TL-BR",prev:D.C2,next:D.BR4,center:D.C2}],
  [D.BR4,{kind:"diag",dir:"TL-BR",prev:D.BR3,next:N.BR,center:D.C2}],
  [D.TR1,{kind:"diag",dir:"TR-BL",prev:N.TR,next:D.TR2,center:D.C3}],
  [D.TR2,{kind:"diag",dir:"TR-BL",prev:D.TR1,next:D.C3,center:D.C3}],
  [D.C3,{kind:"center",dir:"TR-BL",prev:D.TR2,next:D.BL2}],
  [D.BL2,{kind:"diag",dir:"TR-BL",prev:D.C3,next:D.BL3,center:D.C3}],
  [D.BL3,{kind:"diag",dir:"TR-BL",prev:D.BL2,next:N.BL,center:D.C3}],
  [D.BL1,{kind:"diag",dir:"BL-TR",prev:N.BL,next:D.BL_C,center:D.C4}],
  [D.BL_C,{kind:"diag",dir:"BL-TR",prev:D.BL1,next:D.C4,center:D.C4}],
  [D.C4,{kind:"center",dir:"BL-TR",prev:D.BL_C,next:D.TR3}],
  [D.TR3,{kind:"diag",dir:"BL-TR",prev:D.C4,next:D.TR4,center:D.C4}],
  [D.TR4,{kind:"diag",dir:"BL-TR",prev:D.TR3,next:N.TR,center:D.C4}]
]);

const allBoardPos = new Set([...outer, ...Object.values(D)]);
const corners = new Set([N.BR,N.TR,N.TL,N.BL]);
const centerNodes = new Set([D.C1,D.C2,D.C3,D.C4]);

function makeCode(){ let c; do c=Math.random().toString(36).slice(2,7).toUpperCase(); while(rooms.has(c)); return c; }
function newRoom(code){ return {code,players:[],turn:0,started:false,history:[],pending:null}; }
function colorFor(i){ return COLORS[i] || "#777"; }
function playerPieces(){ return [1,2,3,4].map(id=>({id,pos:0,group:[id]})); }
function leaveRoom(socket){
  const code=socket.data.roomCode; if(!code) return;
  const room=rooms.get(code); socket.leave(code); socket.data.roomCode=null; if(!room) return;
  room.players=room.players.filter(p=>p.id!==socket.id);
  if(!room.players.length){ rooms.delete(code); return; }
  if(room.turn>=room.players.length) room.turn=0;
  room.pending=null;
  if(room.players.length<2) room.started=false;
  broadcast(room);
}
function publicPieces(p){ return p.pieces.map(x=>({id:x.id,pos:x.pos,group:[...x.group]})); }
function state(room){
  return {code:room.code,players:room.players.map((p,i)=>({id:p.id,name:p.name,color:colorFor(i),pieces:publicPieces(p)})),turn:room.turn,started:room.started,history:room.history.slice(-18),pending:room.pending?{...room.pending}:null};
}
function broadcast(room){ io.to(room.code).emit("state",state(room)); }
function currentPlayer(room){ return room.players[room.turn]; }
function findPiece(p,id){ return p.pieces.find(x=>x.id===id); }
function groupAt(p,pos){ return p.pieces.find(x=>x.pos===pos && pos!==0 && pos!==30); }
function allFinished(p){ return p.pieces.every(x=>x.pos===30); }
function hasAnyOnBoard(p){ return p.pieces.some(x=>x.pos!==0 && x.pos!==30); }

function outerNextPos(pos){ return outerNext.get(pos) || null; }
function outerPrevPos(pos){ return outerPrev.get(pos) || null; }
function diagonalNextPos(pos, dir){
  const paths = {
    "BR-TL": [N.BR,D.BR1,D.BR2,D.C1,D.TL2,D.TL3,N.TL],
    "TL-BR": [N.TL,D.TL1,D.TL_C,D.C2,D.BR3,D.BR4,N.BR],
    "TR-BL": [N.TR,D.TR1,D.TR2,D.C3,D.BL2,D.BL3,N.BL],
    "BL-TR": [N.BL,D.BL1,D.BL_C,D.C4,D.TR3,D.TR4,N.TR]
  };
  const path=paths[dir]; if(!path) return null;
  const centers={
    "BR-TL":D.C1,"TL-BR":D.C2,"TR-BL":D.C3,"BL-TR":D.C4
  };
  // 사진의 중심은 같은 원이지만 내부적으로는 대각선별 ID가 다릅니다.
  if(centerNodes.has(pos)){
    const ci=path.indexOf(centers[dir]);
    if(ci>=0) return path[ci+1] || null;
    return centers[dir];
  }
  const i=path.indexOf(pos); return i>=0 ? (path[i+1] || null) : null;
}
function otherCenterDirs(center){
  const map={
    [D.C1]: ["BR-TL","TR-BL","BL-TR"],
    [D.C2]: ["TL-BR","TR-BL","BL-TR"],
    [D.C3]: ["TR-BL","BR-TL","TL-BR"],
    [D.C4]: ["BL-TR","BR-TL","TL-BR"]
  };
  return map[center] || [];
}

// 일반 이동은 외곽선을 따라갑니다. corner에서만 대각선 진입을 선택할 수 있습니다.
// 출발 대기점(0)은 대각선 선택 대상이 아닙니다.
function nextStep(pos, route){
  if(pos===0) return N.R4; // 노란 출발점은 0칸, R4가 1칸
  if(pos===30) return 30;
  if(route && route.type==="diag") return diagonalNextPos(pos,route.dir);
  return outerNextPos(pos);
}

function routeOptionsAt(pos, currentRoute){
  if(pos===0) return [];
  // 외곽 corner에서는 '직진(외곽)' / '대각선' 선택.
  if(corners.has(pos)){
    const dirs = {BR:"BR-TL",TL:"TL-BR",TR:"TR-BL",BL:"BL-TR"};
    return [{id:"straight",label:"직진",route:{type:"outer"}},{id:"diag",label:"대각선",route:{type:"diag",dir:dirs[pos]}}];
  }
  // 대각선 중간점(C)에 도착하면 현재 대각선을 계속 직진하거나 다른 대각선으로 전환할 수 있게 합니다.
  if(centerNodes.has(pos)){
    const currentDir=currentRoute?.dir || DIAG_INFO.get(pos)?.dir;
    const others=otherCenterDirs(pos).filter(d=>d!==currentDir);
    const opts=[{id:"straight",label:"직진",route:{type:"diag",dir:currentDir}}];
    if(others[0]) opts.push({id:"diag",label:"대각선",route:{type:"diag",dir:others[0]}});
    return opts;
  }
  return [];
}

function destinationFor(piece, roll, route){
  if(roll===-1){
    if(piece.pos===0) return null; // 출발점 빽도는 왼쪽으로 나가지 않고 취소
    if(piece.pos===30) return null;
    if(centerNodes.has(piece.pos) || DIAG_INFO.has(piece.pos)){
      const info=DIAG_INFO.get(piece.pos);
      if(info && info.prev===N.BR) return 0;
      if(info && info.prev) return info.prev;
    }
    const prev=outerPrevPos(piece.pos);
    return prev==="START" ? 0 : prev;
  }

  let pos=piece.pos;
  let activeRoute=route || {type:"outer"};
  for(let step=0;step<roll;step++){
    // 대각선 경로의 끝에 도달하면 해당 반대편 corner에 도착합니다.
    if(pos===30) return 30;
    const next=nextStep(pos,activeRoute);
    if(next===null){
      // 외곽 마지막 칸(B1)에서 다음은 BR(출발점)이며 완주입니다.
      return 30;
    }
    if(next===N.BR && activeRoute.type==="diag") return 30;
    pos=next;
    // route choice는 corner/center에서 다시 선택할 수 있습니다. 단, 마지막 칸에 도착하면 더 묻지 않습니다.
    if(step<roll-1 && routeOptionsAt(pos,activeRoute).length) return {needsChoice:true,pos,stepsUsed:step+1,remaining:roll-step-1,currentRoute:activeRoute};
    if(activeRoute.type==="diag" && corners.has(pos)) activeRoute={type:"outer"};
  }
  return pos;
}

function moveWithPending(room,p,mergeChoice){
  const pending=room.pending;
  const piece=findPiece(p,pending.selectedPiece);
  if(!piece) return {ok:false,msg:"선택한 말이 없습니다."};
  if(piece.pos===30) return {ok:false,msg:"이미 도착한 말입니다."};
  if(pending.directionOptions?.length) return {ok:false,msg:"직진 또는 대각선을 먼저 선택하세요."};

  let dest=pending.destination;
  if(dest===null || dest===undefined){
    dest=pending.roll===-1 ? destinationFor(piece,-1,null) : destinationFor(piece,pending.roll,pending.route||{type:"outer"});
    if(dest && typeof dest==="object") return {ok:false,msg:"중간 경로를 선택하세요."};
  }
  if(dest===null || dest===undefined) return {ok:false,msg:"이동할 수 없습니다."};

  const movingIds=[...piece.group];
  p.pieces.forEach(x=>{ if(movingIds.includes(x.id)) x.pos=dest; });
  let merged=false;
  if(dest!==30){
    const own=groupAt(p,dest);
    if(own && !movingIds.includes(own.id) && mergeChoice===true){
      const mergedIds=[...new Set([...own.group,...movingIds])];
      p.pieces.forEach(x=>{ if(mergedIds.includes(x.id)){x.pos=dest;x.group=mergedIds;} });
      merged=true;
    } else {
      p.pieces.forEach(x=>{ if(movingIds.includes(x.id)) x.group=movingIds; });
    }
  }
  let captured=false;
  if(dest!==30){
    room.players.forEach((op,idx)=>{
      if(idx===room.turn) return;
      const hit=groupAt(op,dest);
      if(hit){
        captured=true;
        op.pieces.forEach(x=>{ if(hit.group.includes(x.id)){x.pos=0;x.group=[x.id];} });
      }
    });
  }
  return {ok:true,pos:dest,captured,movingIds,merged};
}

io.on("connection",socket=>{
  socket.on("createRoom",({name}={})=>{
    leaveRoom(socket); const code=makeCode(), room=newRoom(code);
    room.players.push({id:socket.id,name:String(name||"플레이어").slice(0,12),pieces:playerPieces()});
    rooms.set(code,room); socket.join(code); socket.data.roomCode=code; broadcast(room);
  });
  socket.on("joinRoom",({code,name}={})=>{
    leaveRoom(socket); const room=rooms.get(String(code||"").trim().toUpperCase());
    if(!room) return socket.emit("errorMessage","방을 찾을 수 없습니다.");
    if(room.players.length>=4) return socket.emit("errorMessage","이 방은 이미 4명입니다.");
    room.players.push({id:socket.id,name:String(name||"플레이어").slice(0,12),pieces:playerPieces()});
    socket.join(room.code); socket.data.roomCode=room.code; broadcast(room);
  });
  socket.on("startGame",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    if(room.players.length<2) return socket.emit("errorMessage","최소 2명이 필요합니다.");
    room.started=true; room.turn=0; room.pending=null; room.history.push("게임이 시작되었습니다."); broadcast(room);
  });
  socket.on("roll",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room||!room.started) return;
    if(room.pending) return socket.emit("errorMessage","먼저 말을 선택하고 이동하세요.");
    const p=currentPlayer(room);
    if(!p || p.id!==socket.id) return socket.emit("errorMessage","지금은 당신의 차례가 아닙니다.");
    const [name,move,extra]=ROLLS[Math.floor(Math.random()*ROLLS.length)];
    if(move===-1 && !hasAnyOnBoard(p)){
      room.history.push(`${p.name}: 빽도 · 판 위에 말이 없어 기회가 취소되었습니다.`);
      room.turn=(room.turn+1)%room.players.length;
      broadcast(room); return;
    }
    room.pending={roll:move,rollName:name,extraRoll:extra,playerId:p.id,selectedPiece:null,route:null,directionOptions:null,mergeAvailable:false,awaitingRoute:false,routeAt:null,remaining:null,destination:null};
    room.history.push(`${p.name}: ${name}`); broadcast(room);
  });
  socket.on("selectPiece",({pieceId}={})=>{
    const room=rooms.get(socket.data.roomCode); if(!room||!room.started||!room.pending) return;
    const p=currentPlayer(room); if(!p || p.id!==socket.id || room.pending.playerId!==socket.id) return;
    const id=Number(pieceId), piece=findPiece(p,id);
    if(!piece || piece.pos===30) return socket.emit("errorMessage","움직일 수 있는 말을 선택하세요.");
    if(room.pending.roll===-1 && piece.pos===0) return socket.emit("errorMessage","출발점의 말은 빽도로 왼쪽으로 이동할 수 없습니다.");
    room.pending.selectedPiece=id;
    room.pending.route=null; room.pending.awaitingRoute=false; room.pending.routeAt=null; room.pending.remaining=null; room.pending.destination=null;
    room.pending.directionOptions=routeOptionsAt(piece.pos,null);
    if(!room.pending.directionOptions.length) room.pending.route={type:"outer"};
    const preview=room.pending.roll>0 ? destinationFor(piece,room.pending.roll,room.pending.route) : destinationFor(piece,-1,null);
    if(preview && typeof preview==="object" && preview.needsChoice){
      // 대각선으로 이동하다 중간점에 도착한 경우, 먼저 중간점에 말을 놓고 다음 경로를 선택하게 합니다.
      p.pieces.forEach(x=>{ if(piece.group.includes(x.id)) x.pos=preview.pos; });
      room.pending.awaitingRoute=true; room.pending.routeAt=preview.pos; room.pending.remaining=preview.remaining;
      room.pending.directionOptions=routeOptionsAt(preview.pos,preview.currentRoute); room.pending.route=preview.currentRoute;
      room.pending.destination=null;
    } else {
      room.pending.destination=preview;
    }
    const dest=room.pending.destination;
    const own=dest!==30&&dest!==null&&dest!==undefined&&typeof dest!=="object"?groupAt(p,dest):null;
    room.pending.mergeAvailable=!!own && !piece.group.includes(own.id);
    broadcast(room);
  });
  socket.on("chooseDirection",({direction}={})=>{
    const room=rooms.get(socket.data.roomCode); if(!room||!room.pending) return;
    const p=currentPlayer(room); if(!p || p.id!==socket.id) return;
    const pending=room.pending;
    if(!pending.selectedPiece) return socket.emit("errorMessage","먼저 말을 선택하세요.");
    const opts=pending.directionOptions||[];
    const picked=opts.find(x=>x.id===direction);
    if(!picked) return socket.emit("errorMessage","현재 위치에서는 그 이동을 선택할 수 없습니다.");
    pending.route=picked.route;
    pending.directionOptions=null;
    pending.awaitingRoute=false;
    pending.routeAt=null;
    const piece=findPiece(p,pending.selectedPiece);
    const steps=pending.remaining || pending.roll;
    let preview=steps>0?destinationFor(piece,steps,pending.route):destinationFor(piece,-1,null);
    if(preview && typeof preview==="object" && preview.needsChoice){
      p.pieces.forEach(x=>{ if(piece.group.includes(x.id)) x.pos=preview.pos; });
      pending.awaitingRoute=true; pending.routeAt=preview.pos; pending.remaining=preview.remaining;
      pending.directionOptions=routeOptionsAt(preview.pos,preview.route); pending.route=preview.route; pending.destination=null;
    } else {
      pending.remaining=null; pending.destination=preview;
    }
    const dest=pending.destination;
    const own=dest!==null&&dest!==undefined&&dest!==30?groupAt(p,dest):null;
    pending.mergeAvailable=!!own && !piece.group.includes(own.id);
    broadcast(room);
  });
  socket.on("moveSelected",({merge}={})=>{
    const room=rooms.get(socket.data.roomCode); if(!room||!room.started||!room.pending) return;
    const p=currentPlayer(room); if(!p || p.id!==socket.id) return;
    const pending=room.pending;
    if(!pending.selectedPiece) return socket.emit("errorMessage","먼저 이동할 말을 선택하세요.");
    if(pending.directionOptions?.length) return socket.emit("errorMessage","직진 또는 대각선을 먼저 선택하세요.");
    const result=moveWithPending(room,p,merge===true);
    if(!result.ok){
      if(result.awaitingChoice) return broadcast(room);
      return socket.emit("errorMessage",result.msg);
    }
    room.history.push(`${p.name}: 말 ${pending.selectedPiece} ${pending.roll===-1?"빽도":pending.roll+"칸"} 이동${result.captured?" · 잡기!":""}${result.merged?" · 업기":""}`);
    const won=allFinished(p);
    room.pending=null;
    if(won){ room.started=false; room.history.push(`🏆 ${p.name} 승리! 말 4개를 모두 도착시켰습니다.`); broadcast(room); return; }
    if(!(pending.extraRoll || result.captured)) room.turn=(room.turn+1)%room.players.length;
    broadcast(room);
  });
  socket.on("restartGame",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    room.players.forEach(p=>p.pieces=playerPieces()); room.turn=0; room.started=true; room.pending=null; room.history=["게임을 다시 시작했습니다."]; broadcast(room);
  });
  socket.on("disconnect",()=>leaveRoom(socket));
});

server.listen(PORT,"0.0.0.0",()=>console.log(`Yut V3.1 running on port ${PORT}`));
