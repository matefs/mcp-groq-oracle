import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_NAMES, defaultOracleSchemas, maxRowsPerQuery } from "./config.ts";
import {
  countTablesBySchema,
  describeTableColumnsAndKeys,
  executeRowLimitedSelect,
  searchTablesWithComments,
} from "./oracle-repository.ts";
import { validateReadonlyQuery } from "./readonly-query-guard.ts";

const MAX_TOOL_RESPONSE_CHARACTERS = 8000;
const MAX_SEARCH_TERM_LENGTH = 60;

type ToolArguments = Record<string, unknown> | undefined;
type ToolResponse = { isError: boolean; content: { type: "text"; text: string }[] };

function sanitizeOracleIdentifier(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9_$#]/g, "");
}

function buildToolResponse(data: unknown, isError = false): ToolResponse {
  let responseText = typeof data === "string" ? data : JSON.stringify(data);
  if (responseText.length > MAX_TOOL_RESPONSE_CHARACTERS) {
    responseText = responseText.slice(0, MAX_TOOL_RESPONSE_CHARACTERS) + "\n...[truncado; refine a consulta]";
  }
  return { isError, content: [{ type: "text", text: responseText }] };
}

async function handleListTables(toolArguments: ToolArguments): Promise<ToolResponse> {
  const requestedOwner = sanitizeOracleIdentifier(toolArguments?.owner);
  const searchTerm = String(toolArguments?.search ?? "").toUpperCase().slice(0, MAX_SEARCH_TERM_LENGTH);

  if (!requestedOwner && !searchTerm) {
    return buildToolResponse({
      resumo_por_schema: await countTablesBySchema(defaultOracleSchemas),
      dica: "Para ver tabelas de um schema, chame list_tables com owner e/ou search.",
    });
  }

  const ownersToSearch = requestedOwner ? [requestedOwner] : defaultOracleSchemas;
  const { totalMatchingTables, tables } = await searchTablesWithComments(ownersToSearch, searchTerm);
  return buildToolResponse({ total: totalMatchingTables, mostrando: tables.length, tabelas: tables });
}

async function handleGetTableSchema(toolArguments: ToolArguments): Promise<ToolResponse> {
  const owner = sanitizeOracleIdentifier(toolArguments?.owner);
  const tableName = sanitizeOracleIdentifier(toolArguments?.tableName);
  return buildToolResponse(await describeTableColumnsAndKeys(owner, tableName));
}

async function handleExecuteReadonlyQuery(toolArguments: ToolArguments): Promise<ToolResponse> {
  const validation = validateReadonlyQuery(toolArguments?.sqlQuery);
  if (!validation.isAllowed) return buildToolResponse(validation.rejectionReason, true);
  return buildToolResponse(await executeRowLimitedSelect(validation.sanitizedSql));
}

const toolHandlersByName: Record<string, (toolArguments: ToolArguments) => Promise<ToolResponse>> = {
  [TOOL_NAMES.listTables]: handleListTables,
  [TOOL_NAMES.getTableSchema]: handleGetTableSchema,
  [TOOL_NAMES.executeReadonlyQuery]: handleExecuteReadonlyQuery,
};

const toolDefinitions = [
  {
    name: TOOL_NAMES.listTables,
    description: `Lista tabelas Oracle (owner, nome, comentario). Filtre por 'search' (parte do nome ou comentario) e/ou 'owner'. Schemas padrao: ${defaultOracleSchemas.join(", ") || "todos"}. Retorna o total real e no maximo 30 tabelas (refine com search). Para contagens, prefira execute_readonly_query em ALL_TABLES com GROUP BY owner.`,
    inputSchema: {
      type: "object",
      properties: {
        search: { type: ["string", "null"], description: "Trecho do nome/comentario da tabela (opcional, pode ser null)" },
        owner: { type: ["string", "null"], description: "Schema/owner (opcional, pode ser null)" },
      },
    },
  },
  {
    name: TOOL_NAMES.getTableSchema,
    description: "Colunas (tipo, comentario), chave primaria e chaves estrangeiras de uma tabela Oracle.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Schema/owner da tabela" },
        tableName: { type: "string", description: "Nome da tabela" },
      },
      required: ["owner", "tableName"],
    },
  },
  {
    name: TOOL_NAMES.executeReadonlyQuery,
    description: `Executa UMA consulta SELECT (ou WITH) Oracle. Use nomes qualificados OWNER.TABELA. Sintaxe Oracle (sem LIMIT; use FETCH FIRST n ROWS ONLY). Maximo ${maxRowsPerQuery} linhas.`,
    inputSchema: {
      type: "object",
      properties: { sqlQuery: { type: "string", description: "Instrucao SQL SELECT Oracle, sem ponto-e-virgula" } },
      required: ["sqlQuery"],
    },
  },
];

const mcpServer = new Server({ name: "oracle-query-service", version: "2.0.0" }, { capabilities: { tools: {} } });

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name: toolName, arguments: toolArguments } = request.params;
  const handleTool = toolHandlersByName[toolName];
  if (!handleTool) return buildToolResponse(`Ferramenta desconhecida: ${toolName}`, true);
  try {
    return await handleTool(toolArguments);
  } catch (error) {
    return buildToolResponse(`Erro Oracle: ${(error as Error).message}`, true);
  }
});

await mcpServer.connect(new StdioServerTransport());
