import express from "express";
import http from "http";
import {Server} from "socket.io";
import crypto from "crypto";

const app=express(), server=http.createServer(app), io=new Server(server);
const PORT=process.env.PORT||3000;
app.use(express.static("public"));
const rooms=new Map();

const mkCode=()=>crypto.randomBytes(3).toString("hex").toUpperCase();
const ROLE_META={
  godfather:{name:"پدرخوانده",team:"mafia"},
  mafia:{name:"مافیای ساده",team:"mafia"},
  lecter:{name:"دکتر لکتر",team:"mafia"},
  doctor:{name:"دکتر",team:"city"},
  detective:{name:"کارآگاه",team:"city"},
  sniper:{name:"تک‌تیرانداز",team:"city"},
  mayor:{name:"شهردار",team:"city"},
  citizen:{name:"شهروند",team:"city"}
};
const view=r=>({
  code:r.code,phase:r.phase,started:r.started,roleSetup:r.roleSetup,
  players:r.players.map(p=>({id:p.id,name:p.name,host:p.host,alive:p.alive,avatar:p.avatar}))
});
const emitRoom=c=>{const r=rooms.get(c);if(r)io.to(c).emit("room:update",view(r));};

io.on("connection",s=>{
  s.on("room:create",({name,avatar},cb)=>{
    let c; do{c=mkCode()}while(rooms.has(c));
    const r={code:c,phase:"lobby",started:false,roleSetup:["godfather","citizen"],players:[]};
    r.players.push({id:s.id,name:(name||"Player").slice(0,24),avatar:avatar||"🕶️",host:true,alive:true,role:null});
    rooms.set(c,r); s.join(c); s.data.room=c;
    cb?.({ok:true,code:c,playerId:s.id}); emitRoom(c);
  });

  s.on("room:join",({code:c,name,avatar},cb)=>{
    c=String(c||"").trim().toUpperCase();
    const r=rooms.get(c);
    if(!r)return cb?.({ok:false,error:"اتاق پیدا نشد"});
    if(r.started)return cb?.({ok:false,error:"بازی شروع شده"});
    if(r.players.length>=12)return cb?.({ok:false,error:"اتاق پر است"});
    r.players.push({id:s.id,name:(name||"Player").slice(0,24),avatar:avatar||"🕶️",host:false,alive:true,role:null});
    if(r.roleSetup.length!==r.players.length){
      const defaults=["godfather","citizen","doctor","mafia","detective","citizen","lecter","sniper","citizen","mayor","citizen","citizen"];
      r.roleSetup=defaults.slice(0,r.players.length);
    }
    s.join(c); s.data.room=c;
    cb?.({ok:true,code:c,playerId:s.id}); emitRoom(c);
  });

  s.on("roles:set",({code:c,roles},cb)=>{
    const r=rooms.get(String(c||"").toUpperCase());
    const me=r?.players.find(p=>p.id===s.id);
    if(!r||!me?.host)return cb?.({ok:false,error:"فقط میزبان"});
    if(r.started)return cb?.({ok:false,error:"بازی شروع شده"});
    if(!Array.isArray(roles)||roles.length!==r.players.length)return cb?.({ok:false,error:"تعداد نقش‌ها باید برابر تعداد بازیکن‌ها باشد"});
    if(roles.some(x=>!ROLE_META[x]))return cb?.({ok:false,error:"نقش نامعتبر"});
    if(!roles.some(x=>ROLE_META[x].team==="mafia"))return cb?.({ok:false,error:"حداقل یک نقش مافیا لازم است"});
    if(!roles.some(x=>ROLE_META[x].team==="city"))return cb?.({ok:false,error:"حداقل یک نقش شهر لازم است"});
    r.roleSetup=roles; emitRoom(r.code); cb?.({ok:true});
  });

  s.on("game:start",({code:c},cb)=>{
    const r=rooms.get(String(c||"").toUpperCase());
    if(!r)return cb?.({ok:false,error:"اتاق پیدا نشد"});
    const me=r.players.find(p=>p.id===s.id);
    if(!me?.host)return cb?.({ok:false,error:"فقط میزبان"});
    if(r.players.length<2)return cb?.({ok:false,error:"حداقل ۲ بازیکن لازم است"});
    if(!r.roleSetup||r.roleSetup.length!==r.players.length)return cb?.({ok:false,error:"ترکیب نقش‌ها را کامل کن"});
    const roles=[...r.roleSetup].sort(()=>Math.random()-.5);
    r.players.forEach((p,i)=>{p.role=roles[i];p.alive=true;});
    r.started=true; r.phase="night";
    r.players.forEach(p=>io.to(p.id).emit("role:assigned",{role:p.role,label:ROLE_META[p.role].name,team:ROLE_META[p.role].team}));
    emitRoom(r.code); cb?.({ok:true});
  });

  s.on("phase:set",({code:c,phase})=>{
    const r=rooms.get(String(c||"").toUpperCase()), me=r?.players.find(p=>p.id===s.id);
    if(r&&me?.host&&["day","night"].includes(phase)){r.phase=phase;emitRoom(r.code);}
  });

  s.on("disconnect",()=>{
    const c=s.data.room,r=rooms.get(c); if(!r)return;
    const i=r.players.findIndex(p=>p.id===s.id), wasHost=i>=0&&r.players[i].host;
    if(i>=0)r.players.splice(i,1);
    if(!r.players.length)rooms.delete(c);
    else{
      if(wasHost)r.players[0].host=true;
      if(!r.started){
        const defaults=["godfather","citizen","doctor","mafia","detective","citizen","lecter","sniper","citizen","mayor","citizen","citizen"];
        r.roleSetup=defaults.slice(0,r.players.length);
      }
      emitRoom(c);
    }
  });
});

app.get("/health",(q,res)=>res.json({ok:true}));
server.listen(PORT,"0.0.0.0",()=>console.log("Mafia MVP running",PORT));