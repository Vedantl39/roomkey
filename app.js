(function(){
"use strict";

/* ================= crypto: notes are encrypted in the browser with a key made from the room PIN ================= */
const enc=new TextEncoder(), dec=new TextDecoder();
const CHECK="roomkey:ok";
const b64e=buf=>{ const b=new Uint8Array(buf); let s=""; for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s); };
const b64d=str=>{ const s=atob(str); const b=new Uint8Array(s.length); for(let i=0;i<s.length;i++) b[i]=s.charCodeAt(i); return b; };
const cryptoOk=!!(window.crypto&&crypto.subtle&&crypto.getRandomValues);
async function deriveKey(pin, saltB64){
  const base=await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2", salt:b64d(saltB64), iterations:250000, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
}
async function seal(key, text){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, enc.encode(text));
  return {iv:b64e(iv), ct:b64e(ct)};
}
async function unseal(key, box){
  return dec.decode(await crypto.subtle.decrypt({name:"AES-GCM", iv:b64d(box.iv)}, key, b64d(box.ct)));
}
function randomPin(){ return String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0"); }
const CODE_ALPHA="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(){ const a=crypto.getRandomValues(new Uint8Array(6)); return Array.from(a,x=>CODE_ALPHA[x%CODE_ALPHA.length]).join(""); }
const CODE_RE=/^[A-Z2-9]{6}$/;

/* ================= helpers ================= */
function h(tag, attrs, kids){
  const el=document.createElement(tag);
  if(attrs) for(const k in attrs){
    const v=attrs[k]; if(v==null||v===false) continue;
    if(k==="class") el.className=v;
    else if(k==="text") el.textContent=v;
    else if(k.startsWith("on")) el.addEventListener(k.slice(2),v);
    else el.setAttribute(k, v===true?"":v);
  }
  (kids||[]).forEach(c=>{ if(c==null||c===false) return; el.append(c.nodeType?c:document.createTextNode(String(c))); });
  return el;
}
const $=id=>document.getElementById(id);
let toastT;
function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2200); }
async function copy(text, btn){
  try{ await navigator.clipboard.writeText(text); }
  catch(e){
    const ta=h("textarea",{style:"position:fixed;opacity:0"}); ta.value=text; document.body.append(ta); ta.select();
    let ok=false; try{ ok=document.execCommand("copy"); }catch(_){}
    ta.remove(); if(!ok){ toast("Couldn't copy. Select the text and copy it."); return; }
  }
  if(btn){ const o=btn.textContent; btn.textContent="Copied"; btn.classList.add("ok"); setTimeout(()=>{btn.textContent=o;btn.classList.remove("ok");},1200); }
}
function safeHttp(u){ try{ const x=new URL(u); return (x.protocol==="https:"||x.protocol==="http:")?x.href:null; }catch(e){ return null; } }
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,v); }catch(e){} }
function ago(t){ if(!t) return ""; const s=Math.round((Date.now()-t)/1000); if(s<5) return "just now"; if(s<60) return s+"s ago"; return Math.round(s/60)+" min ago"; }
const fmtPin=p=>p.replace(/(\d{3})(\d{3})/,"$1 $2");
const roomLink=code=>location.origin+location.pathname+"#"+code;

/* ================= notes -> sections ================= */
function sections(text){
  const out=[]; let cur=[];
  text.replace(/\r\n/g,"\n").split("\n").forEach(l=>{ if(/^\s*-{3,}\s*$/.test(l)){ out.push(cur); cur=[]; } else cur.push(l); });
  out.push(cur);
  return out.map(ls=>{
    while(ls.length&&!ls[0].trim()) ls.shift();
    while(ls.length&&!ls[ls.length-1].trim()) ls.pop();
    let title=null;
    if(ls.length&&/^#{1,3}\s+/.test(ls[0])){ title=ls[0].replace(/^#{1,3}\s+/,"").trim(); ls=ls.slice(1); while(ls.length&&!ls[0].trim()) ls.shift(); }
    return {title, lines:ls, key:(title||"")+"\n"+ls.join("\n")};
  }).filter(s=>s.title||s.lines.length);
}
function linkify(el, text){
  const re=/https?:\/\/[^\s<>"')]+/g; let last=0, m;
  while((m=re.exec(text))){
    if(m.index>last) el.append(text.slice(last,m.index));
    const u=safeHttp(m[0]);
    el.append(u?h("a",{href:u,target:"_blank",rel:"noopener noreferrer",text:m[0]}):m[0]);
    last=m.index+m[0].length;
  }
  if(last<text.length) el.append(text.slice(last));
}

/* ================= state ================= */
let db=null, auth=null, uid=null, connected=false;
const R={}; // per-room state, reset on navigation
function resetRoom(code){
  (R.offs||[]).forEach(f=>{ try{f();}catch(e){} });
  if(R.meRef){ R.meRef.remove().catch(()=>{}); try{ R.meRef.onDisconnect().cancel(); }catch(e){} }
  Object.keys(R).forEach(k=>delete R[k]);
  Object.assign(R,{code, meta:undefined, padBox:null, key:null, salt:null, pin:"", text:"", freshIdx:new Set(), updatedAt:null,
    sync:"ok", stuck:false, people:{}, wrong:0, lockUntil:0, preview:false, offs:[], meRef:null});
}
const isOwner=()=>!!(R.meta&&uid&&R.meta.owner===uid);
const presenterView=()=>isOwner()&&!R.preview;

/* ================= routing ================= */
function route(){
  closeProjector();
  const raw=decodeURIComponent(location.hash.slice(1)).trim().toUpperCase();
  if(!db){ return; }
  if(raw==="NEW"){ resetRoom(null); renderCreate(); return; }
  if(CODE_RE.test(raw)){ openRoom(raw); return; }
  resetRoom(null); renderHome();
}
window.addEventListener("hashchange", route);

/* ================= rail ================= */
function renderRail(){
  const inRoom=!!R.code && R.meta!==undefined && R.meta!==null;
  $("sessBox").hidden=!inRoom;
  const vs=$("viewSwitch"); vs.replaceChildren();
  if(!inRoom) return;
  $("roomTitle").textContent=R.meta.title||"Workshop room";
  document.title=(R.meta.title||"Room")+" · Roomkey";
  const lf=$("liveFlag"); const on=connected&&!R.meta.ended;
  lf.className="live"+(on?"":" off");
  lf.lastChild.textContent=!connected?"Reconnecting…":R.meta.ended?"Room closed":"Live";
  $("codeTag").replaceChildren("Room ", h("span",{class:"codeshow",text:R.code}));
  const lt=$("lockTag"); lt.replaceChildren(h("span",{class:R.key?"tag lock":"tag",text:R.key?"PIN verified":"PIN protected"}));
  if(isOwner()&&R.key){
    vs.append(h("div",{class:"seg",role:"group","aria-label":"View as"},[
      h("button",{type:"button","aria-pressed":String(!R.preview),text:"Presenter",onclick:()=>{R.preview=false;renderRoom();}}),
      h("button",{type:"button","aria-pressed":String(R.preview),text:"Attendee view",onclick:()=>{R.preview=true;renderRoom();}})
    ]));
  }
}
function clearSide(){ $("console").hidden=true; $("console").replaceChildren(); $("grid").classList.remove("with-console"); $("helpbar").hidden=true; }

/* ================= home ================= */
function renderHome(){
  document.title="Roomkey";
  renderRail(); clearSide();
  const m=$("main"); m.replaceChildren();
  const codeIn=h("input",{class:"code-in",id:"joinCode",maxlength:"6",autocomplete:"off",autocapitalize:"characters",spellcheck:"false",placeholder:"ABC123","aria-label":"Room code"});
  const err=h("p",{class:"err"});
  m.append(h("div",{class:"home"},[
    h("div",{},[
      h("h1",{text:"One QR for the whole room."}),
      h("p",{class:"lede",text:"Paste your links, API keys and commands once. They appear on every laptop in the workshop as you type, behind a PIN only the room knows."})
    ]),
    h("div",{class:"choices"},[
      h("section",{class:"choice"},[
        h("h2",{text:"Running a session?"}),
        h("p",{text:"Open a room, put the QR and PIN on your first slide, and start pasting."}),
        h("form",{onsubmit:e=>{e.preventDefault(); location.hash="new";}},[h("button",{class:"btn primary big",type:"submit",text:"Start a room"})])
      ]),
      h("section",{class:"choice"},[
        h("h2",{text:"Joining a session?"}),
        h("p",{text:"Scan the QR on screen, or type the 6-letter room code."}),
        h("form",{onsubmit:e=>{
          e.preventDefault(); const c=codeIn.value.trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
          if(!CODE_RE.test(c)){ err.textContent="Room codes are 6 letters and numbers."; return; }
          location.hash=c;
        }},[codeIn, h("button",{class:"btn big",type:"submit",text:"Join"}), err])
      ])
    ]),
    h("div",{class:"how"},[
      h("div",{},[h("b",{text:"Live on every laptop"}),"Windows, Mac or phone. No app, no sign-up, no refresh."]),
      h("div",{},[h("b",{text:"PIN-locked"}),"Notes are encrypted in your browser with the room PIN before they're sent."]),
      h("div",{},[h("b",{text:"See who's stuck"}),"Attendees tap one button and you see how many need a hand."])
    ]),
    h("p",{class:"footer",text:"Built in Dublin after one too many workshops spent hunting for API keys."})
  ]));
}

/* ================= create ================= */
function renderCreate(){
  document.title="Start a room · Roomkey";
  renderRail(); clearSide();
  const m=$("main"); m.replaceChildren();
  if(!cryptoOk){ m.append(h("div",{class:"banner warn",text:"This browser can't do the encryption Roomkey needs. Try an up-to-date Chrome, Edge, Safari or Firefox."})); return; }
  const title=h("input",{class:"t",id:"newTitle",value:"",placeholder:"e.g. Build an observable AI agent",style:"max-width:320px;text-align:center"});
  const pin=h("input",{class:"pin",id:"newPin",inputmode:"numeric",autocomplete:"off",maxlength:"6",value:randomPin(),"aria-label":"Room PIN"});
  const err=h("p",{class:"err"});
  const btn=h("button",{class:"btn primary big",type:"submit",text:"Open the room"});
  m.append(h("div",{class:"gate"},[
    h("h2",{text:"Start a room"}),
    h("p",{text:"Give it a name and a 6-digit PIN. You'll show both on screen with the QR."}),
    h("form",{onsubmit:async e=>{
      e.preventDefault();
      const p=pin.value.trim();
      if(!/^\d{6}$/.test(p)){ err.textContent="The PIN needs exactly 6 digits."; return; }
      btn.disabled=true; btn.textContent="Opening…"; err.textContent="";
      try{ const code=await createRoom(p, title.value.trim().slice(0,80)||"Workshop room"); location.hash=code; }
      catch(ex){ btn.disabled=false; btn.textContent="Open the room"; err.textContent="Couldn't open the room. Check your connection and try again."; console.error(ex); }
    }},[h("label",{class:"f",style:"align-items:center"},["Room name",title]), h("label",{class:"f",style:"align-items:center"},["PIN",pin]), btn]),
    err
  ]));
}
async function createRoom(pin, title){
  const salt=b64e(crypto.getRandomValues(new Uint8Array(16)));
  const key=await deriveKey(pin, salt);
  const check=await seal(key, CHECK);
  const pad=await seal(key, "");
  for(let tries=0; tries<5; tries++){
    const code=randomCode();
    try{
      await db.ref("rooms/"+code+"/meta").set({owner:uid, title, salt, check, ended:false, createdAt:firebase.database.ServerValue.TIMESTAMP});
    }catch(e){ if(String(e&&e.code||e).toLowerCase().includes("permission")) continue; throw e; }
    await db.ref("rooms/"+code+"/pad").set({iv:pad.iv, ct:pad.ct, at:firebase.database.ServerValue.TIMESTAMP});
    lsSet("rk-pin-"+code, pin);
    return code;
  }
  throw new Error("no free code");
}

/* ================= room ================= */
function openRoom(code){
  resetRoom(code);
  renderRoom();
  const metaRef=db.ref("rooms/"+code+"/meta");
  const cbMeta=metaRef.on("value", async snap=>{
    const m=snap.val();
    const saltChanged=R.salt && (!m || m.salt!==R.salt);
    R.meta=m;
    if(saltChanged){ R.key=null; R.salt=null; R.pin=""; R.text=""; R.stuck=false; }
    if(m && !R.key && m.owner===uid){ const saved=lsGet("rk-pin-"+code); if(saved){ if(!(await unlock(saved))) lsSet("rk-pin-"+code,null); } }
    renderRoom();
  }, e=>{ console.error(e); R.meta=null; renderRoom(); });
  R.offs.push(()=>metaRef.off("value", cbMeta));

  const padRef=db.ref("rooms/"+code+"/pad");
  const cbPad=padRef.on("value", async snap=>{
    R.padBox=snap.val();
    await applyPad(false);
    if(!(presenterView()&&$("pad"))) renderRoom();
  });
  R.offs.push(()=>padRef.off("value", cbPad));

  const pplRef=db.ref("rooms/"+code+"/people");
  const cbPpl=pplRef.on("value", snap=>{
    R.people=snap.val()||{};
    const me=R.people[uid];
    if(R.stuck && me && me.stuck===false){ R.stuck=false; renderHelp(); toast("The presenter cleared the help queue"); }
    if(presenterView()&&R.key) renderConsole();
  });
  R.offs.push(()=>pplRef.off("value", cbPpl));
}

async function unlock(pin){
  if(!R.meta||!R.meta.check) return false;
  try{
    const key=await deriveKey(pin, R.meta.salt);
    if(await unseal(key, R.meta.check)!==CHECK) return false;
    R.key=key; R.salt=R.meta.salt; R.pin=pin; R.wrong=0;
    if(isOwner()) lsSet("rk-pin-"+R.code, pin);
    await applyPad(true);
    joinPeople();
    return true;
  }catch(e){ return false; }
}
function joinPeople(){
  if(isOwner()||R.meRef) return;
  R.meRef=db.ref("rooms/"+R.code+"/people/"+uid);
  R.meRef.onDisconnect().remove();
  R.meRef.set({stuck:false, at:firebase.database.ServerValue.TIMESTAMP}).catch(()=>{});
}
function setStuck(v){
  R.stuck=v; renderHelp();
  if(R.meRef) R.meRef.set({stuck:v, at:firebase.database.ServerValue.TIMESTAMP}).catch(()=>toast("Couldn't reach the room"));
  if(v) toast("The presenter can see you need a hand");
}

async function applyPad(initial){
  if(!R.key||!R.padBox||!R.padBox.ct) return;
  try{
    const t=await unseal(R.key, R.padBox);
    const padEl=$("pad");
    if(presenterView()&&padEl&&!initial){
      if(document.activeElement!==padEl && t!==R.text && !pushTimer && !pushing){ R.text=t; padEl.value=t; }
      return;
    }
    const old=sections(R.text).map(s=>s.key);
    R.freshIdx=new Set(); if(!initial) sections(t).forEach((s,i)=>{ if(old[i]!==s.key) R.freshIdx.add(i); });
    R.text=t; R.updatedAt=R.padBox.at||Date.now();
  }catch(e){ /* sealed with an older key */ }
}

let pushTimer=null, pushing=false, pushAgain=false;
function queuePush(now){ R.sync="busy"; updatePadBar(); clearTimeout(pushTimer); pushTimer=setTimeout(doPush, now?0:400); }
async function doPush(){
  pushTimer=null;
  if(pushing){ pushAgain=true; return; }
  pushing=true;
  try{
    const box=await seal(R.key, R.text);
    await db.ref("rooms/"+R.code+"/pad").set({iv:box.iv, ct:box.ct, at:firebase.database.ServerValue.TIMESTAMP});
    R.sync="ok";
  }catch(e){ R.sync="bad"; console.error(e); }
  pushing=false; updatePadBar();
  if(pushAgain){ pushAgain=false; doPush(); }
}

/* ================= room rendering ================= */
function renderRoom(){ renderRail(); renderMain(); renderConsole(); renderHelp(); }

function renderMain(){
  const m=$("main");
  if(presenterView()&&R.key&&R.meta&&m.querySelector("textarea.pad")){ updatePadBar(); return; }
  m.replaceChildren();
  if(R.meta===undefined){ m.append(h("div",{class:"empty-notes",text:"Finding room "+R.code+"…"})); return; }
  if(R.meta===null){
    m.append(h("div",{class:"gate"},[h("h2",{text:"No room called "+R.code}),h("p",{text:"Check the code on the presenter's screen. Codes use letters and numbers, without O, I, 0 or 1."}),
      h("div",{class:"row",style:"justify-content:center"},[h("a",{class:"btn",href:"#",text:"Back to start"})])]));
    return;
  }
  if(!cryptoOk){ m.append(h("div",{class:"banner warn",text:"This browser can't do the encryption Roomkey needs. Try an up-to-date Chrome, Edge, Safari or Firefox."})); return; }
  if(!R.key){ m.append(renderGate()); return; }
  if(R.meta.ended&&!presenterView()){
    m.append(h("div",{class:"ended"},[h("h2",{text:"Room closed"}),h("p",{text:"The presenter closed this room and cleared the notes. Anything you already copied is still on your laptop."})]));
    return;
  }
  m.append(presenterView()?renderPad():renderNotes());
}

function renderGate(){
  const pin=h("input",{class:"pin",id:"pinIn",inputmode:"numeric",autocomplete:"off",maxlength:"6",placeholder:"••••••","aria-label":"Room PIN"});
  const err=h("p",{class:"err"});
  const btn=h("button",{class:"btn primary big",type:"submit",text:"Join room"});
  const f=h("form",{onsubmit:async e=>{
    e.preventDefault();
    if(Date.now()<R.lockUntil){ err.textContent="Too many tries. Wait a few seconds."; return; }
    const p=pin.value.trim();
    if(!/^\d{6}$/.test(p)){ err.textContent="The PIN is 6 digits."; return; }
    btn.disabled=true; btn.textContent="Checking…";
    if(await unlock(p)){ renderRoom(); return; }
    btn.disabled=false; btn.textContent="Join room";
    R.wrong++; if(R.wrong>=5){ R.lockUntil=Date.now()+30000; R.wrong=0; }
    err.textContent="That PIN doesn't match this room."; pin.select();
  }},[pin,btn]);
  setTimeout(()=>{ try{pin.focus();}catch(e){} },0);
  return h("div",{class:"gate"},[
    h("h2",{text:isOwner()?"Unlock your room":"Enter the room PIN"}),
    h("p",{text:isOwner()?"Enter the PIN you opened this room with.":"It's on the presenter's screen, next to the QR code."}),
    f, err
  ]);
}

function updatePadBar(){
  const s=$("syncState"); if(!s) return;
  s.className="sync "+(R.sync==="ok"?"ok":R.sync==="busy"?"busy":"bad");
  s.textContent=R.sync==="ok"?"✓ On every laptop":R.sync==="busy"?"Sending…":"Not sent. Check your connection";
}
function renderPad(){
  const ta=h("textarea",{class:"pad",id:"pad",spellcheck:"false","aria-label":"Room notes",placeholder:"Paste anything here: links, API keys, commands, instructions.\nIt shows up on everyone's laptop as you type.\n\n# Step 1: get the code\nhttps://github.com/your-org/repo\n---\n# Step 2: keys\nAPI_KEY=..."});
  ta.value=R.text;
  ta.addEventListener("input",()=>{ R.text=ta.value; queuePush(); });
  setTimeout(updatePadBar,0);
  return h("div",{class:"padwrap"},[
    h("div",{class:"padbar"},[
      h("span",{},["Room notes · ", h("span",{id:"syncState",class:"sync ok",text:"✓ On every laptop"})]),
      h("div",{class:"row"},[
        h("button",{class:"btn ghost",type:"button",text:"Copy all",onclick:e=>copy(R.text,e.currentTarget)}),
        h("button",{class:"btn ghost danger",type:"button",text:"Clear",onclick:e=>{ const b=e.currentTarget; if(b.dataset.sure!=="1"){b.dataset.sure="1";b.textContent="Click again to clear";setTimeout(()=>{b.dataset.sure="";b.textContent="Clear";},3000);return;} R.text=""; ta.value=""; queuePush(true); }})
      ])
    ]),
    ta,
    h("div",{class:"hint"},["Tip: a line with just ",h("code",{text:"---"})," starts a new section. Start a section with ",h("code",{text:"# Title"})," to name it. Attendees get a copy button on every line."])
  ]);
}

function renderNotes(){
  const box=h("div",{class:"col"});
  const secs=sections(R.text);
  box.append(h("div",{class:"notes-head"},[
    h("span",{class:"when",id:"whenText",text:R.updatedAt?"Updated "+ago(R.updatedAt):"Live notes from the presenter"}),
    secs.length?h("button",{class:"btn",type:"button",text:"Copy everything",onclick:e=>copy(R.text,e.currentTarget)}):null
  ]));
  if(!secs.length){ box.append(h("div",{class:"empty-notes",text:"Nothing here yet. Whatever the presenter pastes will appear here by itself, no refresh needed."})); return box; }
  secs.forEach((s,i)=>{
    const sec=h("section",{class:"sec"+(R.freshIdx.has(i)?" fresh":"")});
    const body=s.lines.join("\n");
    sec.append(h("div",{class:"sec-head"},[h("h3",{text:s.title||("Section "+(i+1))}), h("button",{class:"btn",type:"button",text:"Copy section",onclick:e=>copy(body,e.currentTarget)})]));
    s.lines.forEach(l=>{
      if(!l.trim()){ sec.append(h("div",{class:"line blank"})); return; }
      const kv=/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l)||/^\s*(\$|npm |npx |pip |git |python |curl |export |cd |docker )/.test(l);
      const txt=h("div",{class:"txt"}); linkify(txt,l);
      sec.append(h("div",{class:"line"+(kv?" kv":"")},[txt, h("button",{class:"cp",type:"button",text:"Copy","aria-label":"Copy this line",onclick:e=>copy(l.replace(/^\s*\$\s*/,""),e.currentTarget)})]));
    });
    box.append(sec);
  });
  R.freshIdx.clear();
  return box;
}

/* ================= presenter console ================= */
let qrFor=null;
function renderConsole(){
  const con=$("console"), grid=$("grid");
  const show=presenterView()&&!!R.key&&!!R.meta;
  con.hidden=!show; grid.classList.toggle("with-console",show);
  if(!show){ qrFor=null; con.replaceChildren(); return; }
  const link=roomLink(R.code);
  const keepQr=con.querySelector(".qr");
  con.replaceChildren();
  const qr=keepQr&&qrFor===link?keepQr:h("div",{class:"qr"});
  con.append(h("div",{class:"panel"},[
    h("h3",{text:"Scan to join"}),
    qr,
    h("div",{class:"pinshow"},[
      h("div",{},[h("div",{class:"lbl",text:"Room code"}),h("div",{class:"v",text:R.code})]),
      h("div",{style:"text-align:right"},[h("div",{class:"lbl",text:"PIN"}),h("div",{class:"v",text:fmtPin(R.pin)})])
    ]),
    h("div",{class:"row"},[
      h("button",{class:"btn primary",type:"button",text:"Show on projector",onclick:openProjector}),
      h("button",{class:"btn",type:"button",text:"Copy link",onclick:e=>copy(link,e.currentTarget)})
    ])
  ]));
  if(qrFor!==link||!keepQr){ drawQr(qr,link,200); qrFor=link; }

  const ppl=Object.values(R.people||{});
  const stuck=Object.keys(R.people||{}).filter(k=>R.people[k]&&R.people[k].stuck);
  const pulse=h("div",{class:"panel"},[h("h3",{text:"Room pulse"}),
    h("div",{class:"row",style:"justify-content:space-between;align-items:baseline"},[
      h("div",{},[h("div",{class:"pulse-big",text:String(ppl.length)}),h("div",{class:"note",style:"margin:0",text:"laptops in (PIN verified)"})]),
      h("div",{style:"text-align:right"},[h("div",{class:"pulse-big",style:"color:var(--signal)",text:String(stuck.length)}),h("div",{class:"note",style:"margin:0",text:"need help"})])
    ])
  ]);
  if(stuck.length) pulse.append(h("div",{class:"row",style:"margin-top:10px"},[h("button",{class:"btn",type:"button",text:"Mark everyone unstuck",onclick:()=>{
    const up={}; stuck.forEach(k=>up[k+"/stuck"]=false);
    db.ref("rooms/"+R.code+"/people").update(up).catch(()=>toast("Couldn't reach the room"));
  }})]));
  con.append(pulse);

  const titleIn=h("input",{class:"t",id:"roomName",value:R.meta.title||"",maxlength:"80"});
  con.append(h("div",{class:"panel"},[
    h("h3",{text:"Room"}),
    h("div",{class:"col",style:"gap:10px"},[
      h("label",{class:"f"},["Room name (everyone sees this)",titleIn]),
      h("div",{class:"row"},[
        h("button",{class:"btn",type:"button",text:"Save name",onclick:()=>{ const t=titleIn.value.trim(); if(t) saveMeta({title:t.slice(0,80)}).then(()=>toast("Saved")); }}),
        R.meta.ended
          ? h("button",{class:"btn",type:"button",text:"Reopen room",onclick:()=>saveMeta({ended:false})})
          : h("button",{class:"btn danger",type:"button",text:"Close room and wipe notes",onclick:e=>{ const b=e.currentTarget; if(b.dataset.sure!=="1"){b.dataset.sure="1";b.textContent="Click again to close";return;} closeRoom(); }})
      ]),
      h("p",{class:"note",text:"The PIN keeps out anyone who only has the link. For real safety, paste workshop-only keys you revoke after the event."}),
      h("a",{class:"btn ghost",href:"#new",style:"justify-content:flex-start;padding-left:0",text:"Start another room"})
    ])
  ]));
}
function saveMeta(patch){
  R.meta=Object.assign({}, R.meta, patch); renderRoom();
  return db.ref("rooms/"+R.code+"/meta").update(patch).catch(e=>{ toast("Couldn't save"); console.error(e); });
}
async function closeRoom(){
  R.text=""; const ta=$("pad"); if(ta) ta.value="";
  const box=await seal(R.key,"");
  await db.ref("rooms/"+R.code+"/pad").set({iv:box.iv, ct:box.ct, at:firebase.database.ServerValue.TIMESTAMP}).catch(()=>{});
  await saveMeta({ended:true});
}
function drawQr(el, link, size){
  el.replaceChildren();
  if(typeof window.QRCode!=="function"){ el.append(h("div",{class:"empty",text:link})); return; }
  try{ new window.QRCode(el,{text:link,width:size,height:size,colorDark:"#37352F",colorLight:"#FFFFFF",correctLevel:window.QRCode.CorrectLevel.M}); el.removeAttribute("title"); }
  catch(e){ el.append(h("div",{class:"empty",text:link})); }
}
function openProjector(){
  const p=$("projector"); p.replaceChildren();
  const qr=h("div",{class:"qr"});
  const host=location.host+location.pathname.replace(/\/index\.html$/,"").replace(/\/$/,"");
  p.append(
    h("button",{class:"btn close",type:"button",text:"Close",onclick:closeProjector}),
    h("h2",{text:"Scan to join · "+(R.meta.title||"Workshop room")}),
    qr,
    h("div",{class:"projcodes"},[
      h("div",{},[h("div",{class:"lbl",text:"Room code"}),h("div",{class:"bigpin",text:R.code})]),
      h("div",{},[h("div",{class:"lbl",text:"PIN"}),h("div",{class:"bigpin",text:fmtPin(R.pin)})])
    ]),
    h("div",{class:"note",style:"font-size:16px",text:"No camera? Go to "+host+" and type the code."})
  );
  drawQr(qr, roomLink(R.code), 600);
  p.hidden=false;
}
function closeProjector(){ const p=$("projector"); if(p) p.hidden=true; }
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeProjector(); });

function renderHelp(){
  const hb=$("helpbar"); hb.replaceChildren();
  const show=!!R.code&&!isOwner()&&!!R.key&&!!R.meta&&!R.meta.ended;
  hb.hidden=!show; if(!show) return;
  hb.append(h("button",{class:"btn "+(R.stuck?"":"signal"),type:"button",text:R.stuck?"Got it working, thanks":"I'm stuck",onclick:()=>setStuck(!R.stuck)}));
}
setInterval(()=>{ const w=$("whenText"); if(w&&R.updatedAt) w.textContent="Updated "+ago(R.updatedAt); },10000);

/* ================= boot ================= */
function renderSetup(msg){
  const m=$("main"); m.replaceChildren(h("div",{class:"setup"},[
    h("h1",{text:"Almost there"}),
    h("p",{text:msg}),
    h("ol",{},[
      h("li",{},["Open ",h("code",{text:"firebase-config.js"})," and paste your Firebase web config."]),
      h("li",{text:"In Firebase, turn on Anonymous sign-in and create a Realtime Database."}),
      h("li",{},["Paste ",h("code",{text:"database.rules.json"})," into the database Rules tab and publish."])
    ]),
    h("p",{text:"The README has the click-by-click steps."})
  ]));
}
function boot(){
  const cfg=window.ROOMKEY_FIREBASE;
  if(!cfg||!cfg.apiKey||/PASTE/.test(cfg.apiKey)||!cfg.databaseURL||/your-project/.test(cfg.databaseURL)){ renderSetup("Roomkey needs a free Firebase project to sync notes between laptops."); return; }
  if(!window.firebase){ renderSetup("Firebase didn't load. Check your internet connection and reload."); return; }
  try{ firebase.initializeApp(cfg); }catch(e){ renderSetup("The Firebase config doesn't look right: "+e.message); return; }
  auth=firebase.auth(); db=null;
  auth.onAuthStateChanged(u=>{
    if(!u) return;
    const first=!uid; uid=u.uid;
    if(first){
      db=firebase.database();
      db.ref(".info/connected").on("value",s=>{ connected=!!s.val(); renderRail(); });
      route();
    }
  });
  auth.signInAnonymously().catch(e=>{
    console.error(e);
    renderSetup(e&&e.code==="auth/operation-not-allowed"||e&&e.code==="auth/admin-restricted-operation"
      ? "Anonymous sign-in is switched off. In Firebase: Build > Authentication > Sign-in method > Anonymous > Enable."
      : "Couldn't connect to Firebase ("+(e&&e.code||"error")+"). Check the config and your connection.");
  });
}
boot();
})();
