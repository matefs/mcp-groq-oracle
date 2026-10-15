import { createAgent } from "./agent.ts";

const agent = await createAgent();
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  " + info}`);
};
const tool = async (name: string, args: any = {}) => {
  const r: any = await agent.mcp.callTool({ name, arguments: args });
  return { err: !!r.isError, text: r.content[0].text as string };
};

// --- Camada MCP (sem LLM, zero chamadas Groq) ---
const tools = (await agent.mcp.listTools()).tools.map((t) => t.name).sort();
check("mcp: lista 3 tools", tools.join() === "execute_readonly_query,get_table_schema,list_tables", tools.join());

const q = await tool("execute_readonly_query", { sqlQuery: "SELECT 1 AS n FROM dual;" });
check("mcp: conecta e executa SELECT", !q.err && JSON.parse(q.text)[0].N === 1, q.text);

const lt = await tool("list_tables", { owner: "FINANCEIRO" });
const ltj = lt.err ? { total: 0, tabelas: [] } : JSON.parse(lt.text);
const tables = ltj.tabelas;
check("mcp: list_tables FINANCEIRO (total real)", tables.length > 0 && ltj.total >= tables.length, lt.text);

const search = await tool("list_tables", { search: "FORNEC" });
check("mcp: list_tables search", !search.err, search.text);

if (tables[0]) {
  const s = await tool("get_table_schema", { owner: tables[0].OWNER, tableName: tables[0].TABLE_NAME });
  check("mcp: get_table_schema", !s.err && JSON.parse(s.text).columns.length > 0, s.text);
  const cnt = await tool("execute_readonly_query", { sqlQuery: `SELECT COUNT(*) c FROM ${tables[0].OWNER}.${tables[0].TABLE_NAME}` });
  check("mcp: count em tabela real", !cnt.err, cnt.text);
}

for (const bad of [
  "DELETE FROM financeiro.x",
  "DROP TABLE x",
  "UPDATE x SET a=1",
  "INSERT INTO x VALUES (1)",
  "SELECT 1 FROM dual; DROP TABLE x",
  "BEGIN NULL; END;",
  "SELECT * FROM dual FOR UPDATE",
  "CREATE TABLE zz (a number)",
]) {
  const r = await tool("execute_readonly_query", { sqlQuery: bad });
  check(`mcp: bloqueia '${bad}'`, r.err && /permitid/.test(r.text), r.text);
}
check("mcp: SQL invalido devolve erro", (await tool("execute_readonly_query", { sqlQuery: "SELECT * FROM nao_existe_xyz" })).err);
check("mcp: limite de linhas", JSON.parse((await tool("execute_readonly_query", { sqlQuery: "SELECT level FROM dual CONNECT BY level <= 500" })).text).length === 100);

// --- e2e com LLM: so com --e2e (1 pergunta) ---
if (process.argv.includes("--e2e")) {
  const { answer, calls, apiCalls } = await agent.ask("Quais tabelas do schema OBRA existem?");
  check(`e2e: pergunta (${apiCalls} chamadas Groq)`, calls.length > 0 && answer.length > 0, answer);
}

console.log(`\n${pass} passed, ${fail} failed`);
await agent.close();
process.exit(fail ? 1 : 0);
