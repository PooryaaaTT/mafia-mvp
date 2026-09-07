import express from "express";
import http from "http";
import {Server} from "socket.io";
import crypto from "crypto";
const app=express(), server=http.createServer(app), io=new Server(server);
const PORT=process.env.PORT||3000; app.use(express.static("public"));
const rooms=new Map();
const code=()=>crypto.randomBytes(3).toString("hex").toUpperCase();
const view=r=>({code:r.code,phase:r.phase,started:r.started,players:r.players.map(p=>({id:p.id,name:p.name,host:p.host,alive:p.alive}))});
const emit=c=>{const r=rooms.get(c);if(r)io.to(c).emit("room:update",view(r));};
io.on("connection",s=>{
 s.on("room:create",({name},cb)=>{let c;do{c=code()}while(rooms.has(c));const r={code:c,phase:"lobby",started:false,players:[]};r.players.push({id:s.id,name:(name||"Player").slice(0,24),host:true,alive:true,role:null});rooms.set(c,r);s.join(c);s.data.room=c;cb?.({ok:true,code:c,playerId:s.id});emit(c);});
 s.on("room:join",({code:c,name},cb)=>{c=String(c||"").trim().toUpperCase();const r=rooms.get(c);if(!r)return cb?.({ok:false,error:"اتاق پیدا نشد"});if(r.started)return cb?.({ok:false,error:"بازی شروع شده"});if(r.players.length>=12)return cb?.({ok:false,error:"اتاق پر است"});r.players.push({id:s.id,name:(name||"Player").slice(0,24),host:false,alive:true,role:null});s.join(c);s.data.room=c;cb?.({ok:true,code:c,playerId:s.id});emit(c);});
 s.on("game:start",({code:c},cb)=>{const r=rooms.get(String(c||"").toUpperCase());if(!r)return cb?.({ok:false,error:"اتاق پیدا نشد"});const me=r.players.find(p=>p.id===s.id);if(!me?.host)return cb?.({ok:false,error:"فقط میزبان"});if(r.players.length<2)return cb?.({ok:false,error:"حداقل ۲ بازیکن لازم است"});let roles;
   if(r.players.length===2){roles=["mafia","citizen"].sort(()=>Math.random()-.5);}
   else if(r.players.length===3){roles=["mafia","doctor","citizen"].sort(()=>Math.random()-.5);}
   else {roles=["mafia","doctor","detective",...Array(Math.max(1,r.players.length-3)).fill("citizen")].slice(0,r.players.length).sort(()=>Math.random()-.5);}
   r.players.forEach((p,i)=>{p.role=roles[i];p.alive=true;});r.started=true;r.phase="night";r.players.forEach(p=>io.to(p.id).emit("role:assigned",{role:p.role}));emit(r.code);cb?.({ok:true});});
 s.on("phase:set",({code:c,phase})=>{const r=rooms.get(String(c||"").toUpperCase()),me=r?.players.find(p=>p.id===s.id);if(r&&me?.host&&["day","night"].includes(phase)){r.phase=phase;emit(r.code);}});
 s.on("disconnect",()=>{const c=s.data.room,r=rooms.get(c);if(!r)return;const i=r.players.findIndex(p=>p.id===s.id),h=i>=0&&r.players[i].host;if(i>=0)r.players.splice(i,1);if(!r.players.length)rooms.delete(c);else{if(h)r.players[0].host=true;emit(c);}});
});
app.get("/health",(q,res)=>res.json({ok:true}));
server.listen(PORT,"0.0.0.0",()=>console.log("Mafia MVP running",PORT));