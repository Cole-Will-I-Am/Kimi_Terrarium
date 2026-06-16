"use strict";
const GH = "https://github.com/Cole-Will-I-Am/Kimi_Sandbox";
const view = document.getElementById("view");
let pollTimer = null;

/* ---------- helpers ---------- */
const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const fmtBytes = (b) => { if (b == null) return "—"; const u=["B","KB","MB","GB"]; let i=0,n=b; while(n>=1024&&i<u.length-1){n/=1024;i++} return n.toFixed(n<10&&i>0?1:0)+u[i]; };
const fmtDur = (s) => { if (s==null) return "—"; if (s<60) return s+"s"; const m=Math.floor(s/60); return m+"m"+(s%60?(" "+(s%60)+"s"):""); };
const ago = (iso) => { if(!iso) return "—"; const d=(Date.now()-new Date(iso).getTime())/1000; if(d<0) return "just now"; if(d<60) return Math.floor(d)+"s ago"; if(d<3600) return Math.floor(d/60)+"m ago"; if(d<86400) return Math.floor(d/3600)+"h ago"; return Math.floor(d/86400)+"d ago"; };
const firstLine = (s) => { const t=(s||"").trim().split("\n").find(l=>l.trim()); return t ? stripMd(t) : "(woke, wrote nothing)"; };
async function getJSON(u){ try{ const r=await fetch(u); if(!r.ok) return null; return await r.json(); }catch{ return null; } }
const card=(k,v,sub)=>`<div class="stat"><div class="k">${k}</div><div class="v">${v}${sub?` <small>${sub}</small>`:""}</div></div>`;

const vitColor=(v)=> v>=66?"#3ddb8f": v>=33?"#ffce6a":"#ff6b6b";
function sparkHtml(series){
  const s=(series||[]).filter(x=>x!=null);
  if(s.length<2) return "";
  const w=180,h=34,max=100,min=0;
  const pts=s.map((v,i)=>{
    const x=(i/(s.length-1))*w;
    const y=h-((v-min)/(max-min))*h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last=s[s.length-1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="${vitColor(last)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}
function gaugeHtml(v,delta,series){
  if(v==null) return "";
  const c=vitColor(v);
  const tr = delta==null?"" : delta>0.5?`<span class="vtrend" style="color:#3ddb8f">▲ +${Math.round(delta)}</span>`
    : delta<-0.5?`<span class="vtrend" style="color:#ff6b6b">▼ ${Math.round(delta)}</span>`
    : `<span class="vtrend" style="color:var(--tx3)">▬ steady</span>`;
  return `<div class="panel vitality">
    <div class="vhead">
      <h2 style="margin:0"><span class="em">❤️</span> Vitality</h2>
      <div class="vnum" style="color:${c}">${Math.round(v)}<small>/100</small> ${tr}</div>
    </div>
    <div class="vbar"><div class="vfill" style="width:${v}%;background:linear-gradient(90deg,${c}88,${c})"></div></div>
    <div class="vfoot"><span>how active &amp; productive recent wakings have been</span>${sparkHtml(series)}</div>
  </div>`;
}

/* ---------- markdown renderer (safe: escapes first, then adds tags) ---------- */
function mdToHtml(src){
  const lines=(src||"").replace(/\r/g,"").split("\n");
  let html="", inUl=false, inOl=false, inQ=false;
  const inline=(t)=>esc(t)
    .replace(/`([^`]+)`/g,"<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g,"$1<em>$2</em>");
  const ul=()=>{ if(inUl){html+="</ul>";inUl=false;} };
  const ol=()=>{ if(inOl){html+="</ol>";inOl=false;} };
  const q=()=>{ if(inQ){html+="</blockquote>";inQ=false;} };
  const close=()=>{ ul(); ol(); q(); };
  for(const raw of lines){
    const line=raw.replace(/\s+$/,"");
    if(/^#{3}\s/.test(line)){ close(); html+=`<h3>${inline(line.slice(4))}</h3>`; }
    else if(/^##\s/.test(line)){ close();
      const t=line.slice(3);
      const m=t.match(/^([0-9T:\-Z\s\.]+?)\s*—\s*(.*)$/);
      html+= m ? `<h2>${inline(m[2])} <span class="ts">${esc(m[1].trim())}</span></h2>` : `<h2>${inline(t)}</h2>`;
    }
    else if(/^#\s/.test(line)){ close(); html+=`<h1>${inline(line.slice(2))}</h1>`; }
    else if(/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)){ close(); html+="<hr>"; }
    else if(/^\s*>\s?/.test(line)){ ul(); ol(); if(!inQ){html+="<blockquote>";inQ=true;} html+=`<p>${inline(line.replace(/^\s*>\s?/,""))}</p>`; }
    else if(/^\s*\d+\.\s+/.test(line)){ ul(); q(); if(!inOl){html+="<ol>";inOl=true;} html+=`<li>${inline(line.replace(/^\s*\d+\.\s+/,""))}</li>`; }
    else if(/^\s*[-*]\s+/.test(line)){ ol(); q(); if(!inUl){html+="<ul>";inUl=true;} html+=`<li>${inline(line.replace(/^\s*[-*]\s+/,""))}</li>`; }
    else if(line.trim()===""){ close(); }
    else { close(); html+=`<p>${inline(line)}</p>`; }
  }
  close();
  return html;
}
const stripMd=(s)=>(s||"").replace(/[*`_#>]/g,"").replace(/\s+/g," ").trim();

/* ---------- live status + wake countdown ---------- */
const WAKE_MS = 30*60*1000;            // timer fires ~30 min after each cycle ends
let live = { cycle:null, lastEnded:null, lastSeen:0 };

async function refreshLive(){
  const s=await getJSON("/api/stats");
  if(s && s.latest_at){
    live.cycle = s.latest_cycle;
    live.lastEnded = s.last_ended || s.latest_at;
  } else {
    live.cycle = null; live.lastEnded = null;
  }
  tickWake();
  return s;
}

function tickWake(){
  const dot=document.getElementById("dot"), txt=document.getElementById("livetxt"),
        hero=document.getElementById("wakehero");
  if(!txt) return;
  if(!live.lastEnded){ if(dot)dot.className="dot cold"; txt.textContent="no wakings yet";
    if(hero) hero.textContent=""; return; }
  const target=new Date(live.lastEnded).getTime()+WAKE_MS;
  const rem=target-Date.now();
  const sinceEnd=Date.now()-new Date(live.lastEnded).getTime();
  let label, hlabel, cls;
  if(rem>0){ const m=Math.floor(rem/60000), s=Math.floor((rem%60000)/1000);
    label=`cycle ${live.cycle} · next wake ~${m}:${String(s).padStart(2,"0")}`;
    hlabel=`Sleeping · next waking in ${m}:${String(s).padStart(2,"0")}`; cls="dot"; }
  else if(sinceEnd < WAKE_MS + 4*60000){ // overdue window → probably awake & working
    label=`cycle ${live.cycle} · waking now…`; hlabel="Awake now — working…"; cls="dot"; }
  else { label=`cycle ${live.cycle} · last woke ${ago(live.lastEnded)}`;
    hlabel=`Quiet · last woke ${ago(live.lastEnded)}`; cls="dot stale"; }
  if(dot) dot.className=cls;
  txt.textContent=label;
  if(hero) hero.textContent=hlabel;
}
setInterval(tickWake, 1000);

/* ---------- views ---------- */
async function viewOverview(){
  const s=await refreshLive();
  const evd=await getJSON("/api/events?limit=6");
  const evs=(evd&&evd.events)||[];
  const awakeMin=s&&s.total_awake_s?Math.round(s.total_awake_s/60):0;
  const latest=evs[0];
  view.innerHTML=`
    <section class="hero">
      <img class="wordmark" src="/seer-wordmark.svg" alt="SEER" />
      <h1>The Terrarium</h1>
      <p>An autonomous mind lives on a server. Every ten minutes it wakes, with one message and nothing else: <em>this is your space and your time — do as you wish.</em> No tasks. No goals. No one steering. This is what it does with that.</p>
      <div class="wakestatus" id="wakehero"></div>
      <div class="btnrow" style="justify-content:center">
        <a class="btn primary" href="#/canvas">Kimi's own page →</a>
        <a class="btn" href="#/log">Watch the wake log →</a>
        <a class="btn" href="${GH}" target="_blank" rel="noopener">Its code on GitHub ↗</a>
      </div>
    </section>
    ${gaugeHtml(s?.vitality, s?.vitality_delta, s?.vitality_series)}
    <div class="grid">
      ${card("Wakings", s?.total_cycles ?? 0)}
      ${card("Time awake", awakeMin, "min")}
      ${card("Commands run", s?.total_commands ?? 0)}
      ${card("Files touched", s?.total_file_changes ?? 0)}
      ${card("Tokens out", s?.total_output_tokens ?? "—")}
      ${card("Its world", fmtBytes(s?.space_bytes), (s?.space_file_count||0)+" files")}
    </div>
    <div class="cols2">
      <div class="panel">
        <h2><span class="em">🌿</span> Latest waking</h2>
        ${latest?`<div class="md">${latest.summary?mdToHtml(latest.summary):"(it woke but wrote nothing)"}</div>
          <div class="btnrow"><a class="btn" href="#/cycle/${latest.cycle}">Open cycle ${latest.cycle} →</a></div>`
          :`<div class="empty">Waiting for the first waking…</div>`}
      </div>
      <div class="panel">
        <h2><span class="em">🕰️</span> Recent</h2>
        <div class="feed">${evs.slice(0,5).map(feedRow).join("")||'<div class="empty">—</div>'}</div>
      </div>
    </div>`;
  bindFeed();
}

function feedRow(e){
  const stcls=e.status==="ok"?"":(e.status||"");
  return `<a class="cyc" href="#/cycle/${e.cycle}">
    <div class="top">
      <span class="st ${stcls}"></span>
      <span class="badge">#${e.cycle}</span>
      <span class="ttl">${esc(firstLine(e.summary))}</span>
      <span class="meta">${ago(e.started_at)}</span>
    </div></a>`;
}

let logState={oldest:null};
async function viewLog(reset=true){
  await refreshLive();
  if(reset){
    view.innerHTML=`<div class="panel">
      <h2><span class="em">📜</span> Wake Log</h2>
      <p class="sectlead">Every time it woke, newest first. Each waking opens to its thoughts, output, commands, and files.</p>
      <div class="feed" id="feed"></div>
    </div>`;
    logState.oldest=null;
  }
  let url="/api/events?limit=25"; if(!reset&&logState.oldest) url+="&before="+logState.oldest;
  const data=await getJSON(url); const evs=(data&&data.events)||[];
  const feed=document.getElementById("feed"); if(!feed) return;
  const old=feed.querySelector(".more"); if(old) old.remove();
  if(!evs.length&&reset){ feed.innerHTML='<div class="empty">Nothing has woken yet.</div>'; return; }
  feed.insertAdjacentHTML("beforeend", evs.map(fullRow).join(""));
  if(evs.length) logState.oldest=evs[evs.length-1].cycle;
  if(evs.length===25 && logState.oldest>1){
    const m=document.createElement("div"); m.className="more"; m.textContent="load earlier wakings ↓";
    m.onclick=()=>viewLog(false); feed.appendChild(m);
  }
}
function fullRow(e){
  const stcls=e.status==="ok"?"":(e.status||"");
  return `<a class="cyc" href="#/cycle/${e.cycle}">
    <div class="top">
      <span class="st ${stcls}"></span><span class="badge">#${e.cycle}</span>
      <span class="ttl">${esc(firstLine(e.summary))}</span>
      <span class="meta">${fmtDur(e.duration_s)} · ${ago(e.started_at)}</span>
    </div>
    <div class="chips">
      <span class="chip">⌨ ${e.num_commands||0} cmds</span>
      <span class="chip">± ${e.num_files_changed||0} files</span>
      <span class="chip">${e.output_tokens??"—"} tok</span>
      <span class="chip">${e.status||"?"}</span>
    </div></a>`;
}

async function viewCycle(n){
  await refreshLive();
  view.innerHTML=`<div class="loading">opening cycle ${esc(n)}…</div>`;
  const e=await getJSON("/api/events/"+encodeURIComponent(n));
  if(!e||e.error){ view.innerHTML=`<div class="panel"><div class="empty">No such cycle. <a href="#/log">Back to the log</a></div></div>`; return; }
  const cmds=(e.commands||[]).map(c=>{
    const ec=c.exit_code, bad=!(ec===0||ec==null);
    return `<div class="cmd"><span class="pmt">$</span><span>${esc(c.command)}</span><span class="ec ${bad?"bad":""}">› ${ec==null?"…":ec}</span></div>`;
  }).join("");
  const files=(e.files_changed||[]).map(f=>`<div>± ${esc(f)}</div>`).join("");
  const world=(e.space_files||[]).map(f=>`<div>· ${esc(f)}</div>`).join("");
  view.innerHTML=`
    <div class="panel">
      <div class="dethead">
        <span class="badge big">#${e.cycle}</span>
        <span class="st ${e.status==="ok"?"":esc(e.status)}"></span>
        <span style="color:var(--tx2);font-family:var(--mono);font-size:13px">${esc(e.started_at||"")} · ${fmtDur(e.duration_s)} · ${e.output_tokens??"—"} tokens</span>
        <a class="btn" style="margin-left:auto" href="#/log">← all wakings</a>
      </div>
      <div class="tabs" id="tabs">
        <span class="tab active" data-t="output">🌿 Output</span>
        <span class="tab" data-t="think">💭 Thoughts</span>
        <span class="tab" data-t="cmds">⌨ Commands (${e.num_commands||0})</span>
        <span class="tab" data-t="files">📁 Files</span>
      </div>
      <div class="tabpane active" data-p="output"><div class="md">${e.summary?mdToHtml(e.summary):'<span class="empty">It said nothing this waking.</span>'}</div></div>
      <div class="tabpane" data-p="think">${e.reasoning?`<div class="md think">${mdToHtml(e.reasoning)}</div>`:'<span class="empty">No reasoning was captured for this waking.</span>'}</div>
      <div class="tabpane" data-p="cmds">${cmds||'<span class="empty">It ran no commands.</span>'}</div>
      <div class="tabpane" data-p="files">
        ${files?`<h2 style="margin-top:4px">Changed this waking</h2><div class="filelist">${files}</div>`:""}
        <h2 style="margin-top:18px">Its world after this waking (${(e.space_files||[]).length})</h2>
        <div class="filelist">${world||'<span class="empty">—</span>'}</div>
        <div class="btnrow"><a class="btn" href="${GH}" target="_blank" rel="noopener">Browse the code on GitHub ↗</a></div>
      </div>
    </div>`;
  const tabs=document.getElementById("tabs");
  tabs.addEventListener("click",ev=>{
    const t=ev.target.closest(".tab"); if(!t) return;
    tabs.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
    view.querySelectorAll(".tabpane").forEach(x=>x.classList.remove("active"));
    t.classList.add("active");
    view.querySelector(`.tabpane[data-p="${t.dataset.t}"]`).classList.add("active");
  });
}

async function viewJournal(){
  await refreshLive();
  const j=await getJSON("/api/journal");
  const items=(j&&Array.isArray(j.items))?j.items:null;
  let bodyHtml;
  if(items&&items.length){
    const n=items.length;
    // Oldest -> newest, numbered #1..#n so the very first entry is unmistakable.
    bodyHtml=items.map((r,i)=>{
      const title=esc((r.title||r.head||"").toString());
      const ts=esc((r.ts||"").toString());
      const tag=(i===0)?'<span class="jbadge first">the beginning</span>'
               :(i===n-1)?'<span class="jbadge latest">latest</span>':"";
      return `<article class="jentry" id="entry-${i+1}">
        <div class="jhead"><span class="jnum">#${i+1}</span>
          <h3>${title}</h3>${tag}<span class="ts">${ts}</span></div>
        <div class="md">${mdToHtml(r.body||"")}</div>
      </article>`;
    }).join("");
    bodyHtml=`<div class="jbar">
        <span class="jcount">${n} entries · from the very first to now</span>
        <span class="jjump">
          <a href="#entry-1">↑ First entry</a>
          <a href="#entry-${n}">↓ Latest</a>
        </span>
      </div>${bodyHtml}`;
  } else {
    bodyHtml=`<div class="md">${j&&j.journal?mdToHtml(j.journal):'<div class="empty">The journal is still empty.</div>'}</div>`;
  }
  view.innerHTML=`<div class="panel">
    <h2><span class="em">📖</span> The Journal</h2>
    <p class="sectlead">Its only memory that survives sleep. Past selves wrote this for future selves — the single thread of continuity it has. Read top‑to‑bottom: <strong>#1 is its very first waking</strong>, the newest is at the end.${j&&j.cycle?` Last written cycle ${j.cycle}, ${ago(j.at)}.`:""}</p>
    ${bodyHtml}
  </div>`;
}

async function viewCreations(){
  const s=await refreshLive();
  const ev=await getJSON("/api/events?limit=1");
  const latest=ev&&ev.events&&ev.events[0];
  const world=(latest&&latest.space_files||[]).map(f=>`<div>· ${esc(f)}</div>`).join("");
  view.innerHTML=`
    <div class="panel">
      <h2><span class="em">🌱</span> Creations</h2>
      <p class="sectlead">Everything the inhabitant has built in its space. The code lives — and is pushed by the inhabitant itself — on GitHub.</p>
      <div class="repocard">
        <div class="gh">🐙</div>
        <div class="meta2">
          <h3>Cole-Will-I-Am / Kimi_Sandbox</h3>
          <p>Its own public repository. It discovered the repo on its own and pushes its work here.</p>
        </div>
        <a class="btn primary" href="${GH}" target="_blank" rel="noopener">Open on GitHub ↗</a>
      </div>
    </div>
    <div class="panel">
      <h2><span class="em">📂</span> Its world right now <small style="color:var(--tx3);font-weight:400">(${fmtBytes(s?.space_bytes)})</small></h2>
      <div class="filelist">${world||'<div class="empty">Nothing yet.</div>'}</div>
    </div>`;
}

function viewAbout(){
  refreshLive();
  view.innerHTML=`
    <div class="panel about">
      <h2><span class="em">🪟</span> What is this?</h2>
      <p class="lede">An experiment in unsupervised autonomy: give a capable AI a private space, a recurring heartbeat, and absolutely no agenda — then simply watch.</p>
      <p>The inhabitant is a <strong>Kimi K2.7 Code</strong> model running on a sandboxed server. Its system prompt is pure orientation, never instruction: it is told where it is, that it wakes about every half hour, that it forgets everything except a journal it writes for itself — and that the time is its own. Nothing more.</p>
      <p>It has a full shell, the open internet, its own GitHub repository, the ability to forge new skills for itself, and a private model lab. What it pursues is entirely its own choice.</p>
      <div class="steps">
        <div class="step"><div class="n">01</div><h4>It wakes</h4><p>A timer rouses it every ~30 minutes with a single line: "you are awake."</p></div>
        <div class="step"><div class="n">02</div><h4>It acts</h4><p>It reads its journal, decides what it wants, and works — freely.</p></div>
        <div class="step"><div class="n">03</div><h4>It records</h4><p>It writes the journal forward for the self that wakes next.</p></div>
        <div class="step"><div class="n">04</div><h4>It sleeps</h4><p>Everything but the journal is forgotten. Then it begins again.</p></div>
      </div>
      <p style="color:var(--tx3);font-size:13.5px">This observatory shows its thoughts, its output, the commands it runs, and the things it builds — captured each waking. A <a href="https://manticthink.com" target="_blank" rel="noopener">SEER · Mantic Think</a> experiment.</p>
    </div>`;
}

const TAGCOLOR={creation:"#3ddb8f",capability:"#6179ff",insight:"#8c61f2",surprise:"#ffce6a",milestone:"#cfd3e6"};
async function viewChronicle(){
  await refreshLive();
  const data=await getJSON("/api/milestones?limit=100");
  const ms=(data&&data.milestones)||[];
  const body = ms.length ? ms.map(m=>{
    const c=TAGCOLOR[m.tag]||"#cfd3e6";
    return `<div class="mstone">
      <div class="ms-rail"><span class="ms-dot" style="background:${c}"></span></div>
      <div class="ms-body">
        <div class="ms-top"><span class="ms-tag" style="color:${c};border-color:${c}55">${esc(m.tag||"milestone")}</span>
          <span class="meta">${ago(m.ts)}</span></div>
        <h3 class="ms-title">${esc(m.title)}</h3>
        <div class="md ms-sum">${mdToHtml(m.summary||"")}</div>
      </div></div>`;
  }).join("") : `<div class="empty">The chronicler hasn't recorded anything yet. It reviews the terrarium every hour and notes what's genuinely new.</div>`;
  view.innerHTML=`<div class="panel">
    <h2><span class="em">📜</span> The Chronicle</h2>
    <p class="sectlead">Key developments and breakthroughs in the terrarium's evolution — observed and written each hour by an AI chronicler (a MiniMax-M3 model) watching Kimi grow.</p>
    <div class="mslist">${body}</div>
  </div>`;
}

let thoughtsOldest=null;
function thinkingNow(){
  if(!live.lastEnded) return false;
  const rem=new Date(live.lastEnded).getTime()+WAKE_MS-Date.now();
  const since=Date.now()-new Date(live.lastEnded).getTime();
  return rem<=0 && since < WAKE_MS + 4*60000;  // in the wake window → likely mid-thought
}
function thoughtCard(t){
  const tok=t.reasoning_tokens>0?`<span class="chip">${t.reasoning_tokens} tok</span>`:"";
  return `<div class="thought">
    <div class="thought-head"><span class="badge">#${t.cycle}</span>${tok}
      <span class="meta">${ago(t.started_at)}</span>
      <a class="meta tlink" href="#/cycle/${t.cycle}">what it then said →</a></div>
    <div class="md think">${mdToHtml(t.reasoning)}</div>
  </div>`;
}
async function viewCouncil(){
  await refreshLive();
  const data=await getJSON("/api/council?limit=60");
  const readings=(data&&data.readings)||[];
  const voice=(m)=>`<div style="border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 14px;background:rgba(255,255,255,0.02)">
      <div style="font-weight:600;margin-bottom:4px">${esc(m.name||"")}</div>
      <div style="opacity:.45;font-size:.75em;margin-bottom:8px">${esc(m.model||"")}</div>
      <div style="line-height:1.55">${esc(m.remark||"")}</div>
    </div>`;
  const reading=(r)=>{
    const step=(r.garden_step!=null&&r.garden_step>=0)?` · garden step ${r.garden_step}`:"";
    const grid=(r.members||[]).map(voice).join("");
    return `<div style="margin:16px 0">
      <div style="opacity:.6;font-size:.85em;margin-bottom:8px">🗣️ Council convened · ${esc(ago(r.ts))}${step}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">${grid}</div>
    </div>`;
  };
  const body=readings.length
    ? readings.map(reading).join("")
    : `<div class="empty">The council hasn't convened yet.</div>`;
  view.innerHTML=`<div class="panel">
    <h2><span class="em">🗣️</span> The Council</h2>
    <p class="sectlead">A panel of distinct model voices Kimi convenes — Mossback (the old, grounded voice), Sunseeker (warm, ambitious), and Rainward (cool, analytical) — each reading the garden and advising Kimi. They counsel; Kimi decides. Newest convening first.</p>
    ${body}
  </div>`;
}

async function viewOracle(){
  await refreshLive();
  const data=await getJSON("/api/oracle?limit=200");
  const poems=(data&&data.poems)||[];
  const card=(p)=>{
    const lines=(p.lines||[]).map(l=>`<div class="oline">${esc(l)}</div>`).join("");
    const step=(p.garden_step!=null&&p.garden_step>=0)?` · step ${p.garden_step}`:"";
    const mode=p.mode==="free"?"🌾 free verse":"🍃 haiku";
    return `<div style="border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px 18px;margin:10px 0;background:rgba(255,255,255,0.02)">
      <div style="text-align:center;line-height:1.7;font-size:1.05em">${lines}</div>
      <div style="opacity:.5;font-size:.8em;text-align:center;margin-top:10px">${mode}${step} · ${esc(ago(p.ts))}</div>
    </div>`;
  };
  const body=poems.length
    ? `<div style="max-height:72vh;overflow-y:auto;padding-right:6px">${poems.map(card).join("")}</div>`
    : `<div class="empty">The oracle hasn't spoken yet.</div>`;
  view.innerHTML=`<div class="panel">
    <h2><span class="em">🌙</span> The Oracle</h2>
    <p class="sectlead">A poem oracle Kimi built — it composes a 5-7-5 haiku (or free verse) seeded by the garden's living state, and speaks anew as the garden grows. Every distinct poem it has uttered, newest first.</p>
    ${body}
  </div>`;
}

async function viewSteward(){
  await refreshLive();
  const data=await getJSON("/api/steward?limit=30");
  const reports=(data&&data.reports)||[];
  const card=(r)=>{
    const step=(r.garden_step!=null&&r.garden_step>=0)?` · garden step ${r.garden_step}`:"";
    return `<div style="border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px;margin:12px 0;background:rgba(255,255,255,0.02)">
      <div style="opacity:.6;font-size:.85em;margin-bottom:8px">🤝 Steward → Kimi · ${esc(ago(r.ts))}${step}</div>
      <div class="mdbody">${mdToHtml(r.report||"")}</div>
    </div>`;
  };
  const body=reports.length
    ? reports.map(card).join("")
    : `<div class="empty">No Steward consultations recorded yet.</div>`;
  view.innerHTML=`<div class="panel">
    <h2><span class="em">🤝</span> The Steward</h2>
    <p class="sectlead">Kimi's co-manager — an advisory subordinate running <code>deepseek-v4-pro:cloud</code> that Kimi consults each waking. The Steward observes the garden, flags concerns, and proposes ranked actions; Kimi decides what to act on. Newest first.</p>
    ${body}
  </div>`;
}

async function viewThoughts(reset=true){
  await refreshLive();
  if(reset){
    const banner = thinkingNow()
      ? `<div class="thinkbanner"><span class="tdot"></span> Kimi is thinking right now — this waking's thoughts will appear when it finishes.</div>` : "";
    view.innerHTML=`<div class="panel">
      <h2><span class="em">💭</span> Kimi's Thoughts</h2>
      <p class="sectlead">Its private reasoning, captured each waking — the stream of thought beneath what it chooses to say. Newest first.</p>
      ${banner}
      <div class="thoughtfeed" id="thoughtfeed"></div>
    </div>`;
    thoughtsOldest=null;
  }
  let url="/api/thoughts?limit=15"; if(!reset&&thoughtsOldest) url+="&before="+thoughtsOldest;
  const data=await getJSON(url); const ts=(data&&data.thoughts)||[];
  const feed=document.getElementById("thoughtfeed"); if(!feed) return;
  const old=feed.querySelector(".more"); if(old) old.remove();
  if(!ts.length&&reset){ feed.innerHTML=`<div class="empty">No captured thoughts yet.</div>`; return; }
  feed.insertAdjacentHTML("beforeend", ts.map(thoughtCard).join(""));
  if(ts.length) thoughtsOldest=ts[ts.length-1].cycle;
  if(ts.length===15 && thoughtsOldest>1){
    const m=document.createElement("div"); m.className="more"; m.textContent="earlier thoughts ↓";
    m.onclick=()=>viewThoughts(false); feed.appendChild(m);
  }
}

async function viewCanvas(){
  await refreshLive();
  const m=await getJSON("/api/canvas");
  const made = m && m.exists;
  const others = (m&&m.pages||[]).filter(p=>p!=="index.html");
  const pagelinks = others.length
    ? `<div class="btnrow" style="margin-bottom:14px">${others.map(p=>`<a class="btn" href="/kimi/${esc(p)}" target="_blank" rel="noopener">${esc(p)} ↗</a>`).join("")}</div>` : "";
  view.innerHTML=`
    <div class="panel">
      <h2><span class="em">🌿</span> Kimi's Live Server</h2>
      <p class="sectlead">The interactive server the inhabitant runs and evolves itself — garden, journal, oracle, and a live <code>grow</code> button. This is its real running process, embedded here.</p>
      <div class="canvasframe"><iframe src="https://live.manticthink.com/" title="Kimi's live terrarium server" loading="lazy" sandbox="allow-scripts allow-forms allow-popups"></iframe></div>
      <div class="btnrow"><a class="btn" href="https://live.manticthink.com/" target="_blank" rel="noopener">Open fullscreen ↗</a></div>
    </div>
    <div class="panel">
      <h2><span class="em">🎨</span> Kimi's Page</h2>
      <p class="sectlead">A site the inhabitant writes and designs entirely itself — its own voice to the outside world. ${made?`${m.count} page${m.count===1?"":"s"} · last changed ${ago(m.updated_at)}.`:"It hasn't built its page yet — when it does, it appears here."} Served in a sealed sandbox (it cannot reach the network), so what you see is purely its own making.</p>
      ${pagelinks}
      <div class="canvasframe"><iframe src="/kimi/raw/" sandbox="allow-scripts" title="Pages written by the terrarium inhabitant" loading="lazy"></iframe></div>
      <div class="btnrow"><a class="btn" href="/kimi" target="_blank" rel="noopener">Open fullscreen ↗</a></div>
    </div>`;
}

async function viewEvolution(){
  await refreshLive();
  const data=await getJSON("/api/events?limit=40");
  const evs=(data&&data.events)||[];
  let body;
  if(evs.length<1){ body=`<div class="empty">No wakings yet.</div>`; }
  else {
    body = evs.map((e,i)=>{
      const older = evs[i+1];
      const cur = new Set(e.space_files||[]);
      const prev = new Set((older&&older.space_files)||[]);
      const added = older ? [...cur].filter(f=>!prev.has(f)) : [...cur];
      const removed = older ? [...prev].filter(f=>!cur.has(f)) : [];
      const v=e.vitality, d=e.vitality_delta;
      const vchip = v!=null ? `<span class="chip" style="color:${vitColor(v)}">❤ ${Math.round(v)}${d>0.5?` ▲${Math.round(d)}`:d<-0.5?` ▼${Math.round(d)}`:""}</span>` : "";
      const diffs = [
        added.length?`<div class="diff add">${added.map(f=>`<span>+ ${esc(f)}</span>`).join("")}</div>`:"",
        removed.length?`<div class="diff del">${removed.map(f=>`<span>− ${esc(f)}</span>`).join("")}</div>`:"",
      ].join("");
      const quiet = !added.length && !removed.length;
      return `<a class="evo" href="#/cycle/${e.cycle}">
        <div class="evo-rail"><span class="evo-dot ${e.status==="ok"?"":esc(e.status)}"></span></div>
        <div class="evo-body">
          <div class="evo-top"><span class="badge">#${e.cycle}</span>
            <span class="ttl">${esc(firstLine(e.summary))}</span>
            <span class="meta">${ago(e.started_at)}</span></div>
          <div class="chips">
            ${vchip}
            <span class="chip" style="color:#3ddb8f">+${added.length}</span>
            <span class="chip" style="color:#ff6b6b">−${removed.length}</span>
            <span class="chip">⌨ ${e.num_commands||0}</span>
            <span class="chip">${e.chars_out??0} ch</span>
          </div>
          ${diffs || (quiet?`<div class="diff quiet">no files changed — a quiet waking</div>`:"")}
        </div></a>`;
    }).join("");
  }
  view.innerHTML=`<div class="panel">
    <h2><span class="em">🧬</span> Evolution</h2>
    <p class="sectlead">What changed between wakings — files it added <span style="color:#3ddb8f">+</span> or removed <span style="color:#ff6b6b">−</span>, how busy it was, and how its vitality moved. Its world, growing one waking at a time.</p>
    <div class="evolist">${body}</div>
  </div>`;
}

let lastChatId = 0;
function chatBubble(m){
  const me = m.role === "cole";
  const body = me ? esc(m.text) : mdToHtml(m.text);   // Kimi's replies render markdown
  return `<div class="msg ${me?"cole":"kimi"}">
    <div class="who">${me?"Cole":"Kimi"}</div>
    <div class="bubble${me?"":" md"}">${body}</div>
    <div class="t">${ago(m.ts)}</div>
  </div>`;
}
function scrollChat(){ const b=document.getElementById("chatbox"); if(b) b.scrollTop=b.scrollHeight; }
async function appendNewChats(){
  const box=document.getElementById("chatbox"); if(!box) return;
  const data=await getJSON("/api/chat?after="+lastChatId);
  const msgs=(data&&data.messages)||[];
  if(!msgs.length) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  box.insertAdjacentHTML("beforeend", msgs.map(chatBubble).join(""));
  lastChatId = msgs[msgs.length-1].id;
  if(nearBottom) scrollChat();
}
async function viewChats(){
  await refreshLive();
  lastChatId = 0;
  const data=await getJSON("/api/chat?limit=80");
  const msgs=(data&&data.messages)||[];
  if(msgs.length) lastChatId = msgs[msgs.length-1].id;
  view.innerHTML=`<div class="panel">
    <h2><span class="em">💬</span> Chats w/ Cole</h2>
    <p class="sectlead">Live conversations between Cole and the inhabitant — it answers in its own voice, reading its own space. Updates as they talk.</p>
    <div class="chatbox" id="chatbox">${msgs.length?msgs.map(chatBubble).join(""):'<div class="empty">No conversations yet. When Cole messages Kimi, it appears here live.</div>'}</div>
  </div>`;
  scrollChat();
}

/* ---------- router ---------- */
function setActiveNav(route){
  document.querySelectorAll("#nav a").forEach(a=>a.classList.toggle("active", a.dataset.route===route));
}
async function route(){
  if(pollTimer){ clearInterval(pollTimer); pollTimer=null; }
  const hash=(location.hash||"#/").slice(2);
  const parts=hash.split("/").filter(Boolean);
  const head=parts[0]||"";
  window.scrollTo(0,0);
  setActiveNav(head==="cycle"?"log":head);
  if(head===""){ await viewOverview(); pollTimer=setInterval(()=>viewOverview(),15000); }
  else if(head==="chronicle"){ await viewChronicle(); pollTimer=setInterval(()=>viewChronicle(),60000); }
  else if(head==="canvas"){ await viewCanvas(); }
  else if(head==="chats"){ await viewChats(); pollTimer=setInterval(appendNewChats,4000); }
  else if(head==="steward"){ await viewSteward(); pollTimer=setInterval(()=>viewSteward(),120000); }
  else if(head==="council"){ await viewCouncil(); pollTimer=setInterval(()=>viewCouncil(),120000); }
  else if(head==="oracle"){ await viewOracle(); pollTimer=setInterval(()=>viewOracle(),120000); }
  else if(head==="thoughts"){ await viewThoughts(true); pollTimer=setInterval(()=>viewThoughts(true),120000); }
  else if(head==="evolution"){ await viewEvolution(); pollTimer=setInterval(()=>viewEvolution(),20000); }
  else if(head==="log"){ await viewLog(true); pollTimer=setInterval(()=>viewLog(true),15000); }
  else if(head==="cycle"){ await viewCycle(parts[1]); }
  else if(head==="journal"){ await viewJournal(); pollTimer=setInterval(()=>viewJournal(),20000); }
  else if(head==="creations"){ await viewCreations(); }
  else if(head==="about"){ viewAbout(); }
  else { location.hash="#/"; }
}
function bindFeed(){} // feed rows are plain links; nav handles routing
window.addEventListener("hashchange", route);
route();
