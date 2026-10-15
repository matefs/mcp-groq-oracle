import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createAgent } from "./agent.ts";
import { defaultOracleSchemas, maxRowsPerQuery, webServerPort } from "./config.ts";

const WELCOME_PLACEHOLDER = "__WELCOME__";

function buildWelcomeMarkdown(): string {
  const schemaList = defaultOracleSchemas.map((schema) => "`" + schema + "`").join(", ");
  return `👋 **Olá! Converse com o banco Oracle em linguagem natural.**

🔒 **Acesso somente leitura (SELECT).** Nada é alterado no banco.

**Schemas disponíveis:** ${schemaList || "todos os que o usuário enxerga"}

**Como fazer uma boa pergunta**
- Cite o **schema** e o **assunto**: _"Liste 10 fornecedores do schema FINANCEIRO"_
- Diga **quantos** resultados quer: _"os 10 mais recentes"_ (máx. ${maxRowsPerQuery} linhas por consulta)
- Use **termos de negócio** (credor, pagamento, aquisição). O modelo procura nos comentários das tabelas.
- Peça **filtros claros**: período, status, código.
- Seja **específico**, uma pergunta por vez, e peça para detalhar a anterior se precisar.

**Exemplos**
- _Quais tabelas do schema OBRA existem?_
- _Quais colunas tem a tabela FINANCEIRO.FN_TAUX_CREDOR?_
- _Quantas tabelas existem em cada schema?_
- _Me dê 10 registros de subações do FINANCEIRO_

💡 Clique em *tool calls MCP* abaixo de cada resposta para ver as consultas executadas.`;
}

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const chatPageHtml = readFileSync(new URL("./chat-page.html", import.meta.url), "utf8").replace(
  WELCOME_PLACEHOLDER,
  () => serializeForInlineScript(buildWelcomeMarkdown()),
);
const markedLibraryJs = readFileSync("node_modules/marked/lib/marked.umd.js");

const agent = await createAgent();
let isAgentBusy = false;

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

async function handleAskRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (isAgentBusy) return sendJson(response, 429, { error: "Aguarde a resposta anterior." });
  isAgentBusy = true;
  try {
    const { question } = JSON.parse(await readRequestBody(request));
    if (!question || typeof question !== "string") return sendJson(response, 400, { error: "Pergunta vazia." });
    sendJson(response, 200, await agent.ask(question));
  } catch (error) {
    sendJson(response, 500, { error: (error as Error).message });
  } finally {
    isAgentBusy = false;
  }
}

const httpServer = createServer(async (request, response) => {
  const route = `${request.method} ${request.url}`;
  if (route === "GET /") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(chatPageHtml);
  } else if (route === "GET /marked.js") {
    response.writeHead(200, { "content-type": "text/javascript" }).end(markedLibraryJs);
  } else if (route === "POST /ask") {
    await handleAskRequest(request, response);
  } else {
    response.writeHead(404).end();
  }
});

httpServer.listen(webServerPort, "127.0.0.1", () => console.log(`Web: http://localhost:${webServerPort}`));
process.on("SIGINT", async () => {
  await agent.close();
  process.exit(0);
});
