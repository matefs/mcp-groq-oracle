import { createServer } from "node:http";
import { createAgent } from "./agent.ts";

import { readFileSync } from "node:fs";
const markedJs = readFileSync("node_modules/marked/lib/marked.umd.js");
const agent = await createAgent();
const PORT = Number(process.env.PORT ?? 3000);

const schemas = (process.env.ORACLE_SCHEMAS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const welcome = `👋 **Olá! Converse com o banco Oracle em linguagem natural.**

🔒 **Acesso somente leitura (SELECT).** Nada é alterado no banco.

**Schemas disponíveis:** ${schemas.map((x) => "`" + x + "`").join(", ") || "todos os que o usuário enxerga"}

**Como fazer uma boa pergunta**
- Cite o **schema** e o **assunto**: _"Liste 10 fornecedores do schema FINANCEIRO"_
- Diga **quantos** resultados quer: _"os 10 mais recentes"_ (máx. ${process.env.ROW_LIMIT ?? 100} linhas por consulta)
- Use **termos de negócio** (credor, pagamento, aquisição). O modelo procura nos comentários das tabelas.
- Peça **filtros claros**: período, status, código.
- Seja **específico**, uma pergunta por vez, e peça para detalhar a anterior se precisar.

**Exemplos**
- _Quais tabelas do schema OBRA existem?_
- _Quais colunas tem a tabela FINANCEIRO.FN_TAUX_CREDOR?_
- _Quantas tabelas existem em cada schema?_
- _Me dê 10 registros de subações do FINANCEIRO_

💡 Clique em *tool calls MCP* abaixo de cada resposta para ver as consultas executadas.`;

const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pergunte ao banco Oracle</title>
<style>
:root{--bg:#f5f5f7;--panel:#ffffff;--panel2:#f5f5f7;--line:#d2d2d7;--text:#1d1d1f;--muted:#6e6e73;--accent:#0071e3;--ok:#248a3d;--code:#f5f5f7}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;font:15px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;background:var(--bg);color:var(--text);display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:12px;padding:14px 24px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.72);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px)}
.logo{width:34px;height:34px;border-radius:10px;background:var(--accent);display:grid;place-items:center;font-size:18px}
header h1{font-size:15px;margin:0;font-weight:650}header small{display:block;color:var(--muted);font-size:12px;font-weight:400}
.badge{margin-left:auto;font-size:11px;color:var(--ok);border:1px solid rgba(36,138,61,.3);background:rgba(36,138,61,.08);padding:4px 10px;border-radius:999px}
#chat{flex:1;overflow-y:auto;scroll-behavior:smooth}
.wrap{max-width:860px;margin:0 auto;padding:24px 20px 8px;display:flex;flex-direction:column;gap:22px}
.row{display:flex;gap:12px;align-items:flex-start}.row.u{flex-direction:row-reverse}
.av{flex:none;width:32px;height:32px;border-radius:10px;display:grid;place-items:center;font-size:16px;background:var(--panel2);border:1px solid var(--line)}
.row.b .av{background:var(--panel);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.msg{min-width:0;max-width:calc(100% - 46px)}
.row.u .msg{background:var(--accent);color:#fff;padding:10px 16px;border-radius:18px 18px 4px 18px;white-space:pre-wrap}
.row.b .msg{background:var(--panel);border:1px solid var(--line);padding:14px 18px;border-radius:18px 18px 18px 4px;overflow-wrap:anywhere;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.msg>:first-child{margin-top:0}.msg>:last-child{margin-bottom:0}
.msg h1,.msg h2,.msg h3{margin:14px 0 6px;line-height:1.3}.msg h1{font-size:19px}.msg h2{font-size:17px}.msg h3{font-size:15px}
.msg p{margin:8px 0}.msg ul,.msg ol{margin:8px 0;padding-left:22px}.msg li{margin:3px 0}
.msg a{color:var(--accent)}.msg hr{border:0;border-top:1px solid var(--line);margin:14px 0}
.msg blockquote{margin:8px 0;padding:4px 12px;border-left:3px solid var(--accent);color:var(--muted)}
.msg code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);border:1px solid var(--line);padding:1px 6px;border-radius:6px;color:#bf4800}
.msg pre{background:var(--code);border:1px solid var(--line);border-radius:10px;padding:12px 14px;overflow:auto;margin:10px 0}
.msg pre code{background:none;border:0;padding:0;color:var(--text);white-space:pre}
.tw{overflow-x:auto;margin:10px 0;border:1px solid var(--line);border-radius:10px}
.msg table{border-collapse:collapse;width:100%;font-size:13.5px}
.msg th{background:var(--panel2);text-align:left;font-weight:600;color:var(--text);white-space:nowrap}
.msg th,.msg td{padding:8px 12px;border-bottom:1px solid var(--line)}
.msg tbody tr:nth-child(even){background:#fafafc}.msg tbody tr:hover{background:rgba(0,113,227,.06)}.msg tbody tr:last-child td{border-bottom:0}
.meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;padding-top:10px;border-top:1px dashed var(--line);font-size:11.5px;color:var(--muted)}
.chip{border:1px solid var(--line);background:var(--panel2);padding:2px 9px;border-radius:999px}
details.tools{margin-top:10px;font-size:12.5px}details.tools summary{cursor:pointer;color:var(--muted);user-select:none}details.tools summary:hover{color:var(--text)}
.tc{margin-top:8px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--code)}
.tc b{display:block;padding:6px 12px;background:var(--panel2);color:var(--accent);font:12px ui-monospace,Menlo,monospace}
.tc pre{margin:0;border:0;border-radius:0;max-height:200px;font-size:12px;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.chips button{background:var(--panel2);color:var(--text);border:1px solid var(--line);padding:7px 12px;border-radius:999px;font:inherit;font-size:13px;cursor:pointer;transition:.15s}
.chips button:hover{border-color:var(--accent);color:var(--accent);background:rgba(0,113,227,.06)}
.typing{display:inline-flex;gap:5px;padding:4px 0}.typing i{width:7px;height:7px;border-radius:50%;background:var(--muted);animation:b 1.2s infinite}.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
@keyframes b{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-4px)}}
.err{color:#d70015}
footer{padding:12px 20px 18px}
form{max-width:860px;margin:0 auto;display:flex;gap:10px;align-items:flex-end;background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:6px 6px 6px 18px;transition:.15s;box-shadow:0 1px 3px rgba(0,0,0,.06)}
form:focus-within{border-color:var(--accent);box-shadow:0 0 0 4px rgba(0,113,227,.15)}
textarea{flex:1;resize:none;border:0;outline:0;background:transparent;color:var(--text);font:inherit;max-height:160px;padding:8px 0}
textarea::placeholder{color:var(--muted)}
form button{width:40px;height:40px;border:0;border-radius:50%;background:var(--accent);color:#fff;font-size:16px;cursor:pointer;transition:.15s}
form button:hover{background:#0077ed}form button:disabled{opacity:.4;cursor:not-allowed}
.hint{max-width:860px;margin:8px auto 0;text-align:center;font-size:11.5px;color:var(--muted)}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:#c7c7cc;border-radius:8px}
</style>
<header><div class="logo">🗄️</div><h1>Pergunte ao banco Oracle<small>MCP + Groq · linguagem natural</small></h1><span class="badge">🔒 somente leitura</span></header>
<div id="chat"><div class="wrap" id="wrap"></div></div>
<footer><form id="f"><textarea id="q" rows="1" placeholder="Pergunte algo sobre o banco…" autofocus></textarea><button id="send" title="Enviar">➤</button></form><div class="hint">Enter envia · Shift+Enter quebra linha</div></footer>
<script src="/marked.js"></script>
<script>
const chat=document.getElementById('chat'),wrap=document.getElementById('wrap'),f=document.getElementById('f'),q=document.getElementById('q'),btn=document.getElementById('send');
const WELCOME=__WELCOME__;
const EXAMPLES=['Quantas tabelas existem em cada schema?','Quais tabelas do schema OBRA existem?','Liste 10 subações do schema FINANCEIRO','Quais colunas tem a tabela FINANCEIRO.FN_TAUX_CREDOR?'];
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const md=s=>{const d=document.createElement('div');d.innerHTML=marked.parse(esc(s),{gfm:true,breaks:true});
 d.querySelectorAll('table').forEach(t=>{const w=document.createElement('div');w.className='tw';t.replaceWith(w);w.appendChild(t)});return d.innerHTML};
const scroll=()=>chat.scrollTo({top:chat.scrollHeight});
function add(kind,html){const r=document.createElement('div');r.className='row '+kind;
 r.innerHTML='<div class="av">'+(kind==='u'?'🙂':'🤖')+'</div><div class="msg"></div>';
 const m=r.querySelector('.msg');if(kind==='u')m.textContent=html;else m.innerHTML=html;wrap.appendChild(r);scroll();return m}
const w=add('b',md(WELCOME));
const ch=document.createElement('div');ch.className='chips';
EXAMPLES.forEach(t=>{const b=document.createElement('button');b.type='button';b.textContent=t;b.onclick=()=>{q.value=t;send()};ch.appendChild(b)});w.appendChild(ch);
q.addEventListener('input',()=>{q.style.height='auto';q.style.height=q.scrollHeight+'px'});
q.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
f.onsubmit=e=>{e.preventDefault();send()};
async function send(){const text=q.value.trim();if(!text||btn.disabled)return;q.value='';q.style.height='auto';add('u',text);
 const b=add('b','<span class="typing"><i></i><i></i><i></i></span>');btn.disabled=true;const t0=Date.now();
 try{const r=await fetch('/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:text})});
  const j=await r.json();if(!r.ok)throw new Error(j.error);
  b.innerHTML=md(j.answer);
  const m=document.createElement('div');m.className='meta';
  m.innerHTML='<span class="chip">⚡ '+j.apiCalls+' chamadas Groq</span><span class="chip">🔧 '+j.calls.length+' tool calls</span><span class="chip">⏱ '+((Date.now()-t0)/1000).toFixed(1)+'s</span>';
  b.appendChild(m);
  if(j.calls.length){const d=document.createElement('details');d.className='tools';d.innerHTML='<summary>Ver consultas executadas (MCP)</summary>';
   j.calls.forEach(c=>{const x=document.createElement('div');x.className='tc';const h=document.createElement('b');h.textContent=c.name;
    const p=document.createElement('pre');p.textContent=(c.args.sqlQuery||JSON.stringify(c.args))+'\\n\\n→ '+c.result.slice(0,600);x.append(h,p);d.appendChild(x)});b.appendChild(d)}
 }catch(err){b.innerHTML='<span class="err">⚠️ '+esc(err.message)+'</span>'}
 btn.disabled=false;q.focus();scroll()}
</script></html>`;

let busy = false;
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html.replace("__WELCOME__", () => JSON.stringify(welcome).replace(/</g, "\\u003c")));
    return;
  }
  if (req.method === "GET" && req.url === "/marked.js") {
    res.writeHead(200, { "content-type": "text/javascript" }).end(markedJs);
    return;
  }
  if (req.method === "POST" && req.url === "/ask") {
    const send = (code: number, body: unknown) =>
      res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (busy) return send(429, { error: "Aguarde a resposta anterior." });
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const { question } = JSON.parse(raw);
      if (!question || typeof question !== "string") return send(400, { error: "Pergunta vazia." });
      busy = true;
      send(200, await agent.ask(question));
    } catch (e) {
      send(500, { error: (e as Error).message });
    } finally {
      busy = false;
    }
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, "127.0.0.1", () => console.log(`Web: http://localhost:${PORT}`));
process.on("SIGINT", async () => { await agent.close(); process.exit(0); });
