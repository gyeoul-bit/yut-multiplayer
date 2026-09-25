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
const ROLLS = [["빽도",-1,false],["도",1,false],["개",2,false],["걸",3,false],["윷",4,true],["모",5,true]];

const N = {
  BR:"BR", B1:"B1", B2:"B2", B3:"B3", B4:"B4", BL:"BL",
  L1:"L1", L2:"L2", L3:"L3", L4:"L4", TL:"TL",
  T1:"T1", T2:"T2", T3:"T3", T4:"T4", TR:"TR",
  R1:"R1", R2:"R2", R3:"R3", R4:"R4", C:"C"
};

// 시작점 BR(사진 오른쪽 아래)에서 시계 반대방향으로 한 칸씩 이동합니다.
// 화면 좌표 기준으로 BR -> R4 -> R3 -> R2 -> R1 -> TR -> ... -> BL -> BR 입니다.
const outer = [N.BR,N.R4,N.R3,N.R2,N.R1,N.TR,N.T4,N.T3,N.T2,N.T1,N.TL,N.L4,N.L3,N.L2,N.L1,N.BL,N.B4,N.B3,N.B2,N.B1];
const outerNext = new Map();
const outerPrev = new Map();
for(let i=0;i<outer.length;i++){
  outerNext.set(outer[i], outer[(i+1)%outer.length]);
  outerPrev.set(outer[i], outer[(i-1+outer.length)%outer.length]);
}

// 대각선은 실제 사진의 X 경로에 맞춥니다.
const DIAG = {
  BR1:"BR1", BR2:"BR2", C1:"C1", TL2:"TL2", TL3:"TL3",
  TL1:"TL1", TL_C:"TL_C", C2:"C2", BR3:"BR3", BR4:"BR4",
  TR1:"TR1", TR2:"TR2", C3:"C3", BL2:"BL2", BL3:"BL3",
  BL1:"BL1", BL_C:"BL_C", C4:"C4", TR3:"TR3", TR4:"TR4"
};

const diagPaths = {
  [N.BR]: [DIAG.BR1, DIAG.BR2, DIAG.C1, DIAG.TL2, DIAG.TL3, N.TL],
  [N.TL]: [DIAG.TL1, DIAG.TL_C, DIAG.C2, DIAG.BR3, DIAG.BR4, N.BR],
  [N.TR]: [DIAG.TR1, DIAG.TR2, DIAG.C3, DIAG.BL2, DIAG.BL3, N.BL],
  [N.BL]: [DIAG.BL1, DIAG.BL_C, DIAG.C4, DIAG.TR3, DIAG.TR4, N.TR]
};

const diagNext = new Map();
for(const [start,path] of Object.entries(diagPaths)){
  let prev=start;
  for(const node of path){ diagNext.set(prev,node); prev=node; }
}

const diagPos = new Set(Object.values(DIAG));
const allPos = new Set([...outer, N.C, ...diagPos]);

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
  return {
    code:room.code,
    players:room.players.map((p,i)=>({id:p.id,name:p.name,color:colorFor(i),pieces:publicPieces(p)})),
    turn:room.turn, started:room.started, history:room.history.slice(-18),
    pending:room.pending ? {...room.pending} : null
  };
}
function broadcast(room){ io.to(room.code).emit("state",state(room)); }
function currentPlayer(room){ return room.players[room.turn]; }
function findPiece(p,id){ return p.pieces.find(x=>x.id===id); }
function groupAt(p,pos){ return p.pieces.find(x=>x.pos===pos && pos!==0 && pos!==30); }
function allFinished(p){ return p.pieces.every(x=>x.pos===30); }
function hasAnyOnBoard(p){ return p.pieces.some(x=>x.pos!==0 && x.pos!==30); }

function normalNext(pos, choice){
  if(pos===0) return N.BR;
  if(choice==="diag" && diagNext.has(pos)) return diagNext.get(pos);
  if(diagNext.has(pos) && diagPos.has(pos)) return diagNext.get(pos);
  if(outerNext.has(pos)) return outerNext.get(pos);
  return N.BR;
}

function backwardOne(pos){
  if(pos===0) return null;
  if(pos===30) return null;
  if(outerPrev.has(pos)) return outerPrev.get(pos);
  // 대각선 위에서는 반대 방향으로 한 칸 물러납니다.
  for(const [from,to] of diagNext.entries()) if(to===pos) return from;
  if(pos===N.C) return null;
  return null;
}

function destinationFor(piece, roll, choice){
  if(roll===-1){
    if(piece.pos===0) return null;
    return backwardOne(piece.pos);
  }
  let pos=piece.pos;
  let branchChoiceUsed=false;
  for(let i=0;i<roll;i++){
    if(pos===0){
      // 출발점에서 첫 칸은 사진 오른쪽 아래 노란색 BR입니다.
      pos=N.BR;
      continue;
    }
    const next=normalNext(pos, !branchChoiceUsed ? choice : null);
    branchChoiceUsed=true;
    pos=next;
    if(pos===N.BR && i<roll-1) {
      // BR을 지나면 완주 처리. 실제 이동은 BR 도착 순간 완주입니다.
      return 30;
    }
  }
  // 한 바퀴를 돌아 BR에 도착하면 완주.
  if(pos===N.BR && piece.pos!==0) return 30;
  return pos;
}

function movePiece(room,p,pieceId,roll,choice,mergeChoice){
  const piece=findPiece(p,pieceId);
  if(!piece) return {ok:false,msg:"선택한 말이 없습니다."};
  if(piece.pos===30) return {ok:false,msg:"이미 도착한 말입니다."};
  if(roll===-1 && piece.pos===0) return {ok:false,msg:"출발점의 말은 빽도로 이동할 수 없습니다."};

  const pos=destinationFor(piece,roll,choice);
  if(pos===null || pos===undefined) return {ok:false,msg:"이동할 수 없습니다."};

  const movingIds=[...piece.group];
  p.pieces.forEach(x=>{ if(movingIds.includes(x.id)) x.pos=pos; });

  let merged=false;
  if(pos!==30){
    const own=groupAt(p,pos);
    if(own && !movingIds.includes(own.id) && mergeChoice===true){
      const mergedIds=[...new Set([...own.group,...movingIds])];
      p.pieces.forEach(x=>{ if(mergedIds.includes(x.id)){x.pos=pos;x.group=mergedIds;} });
      merged=true;
    } else {
      p.pieces.forEach(x=>{ if(movingIds.includes(x.id)) x.group=movingIds; });
    }
  }

  let captured=false;
  if(pos!==30){
    room.players.forEach((op,idx)=>{
      if(idx===room.turn) return;
      const hit=groupAt(op,pos);
      if(hit){
        captured=true;
        op.pieces.forEach(x=>{ if(hit.group.includes(x.id)){ x.pos=0; x.group=[x.id]; } });
      }
    });
  }

  return {ok:true,pos,captured,movingIds,merged};
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

    // 빽도인데 판 위에 말이 하나도 없으면 기회가 취소됩니다.
    if(move===-1 && !hasAnyOnBoard(p)){
      room.history.push(`${p.name}: 빽도 · 판에 말이 없어 기회가 취소되었습니다.`);
      room.turn=(room.turn+1)%room.players.length;
      broadcast(room); return;
    }

    room.pending={roll:move,rollName:name,extraRoll:extra,playerId:p.id,selectedPiece:null,choice:null,mergeAvailable:false,directionOptions:null};
    room.history.push(`${p.name}: ${name}`);
    broadcast(room);
  });

  socket.on("selectPiece",({pieceId}={})=>{
    const room=rooms.get(socket.data.roomCode); if(!room||!room.started||!room.pending) return;
    const p=currentPlayer(room); if(!p || p.id!==socket.id || room.pending.playerId!==socket.id) return;
    const id=Number(pieceId), piece=findPiece(p,id);
    if(!piece || piece.pos===30) return socket.emit("errorMessage","움직일 수 있는 말을 선택하세요.");
    if(room.pending.roll===-1 && piece.pos===0) return socket.emit("errorMessage","빽도는 출발점에 있는 말을 선택할 수 없습니다.");

    room.pending.selectedPiece=id;
    room.pending.choice=null;
    room.pending.destination=null;
    room.pending.mergeAvailable=false;

    const cornerChoices=[0,N.BR,N.TL,N.TR,N.BL];
    if(room.pending.roll>0 && cornerChoices.includes(piece.pos)){
      room.pending.directionOptions=["straight","diag"];
    } else {
      room.pending.directionOptions=null;
      room.pending.choice="straight";
    }
    broadcast(room);
  });

  socket.on("chooseDirection",({direction}={})=>{
    const room=rooms.get(socket.data.roomCode); if(!room||!room.pending) return;
    const p=currentPlayer(room); if(!p || p.id!==socket.id) return;
    if(!room.pending.selectedPiece) return socket.emit("errorMessage","먼저 말을 선택하세요.");
    if(!["straight","diag"].includes(direction)) return;
    const piece=findPiece(p,room.pending.selectedPiece);
    if(!piece) return;
    if(direction==="diag" && piece.pos!==0 && !diagPaths[piece.pos]) return socket.emit("errorMessage","이 위치에서는 대각선 이동을 선택할 수 없습니다.");
    room.pending.choice=direction;
    room.pending.destination=destinationFor(piece,room.pending.roll,direction);
    const dest=room.pending.destination;
    const own=dest!==30 && dest!==null ? groupAt(p,dest) : null;
    room.pending.mergeAvailable=!!own && !piece.group.includes(own.id);
    broadcast(room);
  });

  socket.on("moveSelected",({merge}={})=>{
    const room=rooms.get(socket.data.roomCode); if(!room||!room.started||!room.pending) return;
    const p=currentPlayer(room); if(!p || p.id!==socket.id) return;
    const pending=room.pending;
    if(!pending.selectedPiece) return socket.emit("errorMessage","먼저 이동할 말을 선택하세요.");
    if(pending.roll>0 && pending.directionOptions && !pending.choice) return socket.emit("errorMessage","직진 또는 대각선을 선택하세요.");

    const piece=findPiece(p,pending.selectedPiece);
    const choice=pending.choice||"straight";
    const result=movePiece(room,p,pending.selectedPiece,pending.roll,choice,merge===true);
    if(!result.ok) return socket.emit("errorMessage",result.msg);

    const directionText=pending.roll>0&&pending.directionOptions?(choice==="diag"?" · 대각선":" · 직진"):"";
    room.history.push(`${p.name}: 말 ${pending.selectedPiece} ${pending.roll===-1?"빽도":pending.roll+"칸"} 이동${directionText}${result.captured?" · 잡기!":""}${result.merged?" · 업기":""}`);
    const won=allFinished(p);
    room.pending=null;
    if(won){
      room.started=false;
      room.history.push(`🏆 ${p.name} 승리! 말 4개를 모두 도착시켰습니다.`);
      broadcast(room); return;
    }
    // 윷/모 또는 잡기면 한 번 더. 빽도는 추가 기회가 없습니다.
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
