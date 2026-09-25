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
const ROLLS = [["도",1,false],["개",2,false],["걸",3,false],["윷",4,true],["모",5,true]];

// 0 = 집, 30 = 완주.
// 사진 속 노드와 정확히 대응하도록 실제 좌표 이름을 사용합니다.
const N = {
  BR:"BR", B1:"B1", B2:"B2", B3:"B3", B4:"B4", BL:"BL",
  L1:"L1", L2:"L2", L3:"L3", L4:"L4", TL:"TL",
  T1:"T1", T2:"T2", T3:"T3", T4:"T4", TR:"TR",
  R1:"R1", R2:"R2", R3:"R3", R4:"R4",
  BL1:"BL1", BL2:"BL2", C:"C", TR1:"TR1", TR2:"TR2",
  TL1:"TL1", TL2:"TL2", BR1:"BR1", BR2:"BR2"
};

// 기본 바깥길: 시작(노란 원) BR -> BL -> TL -> TR -> BR(완주).
const outer = [N.BR,N.B1,N.B2,N.B3,N.B4,N.BL,N.L1,N.L2,N.L3,N.L4,N.TL,N.T1,N.T2,N.T3,N.T4,N.TR,N.R1,N.R2,N.R3,N.R4];
const outerNext = new Map();
for (let i=0;i<outer.length;i++) outerNext.set(outer[i], i===outer.length-1 ? N.BR : outer[i+1]);

// 대각선 지름길은 각 방향을 별도 노드로 관리합니다. 같은 화면 좌표를 공유하는 교차점도
// 이동 방향을 보존하기 위해 논리적으로는 별도 노드입니다.
const DIAG = {
  BL_A1:"BL_A1", BL_A2:"BL_A2", C_A:"C_A", TR_A1:"TR_A1", TR_A2:"TR_A2",
  TL_B1:"TL_B1", TL_B2:"TL_B2", C_B:"C_B", BR_B1:"BR_B1", BR_B2:"BR_B2",
  TR_C1:"TR_C1", TR_C2:"TR_C2", C_C:"C_C", BL_C1:"BL_C1", BL_C2:"BL_C2"
};
const shortcutPaths = {
  [N.BL]:[DIAG.BL_A1,DIAG.BL_A2,DIAG.C_A,DIAG.TR_A1,DIAG.TR_A2,N.TR],
  [N.TL]:[DIAG.TL_B1,DIAG.TL_B2,DIAG.C_B,DIAG.BR_B1,DIAG.BR_B2,N.BR],
  [N.TR]:[DIAG.TR_C1,DIAG.TR_C2,DIAG.C_C,DIAG.BL_C1,DIAG.BL_C2,N.BL]
};
const shortcutNext = new Map();
Object.entries(shortcutPaths).forEach(([start,path])=>{
  let prev=start;
  for(const node of path){ shortcutNext.set(prev,node); prev=node; }
});

function nextNode(pos){
  if(shortcutNext.has(pos)) return shortcutNext.get(pos);
  if(outerNext.has(pos)) return outerNext.get(pos);
  return N.BR;
}

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
    turn:room.turn, started:room.started, history:room.history.slice(-16),
    pending:room.pending ? {...room.pending} : null
  };
}
function broadcast(room){ io.to(room.code).emit("state",state(room)); }
function currentPlayer(room){ return room.players[room.turn]; }
function findPiece(p,id){ return p.pieces.find(x=>x.id===id); }
function groupAt(p,pos){ return p.pieces.find(x=>x.pos===pos && pos!==0 && pos!==30); }
function allFinished(p){ return p.pieces.every(x=>x.pos===30); }

function destinationFor(piece, roll){
  let pos=piece.pos;
  for(let i=0;i<roll;i++){
    if(pos===0) pos=N.B1;
    else pos=nextNode(pos);
  }
  if(pos===N.BR && piece.pos!==0) pos=30;
  return pos;
}

function movePiece(room, p, pieceId, roll, mergeChoice){
  const piece=findPiece(p,pieceId);
  if(!piece) return {ok:false,msg:"선택한 말이 없습니다."};
  if(piece.pos===30) return {ok:false,msg:"이미 도착한 말입니다."};

  const pos=destinationFor(piece,roll);
  // 같은 그룹의 모든 말을 함께 이동.
  const movingIds=[...piece.group];
  p.pieces.forEach(x=>{ if(movingIds.includes(x.id)) x.pos=pos; });

  // 완주한 말은 해당 위치에 남겨두고 그룹 정보는 유지.
  if(pos!==30){
    const own=groupAt(p,pos);
    if(own && !movingIds.includes(own.id)){
      if(mergeChoice===true){
        const merged=[...new Set([...own.group,...movingIds])];
        own.group=merged;
        p.pieces.forEach(x=>{ if(merged.includes(x.id)){x.pos=pos;x.group=merged;} });
      } else {
        // 업지 않으면 서로 다른 말로 유지.
        p.pieces.forEach(x=>{ if(movingIds.includes(x.id)) x.group=movingIds; });
      }
    } else {
      p.pieces.forEach(x=>{ if(movingIds.includes(x.id)) x.group=movingIds; });
    }
  }

  // 상대 말 잡기: 도착 위치의 상대 그룹 전체를 집으로 돌려보냄.
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

  return {ok:true,pos,captured,movingIds};
}

io.on("connection", socket=>{
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
    if(room.pending) return socket.emit("errorMessage","먼저 말을 선택하세요.");
    const p=currentPlayer(room);
    if(!p || p.id!==socket.id) return socket.emit("errorMessage","지금은 당신의 차례가 아닙니다.");
    const [name,move,extra]=ROLLS[Math.floor(Math.random()*ROLLS.length)];
    room.pending={roll:move,rollName:name,extraRoll:extra,playerId:p.id,selectedPiece:null};
    room.history.push(`${p.name}: ${name} (${move})`);
    broadcast(room);
  });

  socket.on("selectPiece",({pieceId}={})=>{
    const room=rooms.get(socket.data.roomCode); if(!room||!room.started||!room.pending) return;
    const p=currentPlayer(room); if(!p || p.id!==socket.id || room.pending.playerId!==socket.id) return;
    const id=Number(pieceId), piece=findPiece(p,id);
    if(!piece || piece.pos===30) return socket.emit("errorMessage","움직일 수 있는 말을 선택하세요.");
    room.pending.selectedPiece=id;
    const dest=destinationFor(piece,room.pending.roll);
    const own=dest!==30 ? groupAt(p,dest) : null;
    room.pending.mergeAvailable=!!own && !piece.group.includes(own.id);
    room.pending.destination=dest;
    broadcast(room);
  });

  socket.on("moveSelected",({merge}={})=>{
    const room=rooms.get(socket.data.roomCode); if(!room||!room.started||!room.pending) return;
    const p=currentPlayer(room); if(!p || p.id!==socket.id) return;
    const pending=room.pending;
    if(!pending.selectedPiece) return socket.emit("errorMessage","먼저 이동할 말을 선택하세요.");
    const result=movePiece(room,p,pending.selectedPiece,pending.roll,merge===true);
    if(!result.ok) return socket.emit("errorMessage",result.msg);

    room.history.push(`${p.name}: 말 ${pending.selectedPiece} ${pending.roll}칸 이동${result.captured?" · 잡기!":""}${merge===true?" · 업기":""}`);
    const won=allFinished(p);
    room.pending=null;
    if(won){
      room.started=false;
      room.history.push(`🏆 ${p.name} 승리! 말 4개를 모두 도착시켰습니다.`);
      broadcast(room); return;
    }
    // 윷/모 또는 잡기면 한 번 더, 그 외에는 다음 사람.
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
