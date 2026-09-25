const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const rooms = new Map();
const SHORTCUTS = {5:23, 10:26, 15:28};

function makeCode() {
  let c;
  do { c = Math.random().toString(36).slice(2,7).toUpperCase(); }
  while (rooms.has(c));
  return c;
}
function newRoom(code) {
  return {code, players: [], turn: 0, started: false, history: []};
}
function colorFor(i) {
  return ["#e74c3c","#3498db","#2ecc71","#f1c40f"][i] || "#777";
}
function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  if (!room) return;
  room.players = room.players.filter(p => p.id !== socket.id);
  if (!room.players.length) { rooms.delete(code); return; }
  if (room.turn >= room.players.length) room.turn = 0;
  if (room.players.length < 2) room.started = false;
  broadcast(room);
}
function state(room) {
  return {
    code: room.code,
    players: room.players.map((p,i)=>({
      id:p.id,name:p.name,color:colorFor(i),pieces:p.pieces
    })),
    turn:room.turn, started:room.started,
    history:room.history.slice(-12)
  };
}
function broadcast(room) { io.to(room.code).emit("state", state(room)); }

io.on("connection", socket => {
  socket.on("createRoom", ({name}={}) => {
    leaveRoom(socket);
    const code=makeCode(), room=newRoom(code);
    room.players.push({id:socket.id,name:String(name||"플레이어").slice(0,12),pieces:[0,0,0,0]});
    rooms.set(code,room); socket.join(code); socket.data.roomCode=code; broadcast(room);
  });

  socket.on("joinRoom", ({code,name}={}) => {
    leaveRoom(socket);
    const room=rooms.get(String(code||"").trim().toUpperCase());
    if(!room) return socket.emit("errorMessage","방을 찾을 수 없습니다.");
    if(room.players.length>=4) return socket.emit("errorMessage","이 방은 이미 4명입니다.");
    room.players.push({id:socket.id,name:String(name||"플레이어").slice(0,12),pieces:[0,0,0,0]});
    socket.join(room.code); socket.data.roomCode=room.code; broadcast(room);
  });

  socket.on("startGame",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    if(room.players.length<2) return socket.emit("errorMessage","최소 2명이 필요합니다.");
    room.started=true; room.turn=0; room.history.push("게임이 시작되었습니다."); broadcast(room);
  });

  socket.on("roll",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room||!room.started) return;
    const p=room.players[room.turn];
    if(!p || p.id!==socket.id) return socket.emit("errorMessage","지금은 당신의 차례가 아닙니다.");
    const results=[["도",1,false],["개",2,false],["걸",3,false],["윷",4,true],["모",5,true]];
    const [name,move,extraRoll]=results[Math.floor(Math.random()*results.length)];
    const idx=p.pieces.findIndex(x=>x<29);
    let captured=false;
    if(idx>=0){
      let next=p.pieces[idx]+move;
      if(SHORTCUTS[next]!==undefined) next=SHORTCUTS[next];
      p.pieces[idx]=Math.min(next,29);
      const pos=p.pieces[idx];
      if(pos>0 && pos<29){
        room.players.forEach((op,i)=>{
          if(i===room.turn) return;
          op.pieces=op.pieces.map(x=>{
            if(x===pos){captured=true;return 0;} return x;
          });
        });
      }
    }
    room.history.push(`${p.name}: ${name}${captured?" (잡기!)":""}`);
    if(!extraRoll && !captured) room.turn=(room.turn+1)%room.players.length;
    broadcast(room);
  });

  socket.on("restartGame",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    room.players.forEach(p=>p.pieces=[0,0,0,0]);
    room.turn=0; room.started=true; room.history=["게임을 다시 시작했습니다."]; broadcast(room);
  });

  socket.on("disconnect",()=>leaveRoom(socket));
});

server.listen(PORT,"0.0.0.0",()=>console.log(`Yut V3.1 running on port ${PORT}`));
