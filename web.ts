import { createServer } from "node:http";
import { createAgent } from "./agent.ts";

const agent = await createAgent();
const PORT = Number(process.env.PORT ?? 3000);

const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pergunte ao SQLite</title>
<style>
*{box-sizing:border-box}body{margin:0;font:15px system-ui;background:#0f1115;color:#e6e6e6;display:flex;flex-direction:column;height:100vh}
header{padding:14px 20px;background:#171a21;border-bottom:1px solid #262b36;font-weight:600}
#chat{flex:1;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:12px;max-width:820px;width:100%;margin:0 auto}
.m{padding:10px 14px;border-radius:12px;max-width:85%;white-space:pre-wrap;line-height:1.45}
.u{align-self:flex-end;background:#2d5bff}.b{align-self:flex-start;background:#1c2029}
details{margin-top:8px;font-size:12px;color:#9aa4b5}pre{white-space:pre-wrap;margin:4px 0;background:#12151b;padding:6px;border-radius:6px}
.meta{font-size:11px;color:#7b8598;margin-top:6px}
form{display:flex;gap:8px;padding:14px 20px;background:#171a21;border-top:1px solid #262b36;max-width:820px;width:100%;margin:0 auto}
input{flex:1;padding:12px;border-radius:10px;border:1px solid #2c3342;background:#0f1115;color:inherit;font:inherit}
button{padding:0 20px;border:0;border-radius:10px;background:#2d5bff;color:#fff;font:inherit;cursor:pointer}button:disabled{opacity:.5}
</style>
<header>🗄️ Pergunte ao banco Oracle (MCP + Groq)</header>
<div id="chat"><div class="m b">Olá! Pergunte algo sobre o banco em linguagem natural.</div></div>
<form id="f"><input id="q" placeholder="Ex.: Quanto cada cliente gastou?" autocomplete="off" autofocus><button>Enviar</button></form>
<script>
const chat=document.getElementById('chat'),f=document.getElementById('f'),q=document.getElementById('q'),btn=f.querySelector('button');
const add=(t,c)=>{const d=document.createElement('div');d.className='m '+c;d.textContent=t;chat.appendChild(d);chat.scrollTop=1e9;return d};
f.onsubmit=async e=>{e.preventDefault();const text=q.value.trim();if(!text)return;q.value='';add(text,'u');
 const b=add('pensando…','b');btn.disabled=true;
 try{const r=await fetch('/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:text})});
  const j=await r.json();if(!r.ok)throw new Error(j.error);
  b.textContent=j.answer;
  const m=document.createElement('div');m.className='meta';m.textContent='chamadas Groq: '+j.apiCalls;b.appendChild(m);
  if(j.calls.length){const d=document.createElement('details');d.innerHTML='<summary>'+j.calls.length+' tool call(s) MCP</summary>';
   j.calls.forEach(c=>{const p=document.createElement('pre');p.textContent=c.name+' '+JSON.stringify(c.args)+'\\n→ '+c.result.slice(0,500);d.appendChild(p)});b.appendChild(d)}
 }catch(err){b.textContent='Erro: '+err.message}
 btn.disabled=false;q.focus();chat.scrollTop=1e9};
</script></html>`;

let busy = false;
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
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
