const express=require("express"),http=require("http"),{Server}=require("socket.io"),path=require("path");
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.static(path.join(__dirname,"public")));
const rooms=new Map(),COLORS=["#e74c3c","#3498db","#27ae60","#8e44ad"];

// 29-position traditional-style route.
// 0 = off board, 20 = final outer corner, 24/28 = diagonal junctions, 29 = finish.
const POS={START:0,FINISH:29};
const ROUTE=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29];
const SHORTCUTS={5:23,10:26,15:28}; // corner/junction shortcuts

function makeGame(){return{players:[],turn:0,phase:"waiting",winner:null,last:null,msg:"방장이 게임을 시작할 수 있습니다.",history:[]}}
function state(r){return{players:r.players.map(p=>({id:p.id,name:p.name,color:p.color,pieces:p.pieces})),turn:r.turn,phase:r.phase,winner:r.winner,last:r.last,msg:r.msg,history:r.history.slice(-8)}}
function send(c){let r=rooms.get(c);if(r)io.to(c).emit("state",state(r))}
function makeCode(){let c;do c=Math.random().toString(36).slice(2,8).toUpperCase();while(rooms.has(c));return c}

function throwYut(){
  // 0 back, 1 front; four sticks. 0 = do, 1 = throw counts.
  const sticks=Array.from({length:4},()=>Math.random()<.5?0:1);
  const n=sticks.reduce((a,b)=>a+b,0);
  return {sticks,n,result:n===0?"모":n===1?"도":n===2?"개":n===3?"걸":"윷",moves:n===0?5:n,extra:n===0||n===4};
}

function advance(pos,moves){
  let p=pos;
  for(let i=0;i<moves;i++){
    p++;
    if(p>=29)return 29;
  }
  return p;
}
function routePoint(pos){
  // Visual board coordinate percentage, with branches at corners.
  const pts={
    0:[50,50],1:[15,8],2:[32,8],3:[50,8],4:[68,8],5:[85,8],
    6:[92,20],7:[92,35],8:[92,50],9:[92,65],10:[92,82],
    11:[68,92],12:[50,92],13:[32,92],14:[15,92],15:[8,82],
    16:[8,65],17:[8,50],18:[8,35],19:[8,20],20:[15,8],
    21:[32,25],22:[50,42],23:[68,59],24:[82,75],
    25:[68,25],26:[50,42],27:[32,59],28:[18,75],29:[50,50]
  };
  return pts[pos]||pts[0];
}
function occupied(r,playerIndex,pos){
  const out=[];
  r.players.forEach((p,pi)=>p.pieces.forEach((v,mi)=>{if(v===pos&&pos>0&&pos<29)out.push({pi,mi})}));
  return out;
}

io.on("connection",s=>{
 s.on("createRoom",({name})=>{
   const c=makeCode(),r=makeGame();
   r.players.push({id:s.id,name:(name||"플레이어 1").slice(0,12),color:COLORS[0],pieces:[0,0,0,0]});
   rooms.set(c,r);s.join(c);s.data.room=c;s.emit("roomCreated",c);send(c);
 });
 s.on("joinRoom",({code,name})=>{
   const c=String(code||"").toUpperCase(),r=rooms.get(c);
   if(!r)return s.emit("errorMsg","존재하지 않는 방입니다.");
   if(r.phase!=="waiting"||r.players.length>=4)return s.emit("errorMsg","게임이 시작됐거나 방이 가득 찼습니다.");
   r.players.push({id:s.id,name:(name||`플레이어 ${r.players.length+1}`).slice(0,12),color:COLORS[r.players.length],pieces:[0,0,0,0]});
   s.join(c);s.data.room=c;send(c);
 });
 s.on("startGame",()=>{
   const c=s.data.room,r=rooms.get(c);if(!r||r.players[0]?.id!==s.id||r.players.length<2)return;
   r.phase="playing";r.turn=0;r.msg=`${r.players[0].name}의 차례입니다.`;send(c);
 });
 s.on("throwYut",()=>{
   const c=s.data.room,r=rooms.get(c);if(!r||r.phase!=="playing"||r.players[r.turn]?.id!==s.id)return;
   r.last=throwYut();r.phase="select";r.msg=`${r.players[r.turn].name} → ${r.last.result}! 이동할 말을 선택하세요.`;send(c);
 });
 s.on("choosePiece",({index})=>{
   const c=s.data.room,r=rooms.get(c);if(!r||r.phase!=="select")return;
   const pi=r.turn,p=r.players[pi];if(!p||p.id!==s.id)return;
   index=Number(index);if(!Number.isInteger(index)||index<0||index>3)return;
   const old=p.pieces[index];if(old>=29)return;
   let target=advance(old,r.last.moves);
   // Branch at recognized shortcut positions.
   if(SHORTCUTS[old]!==undefined && r.last.moves>=1) target=Math.min(29,SHORTCUTS[old]+r.last.moves-1);
   // If target is occupied by opponent(s), capture all opponents there.
   const captured=[];
   r.players.forEach((op,opi)=>{
     if(opi===pi)return;
     op.pieces=op.pieces.map((v,mi)=>{
       if(v===target&&target>0&&target<29){captured.push(`${op.name} 말 ${mi+1}`);return 0}
       return v;
     });
   });
   // Stack/merge: same player's pieces on same position are considered grouped by state.
   p.pieces[index]=target;
   const count=p.pieces.filter(v=>v===target&&v>0&&v<29).length;
   const finish=p.pieces.filter(v=>v>=29).length;
   r.history.push({player:p.name,result:r.last.result,move:index+1,from:old,to:target,captured});
   if(finish===4){r.winner=p.name;r.phase="finished";r.msg=`🏆 ${p.name} 승리!`}
   else{
     const capture=captured.length>0,extra=r.last.extra||capture;
     if(!extra)r.turn=(r.turn+1)%r.players.length;
     r.phase="playing";r.msg=capture?`💥 ${p.name}이(가) 말을 잡았습니다! ${r.players[r.turn].name}의 차례입니다.`:`${r.players[r.turn].name}의 차례입니다.`;
   }
   send(c);
 });
 s.on("resetGame",()=>{
   const c=s.data.room,r=rooms.get(c);if(!r||r.players[0]?.id!==s.id)return;
   r.players.forEach(p=>p.pieces=[0,0,0,0]);r.turn=0;r.phase="waiting";r.winner=null;r.last=null;r.history=[];r.msg="새 게임을 시작할 수 있습니다.";send(c);
 });
 s.on("disconnect",()=>{
   const c=s.data.room,r=rooms.get(c);if(!r)return;
   r.players=r.players.filter(p=>p.id!==s.id);
   if(!r.players.length)rooms.delete(c);
   else{r.turn%=r.players.length;if(r.phase!=="finished")r.msg="플레이어가 나갔습니다.";send(c)}
 });
});
server.listen(process.env.PORT||3000,()=>console.log("Yut V3 running"));