import express from "express";
import http from "http";
import { Server } from "socket.io";
import crypto from "crypto";

const app=express();
const server=http.createServer(app);
const io=new Server(server);
const PORT=process.env.PORT||3000;
app.use(express.static("public"));

const rooms=new Map();
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

const mkCode=()=>crypto.randomBytes(3).toString("hex").toUpperCase();
const roleTeam=r=>ROLE_META[r]?.team||"city";
const alive=r=>r.players.filter(p=>p.alive);
function winner(r){
  const a=alive(r), m=a.filter(p=>roleTeam(p.role)==="mafia").length, c=a.length-m;
  if(m===0)return "city";
  if(m>=c)return "mafia";
  return null;
}
function publicRoom(r){
  return {
    code:r.code, phase:r.phase, started:r.started, round:r.round,
    roleSetup:r.started?[]:r.roleSetup,
    announcement:r.announcement||"", winner:r.winner||null,
    players:r.players.map(p=>({id:p.id,name:p.name,avatar:p.avatar,host:p.host,alive:p.alive}))
  };
}
function emitRoom(code){
  const r=rooms.get(code);
  if(!r)return;
  io.to(code).emit("room:update",publicRoom(r));
}
function resetNight(r){r.night={kill:null,doctorSave:null,lecterSave:null,checks:{}};}
function resetVotes(r){r.votes={};}
function defaultRoles(n){
  const x=["godfather","citizen","doctor","mafia","detective","citizen","lecter","sniper","citizen","mayor","citizen","citizen"];
  return x.slice(0,n);
}
function sendPrivateState(r){
  for(const p of r.players){
    io.to(p.id).emit("player:state",{
      role:p.role,
      roleLabel:ROLE_META[p.role]?.name||"",
      team:roleTeam(p.role),
      alive:p.alive,
      phase:r.phase,
      canKill:r.phase==="night"&&p.alive&&(p.role==="godfather"||(!alive(r).some(x=>x.role==="godfather")&&p.role==="mafia")),
      canDoctor:r.phase==="night"&&p.alive&&p.role==="doctor",
      canLecter:r.phase==="night"&&p.alive&&p.role==="lecter",
      canDetect:r.phase==="night"&&p.alive&&p.role==="detective"
    });
  }
}

io.on("connection",s=>{
  s.on("room:create",({name,avatar},cb)=>{
    let code; do{code=mkCode()}while(rooms.has(code));
    const r={code,phase:"lobby",started:false,round:0,roleSetup:["godfather","citizen"],players:[],announcement:"",winner:null,votes:{}};
    r.players.push({id:s.id,name:(name||"Player").slice(0,24),avatar:avatar||"🕶️",host:true,alive:true,role:null});
    rooms.set(code,r); s.join(code); s.data.room=code;
    cb?.({ok:true,code,playerId:s.id}); emitRoom(code);
  });

  s.on("room:join",({code,name,avatar},cb)=>{
    code=String(code||"").trim().toUpperCase();
    const r=rooms.get(code);
    if(!r)return cb?.({ok:false,error:"اتاق پیدا نشد"});
    if(r.started)return cb?.({ok:false,error:"بازی شروع شده"});
    if(r.players.length>=12)return cb?.({ok:false,error:"اتاق پر است"});
    r.players.push({id:s.id,name:(name||"Player").slice(0,24),avatar:avatar||"🕶️",host:false,alive:true,role:null});
    r.roleSetup=defaultRoles(r.players.length);
    s.join(code); s.data.room=code;
    cb?.({ok:true,code,playerId:s.id}); emitRoom(code);
  });

  s.on("roles:set",({code,roles},cb)=>{
    const r=rooms.get(String(code||"").toUpperCase()), me=r?.players.find(p=>p.id===s.id);
    if(!r||!me?.host)return cb?.({ok:false,error:"فقط میزبان"});
    if(r.started)return cb?.({ok:false,error:"بازی شروع شده"});
    if(!Array.isArray(roles)||roles.length!==r.players.length)return cb?.({ok:false,error:"تعداد نقش‌ها باید برابر تعداد بازیکن‌ها باشد"});
    if(roles.some(x=>!ROLE_META[x]))return cb?.({ok:false,error:"نقش نامعتبر"});
    if(!roles.some(x=>roleTeam(x)==="mafia")||!roles.some(x=>roleTeam(x)==="city"))return cb?.({ok:false,error:"حداقل یک نقش مافیا و یک نقش شهر لازم است"});
    r.roleSetup=roles; emitRoom(r.code); cb?.({ok:true});
  });

  s.on("game:start",({code},cb)=>{
    const r=rooms.get(String(code||"").toUpperCase());
    if(!r)return cb?.({ok:false,error:"اتاق پیدا نشد"});
    const me=r.players.find(p=>p.id===s.id);
    if(!me?.host)return cb?.({ok:false,error:"فقط میزبان"});
    if(r.players.length<2)return cb?.({ok:false,error:"حداقل ۲ بازیکن لازم است"});
    if(r.roleSetup.length!==r.players.length)return cb?.({ok:false,error:"ترکیب نقش‌ها را کامل کن"});
    const roles=[...r.roleSetup].sort(()=>Math.random()-.5);
    r.players.forEach((p,i)=>{p.role=roles[i];p.alive=true;});
    r.started=true;r.phase="night";r.round=1;r.announcement="شب اول شروع شد";r.winner=null;
    resetNight(r);resetVotes(r);
    r.players.forEach(p=>io.to(p.id).emit("role:assigned",{role:p.role,label:ROLE_META[p.role].name,team:roleTeam(p.role)}));
    emitRoom(r.code);sendPrivateState(r);cb?.({ok:true});
  });

  s.on("night:action",({code,type,targetId},cb)=>{
    const r=rooms.get(String(code||"").toUpperCase()), me=r?.players.find(p=>p.id===s.id), target=r?.players.find(p=>p.id===targetId);
    if(!r||r.phase!=="night"||!me?.alive||!target?.alive)return cb?.({ok:false,error:"اکشن نامعتبر"});
    if(type==="kill"){
      const hasGodfather=alive(r).some(p=>p.role==="godfather");
      if(!(me.role==="godfather"||(!hasGodfather&&me.role==="mafia")))return cb?.({ok:false,error:"این نقش اجازه شلیک ندارد"});
      if(roleTeam(target.role)==="mafia")return cb?.({ok:false,error:"نمی‌توانی مافیا را هدف بگیری"});
      r.night.kill=target.id; cb?.({ok:true,message:"هدف مافیا ثبت شد"});
    }else if(type==="doctor"){
      if(me.role!=="doctor")return cb?.({ok:false,error:"فقط دکتر"});
      r.night.doctorSave=target.id; cb?.({ok:true,message:"نجات دکتر ثبت شد"});
    }else if(type==="lecter"){
      if(me.role!=="lecter")return cb?.({ok:false,error:"فقط دکتر لکتر"});
      if(roleTeam(target.role)!=="mafia")return cb?.({ok:false,error:"لکتر فقط مافیا را نجات می‌دهد"});
      r.night.lecterSave=target.id; cb?.({ok:true,message:"نجات لکتر ثبت شد"});
    }else if(type==="detect"){
      if(me.role!=="detective")return cb?.({ok:false,error:"فقط کارآگاه"});
      if(target.id===me.id)return cb?.({ok:false,error:"خودت را نمی‌توانی استعلام بگیری"});
      r.night.checks[me.id]=target.id;
      io.to(me.id).emit("detective:result",{targetId:target.id,name:target.name,isMafia:roleTeam(target.role)==="mafia"});
      cb?.({ok:true,message:"نتیجه استعلام ارسال شد"});
    }else cb?.({ok:false,error:"اکشن ناشناخته"});
  });

  s.on("night:resolve",({code},cb)=>{
    const r=rooms.get(String(code||"").toUpperCase()), me=r?.players.find(p=>p.id===s.id);
    if(!r||!me?.host||r.phase!=="night")return cb?.({ok:false,error:"فقط میزبان در شب"});
    let msg="شب بدون کشته تمام شد.";
    const t=r.players.find(p=>p.id===r.night.kill);
    if(t&&t.alive){
      const saved=r.night.doctorSave===t.id||r.night.lecterSave===t.id;
      if(saved) msg="هدف شب نجات پیدا کرد.";
      else {t.alive=false;msg=t.name+" در شب کشته شد.";}
    }
    r.winner=winner(r);
    if(r.winner){r.phase="ended";r.announcement=(r.winner==="mafia"?"مافیا":"شهر")+" برنده شد!";emitRoom(r.code);sendPrivateState(r);return cb?.({ok:true});}
    r.phase="day";r.announcement=msg;resetVotes(r);emitRoom(r.code);sendPrivateState(r);cb?.({ok:true});
  });

  s.on("day:vote",({code,targetId},cb)=>{
    const r=rooms.get(String(code||"").toUpperCase()), me=r?.players.find(p=>p.id===s.id), target=r?.players.find(p=>p.id===targetId);
    if(!r||r.phase!=="day"||!me?.alive||!target?.alive)return cb?.({ok:false,error:"رأی نامعتبر"});
    r.votes[me.id]=target.id;cb?.({ok:true,message:"رأی ثبت شد"});
  });

  s.on("day:resolve",({code},cb)=>{
    const r=rooms.get(String(code||"").toUpperCase()), me=r?.players.find(p=>p.id===s.id);
    if(!r||!me?.host||r.phase!=="day")return cb?.({ok:false,error:"فقط میزبان در روز"});
    const counts={};Object.values(r.votes).forEach(id=>counts[id]=(counts[id]||0)+1);
    const ranked=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    let msg="رأی‌گیری بدون حذف تمام شد.";
    if(ranked.length){
      const top=ranked[0][1], tied=ranked.filter(x=>x[1]===top);
      if(tied.length===1){
        const p=r.players.find(x=>x.id===tied[0][0]);
        if(p&&p.alive){p.alive=false;msg=p.name+" با رأی شهر حذف شد.";}
      }else msg="رأی مساوی شد؛ کسی حذف نشد.";
    }
    r.winner=winner(r);
    if(r.winner){r.phase="ended";r.announcement=(r.winner==="mafia"?"مافیا":"شهر")+" برنده شد!";emitRoom(r.code);sendPrivateState(r);return cb?.({ok:true});}
    r.round++;r.phase="night";r.announcement=msg+" — شب "+r.round+" شروع شد.";resetNight(r);resetVotes(r);emitRoom(r.code);sendPrivateState(r);cb?.({ok:true});
  });

  s.on("rtc:offer",({to,offer})=>io.to(to).emit("rtc:offer",{from:s.id,offer}));
  s.on("rtc:answer",({to,answer})=>io.to(to).emit("rtc:answer",{from:s.id,answer}));
  s.on("rtc:ice",({to,candidate})=>io.to(to).emit("rtc:ice",{from:s.id,candidate}));

  s.on("disconnect",()=>{
    const code=s.data.room,r=rooms.get(code);if(!r)return;
    const i=r.players.findIndex(p=>p.id===s.id),wasHost=i>=0&&r.players[i].host;
    if(i>=0)r.players.splice(i,1);
    if(!r.players.length)rooms.delete(code);
    else{if(wasHost)r.players[0].host=true;if(!r.started)r.roleSetup=defaultRoles(r.players.length);emitRoom(code);sendPrivateState(r);}
  });
});

app.get("/health",(req,res)=>res.json({ok:true}));
server.listen(PORT,"0.0.0.0",()=>console.log("Mafia MVP running",PORT));