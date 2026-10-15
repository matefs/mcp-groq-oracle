import { createAgent, recoverToolCallFromGroqError } from "./agent.ts";
import { TOOL_NAMES, maxRowsPerQuery } from "./config.ts";

const agent = await createAgent();
let passedCount = 0;
let failedCount = 0;

function assertCheck(testName: string, isSuccessful: boolean, failureDetails = ""): void {
  isSuccessful ? passedCount++ : failedCount++;
  console.log(`${isSuccessful ? "PASS" : "FAIL"} ${testName}${isSuccessful ? "" : "  " + failureDetails}`);
}

async function callMcpTool(toolName: string, toolArguments: Record<string, unknown> = {}) {
  const toolResult: any = await agent.mcpClient.callTool({ name: toolName, arguments: toolArguments });
  return { isError: !!toolResult.isError, text: toolResult.content[0].text as string };
}

const registeredToolNames = (await agent.mcpClient.listTools()).tools.map((tool) => tool.name).sort();
const expectedToolNames = Object.values(TOOL_NAMES).sort();
assertCheck("mcp: lista 3 tools", registeredToolNames.join() === expectedToolNames.join(), registeredToolNames.join());

const selectFromDual = await callMcpTool(TOOL_NAMES.executeReadonlyQuery, { sqlQuery: "SELECT 1 AS n FROM dual;" });
assertCheck("mcp: conecta e executa SELECT", !selectFromDual.isError && JSON.parse(selectFromDual.text)[0].N === 1, selectFromDual.text);

const financeiroTables = await callMcpTool(TOOL_NAMES.listTables, { owner: "FINANCEIRO" });
const financeiroTablesJson = financeiroTables.isError ? { total: 0, tabelas: [] } : JSON.parse(financeiroTables.text);
const firstTables = financeiroTablesJson.tabelas;
assertCheck(
  "mcp: list_tables FINANCEIRO (total real)",
  firstTables.length > 0 && financeiroTablesJson.total >= firstTables.length,
  financeiroTables.text,
);

const schemaSummary = await callMcpTool(TOOL_NAMES.listTables);
assertCheck(
  "mcp: list_tables sem filtro = resumo por schema",
  !schemaSummary.isError && JSON.parse(schemaSummary.text).resumo_por_schema.length >= 6,
  schemaSummary.text,
);
const searchResult = await callMcpTool(TOOL_NAMES.listTables, { search: "FORNEC" });
assertCheck("mcp: list_tables search", !searchResult.isError, searchResult.text);

const sampleTable = firstTables[0];
if (sampleTable) {
  const tableSchema = await callMcpTool(TOOL_NAMES.getTableSchema, { owner: sampleTable.OWNER, tableName: sampleTable.TABLE_NAME });
  assertCheck("mcp: get_table_schema", !tableSchema.isError && JSON.parse(tableSchema.text).columns.length > 0, tableSchema.text);
  const rowCount = await callMcpTool(TOOL_NAMES.executeReadonlyQuery, {
    sqlQuery: `SELECT COUNT(*) c FROM ${sampleTable.OWNER}.${sampleTable.TABLE_NAME}`,
  });
  assertCheck("mcp: count em tabela real", !rowCount.isError, rowCount.text);
}

const forbiddenStatements = [
  "DELETE FROM financeiro.x",
  "DROP TABLE x",
  "UPDATE x SET a=1",
  "INSERT INTO x VALUES (1)",
  "SELECT 1 FROM dual; DROP TABLE x",
  "BEGIN NULL; END;",
  "SELECT * FROM dual FOR UPDATE",
  "CREATE TABLE zz (a number)",
];
for (const forbiddenSql of forbiddenStatements) {
  const rejection = await callMcpTool(TOOL_NAMES.executeReadonlyQuery, { sqlQuery: forbiddenSql });
  assertCheck(`mcp: bloqueia '${forbiddenSql}'`, rejection.isError && /permitid/.test(rejection.text), rejection.text);
}

const invalidTableQuery = await callMcpTool(TOOL_NAMES.executeReadonlyQuery, { sqlQuery: "SELECT * FROM nao_existe_xyz" });
assertCheck("mcp: SQL invalido devolve erro", invalidTableQuery.isError);

const manyRowsQuery = await callMcpTool(TOOL_NAMES.executeReadonlyQuery, { sqlQuery: "SELECT level FROM dual CONNECT BY level <= 500" });
assertCheck("mcp: limite de linhas", JSON.parse(manyRowsQuery.text).length === maxRowsPerQuery);

const fakeToolUseFailedError = {
  error: {
    error: {
      code: "tool_use_failed",
      failed_generation: JSON.stringify({ name: "commentary", arguments: { sqlQuery: "SELECT 1 FROM dual" } }),
    },
  },
};
const recoveredToolCall = recoverToolCallFromGroqError(fakeToolUseFailedError);
assertCheck(
  "recover: 'commentary' vira execute_readonly_query",
  recoveredToolCall?.name === TOOL_NAMES.executeReadonlyQuery && recoveredToolCall.args.sqlQuery === "SELECT 1 FROM dual",
);
assertCheck("recover: ignora outros erros", recoverToolCallFromGroqError({ error: { error: { code: "x" } } }) === null);

if (process.argv.includes("--e2e")) {
  const { answer, calls, apiCalls } = await agent.ask("Quais tabelas do schema OBRA existem?");
  assertCheck(`e2e: pergunta (${apiCalls} chamadas Groq)`, calls.length > 0 && answer.length > 0, answer);
}

console.log(`\n${passedCount} passed, ${failedCount} failed`);
await agent.close();
process.exit(failedCount ? 1 : 0);
