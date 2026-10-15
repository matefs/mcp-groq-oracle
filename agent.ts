import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Groq from "groq-sdk";

/** Recupera a tool call de um erro 400 tool_use_failed da Groq, mapeando pelos argumentos. */
export function recoverToolCall(err: any): { name: string; args: Record<string, unknown> } | null {
  const body = err?.error?.error ?? err?.error ?? {};
  if (body.code !== "tool_use_failed" || !body.failed_generation) return null;
  try {
    const gen = JSON.parse(body.failed_generation);
    const args = gen.arguments ?? {};
    const name = args.sqlQuery ? "execute_readonly_query" : args.tableName ? "get_table_schema" : "list_tables";
    if (name === "list_tables" && gen.name !== "list_tables" && !("owner" in args || "search" in args)) return null;
    return { name, args };
  } catch {
    return null;
  }
}

export async function createAgent(opts: { verbose?: boolean } = {}) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY ?? process.env.GROQ_TOKEN });
  const mcp = new Client({ name: "groq-mcp-cli", version: "1.0.0" }, { capabilities: {} });
  await mcp.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "server.ts"], cwd: process.cwd(), env: process.env as Record<string, string> }));
  const { tools } = await mcp.listTools();
  const groqTools = tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));

  async function ask(prompt: string) {
    let apiCalls = 0;
    const calls: { name: string; args: any; result: string }[] = [];
    const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: `Voce e um analista de dados de um banco Oracle (somente leitura). Schemas principais: ${process.env.ORACLE_SCHEMAS}. Fluxo: 1) list_tables com 'search' para achar tabelas relevantes (as tabelas se chamam em portugues/abreviacoes; use comentarios); 2) get_table_schema apenas das tabelas necessarias; 3) execute_readonly_query com UMA query. Sintaxe Oracle: sem LIMIT (use FETCH FIRST n ROWS ONLY), nomes OWNER.TABELA, strings com aspas simples. Nunca peca esclarecimentos: se o termo for ambiguo, procure no dicionario (list_tables com search) e tente a interpretacao mais provavel. Seja economico: poucas chamadas de ferramenta. Responda em portugues, de forma clara, com base nos resultados.` },
      { role: "user", content: prompt },
    ];
    let recoveries = 0;
    for (let i = 0; i < 10; i++) {
      apiCalls++;
      let msg: any;
      try {
        const res = await groq.chat.completions.create({
          model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
          messages, tools: groqTools, tool_choice: "auto",
        });
        msg = res.choices[0].message;
      } catch (e) {
        // gpt-oss as vezes emite nome de tool invalido ("commentary") ou args malformados.
        const rec = recoverToolCall(e);
        if (!rec || recoveries++ >= 2) throw e;
        msg = { role: "assistant", content: null, tool_calls: [{ id: `rec_${i}`, type: "function", function: { name: rec.name, arguments: JSON.stringify(rec.args) } }] };
      }
      messages.push(msg);
      if (!msg.tool_calls?.length) return { answer: msg.content ?? "", calls, apiCalls };
      for (const tc of msg.tool_calls) {
        const args = Object.fromEntries(Object.entries(JSON.parse(tc.function.arguments || "{}")).filter(([, v]) => v !== null));
        const r: any = await mcp.callTool({ name: tc.function.name, arguments: args });
        const text = r.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
        calls.push({ name: tc.function.name, args, result: text });
        if (opts.verbose) console.error(`[tool] ${tc.function.name} ${JSON.stringify(args)}\n       -> ${text.slice(0, 200).replace(/\s+/g, " ")}`);
        messages.push({ role: "tool", tool_call_id: tc.id, content: text });
      }
    }
    throw new Error("Limite de iteracoes atingido");
  }
  return { ask, mcp, close: () => mcp.close() };
}
