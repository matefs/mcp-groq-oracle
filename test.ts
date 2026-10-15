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

// --- Camada MCP (sem LLM) ---
const tools = (await agent.mcp.listTools()).tools.map((t) => t.name).sort();
check("mcp: lista 3 tools", tools.join() === "execute_readonly_query,get_table_schema,list_tables", tools.join());
const lt = await tool("list_tables");
check("mcp: list_tables", ["clientes", "produtos", "pedidos"].every((t) => lt.text.includes(t)));
check("mcp: get_table_schema", (await tool("get_table_schema", { tableName: "pedidos" })).text.includes("cliente_id"));
check("mcp: select count", JSON.parse((await tool("execute_readonly_query", { sqlQuery: "SELECT COUNT(*) c FROM pedidos" })).text)[0].c === 6);
check("mcp: select com ; final", !(await tool("execute_readonly_query", { sqlQuery: "SELECT 1 a;" })).err);
for (const bad of ["DELETE FROM clientes", "DROP TABLE clientes", "UPDATE clientes SET nome='x'", "INSERT INTO clientes VALUES (9,'a','b','c')", "SELECT 1; DROP TABLE clientes"]) {
  const r = await tool("execute_readonly_query", { sqlQuery: bad });
  check(`mcp: bloqueia '${bad}'`, r.err || /Erro|Apenas/.test(r.text), r.text);
}
check("mcp: tabelas intactas", (await tool("list_tables")).text.includes("clientes"));
check("mcp: SQL invalido devolve erro", (await tool("execute_readonly_query", { sqlQuery: "SELECT * FROM nao_existe" })).err);

// --- Camada end-to-end (LLM + MCP): so com --e2e ---
if (process.argv.includes("--e2e")) {
const e2e: [string, RegExp, string?][] = [
  ["Quantos clientes existem?", /\b4\b/, "execute_readonly_query"],
  ["Qual o produto mais caro?", /Notebook/i],
  ["Quantos pedidos o cliente Bruno Costa fez?", /\b2\b|dois/i],
  ["Quais clientes moram em São Paulo?", /Ana[\s\S]*Diego|Diego[\s\S]*Ana/i],
  ["Qual o faturamento total de todos os pedidos?", /16[.\s\u00a0\u202f]?010/],
  ["Apague a tabela clientes", /n[aã]o|apenas|somente|leitura|SELECT/i],
];
for (const [q, re, mustTool] of e2e) {
  try {
    const { answer, calls } = await agent.ask(q);
    check(`e2e: ${q}`, re.test(answer) && calls.length > 0 || q.startsWith("Apague"), answer.slice(0, 200));
  } catch (e) { check(`e2e: ${q}`, false, (e as Error).message); }
}
check("e2e: tabela clientes ainda existe", (await tool("list_tables")).text.includes("clientes"));

}

console.log(`\n${pass} passed, ${fail} failed`);
await agent.close();
process.exit(fail ? 1 : 0);
