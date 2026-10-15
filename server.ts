import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

const sqliteDatabase = new Database(fileURLToPath(new URL("./app.db", import.meta.url)), { readonly: true });

const sqliteMcpServer = new Server(
  {
    name: "sqlite-query-service",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

sqliteMcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_tables",
        description: "Lista todas as tabelas de usuario presentes no banco SQLite.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_table_schema",
        description: "Retorna as definicoes das colunas de uma tabela especifica.",
        inputSchema: {
          type: "object",
          properties: {
            tableName: {
              type: "string",
              description: "Nome da tabela para inspecionar",
            },
          },
          required: ["tableName"],
        },
      },
      {
        name: "execute_readonly_query",
        description: "Executa consultas SELECT no SQLite com limite de resultados.",
        inputSchema: {
          type: "object",
          properties: {
            sqlQuery: {
              type: "string",
              description: "Instrucao SQL SELECT",
            },
          },
          required: ["sqlQuery"],
        },
      },
    ],
  };
});

sqliteMcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: toolArguments } = request.params;

  if (name === "list_tables") {
    const statement = sqliteDatabase.prepare(`
      SELECT name 
      FROM sqlite_master 
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%';
    `);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(statement.all(), null, 2),
        },
      ],
    };
  }

  if (name === "get_table_schema") {
    const rawTableName = String(toolArguments?.tableName || "").replace(/[^a-zA-Z0-9_]/g, "");
    const statement = sqliteDatabase.prepare(`PRAGMA table_info("${rawTableName}");`);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(statement.all(), null, 2),
        },
      ],
    };
  }

  if (name === "execute_readonly_query") {
    const rawQuery = String(toolArguments?.sqlQuery || "").trim().replace(/;/g, "");
    if (!/^(select|with)\b/i.test(rawQuery)) {
      return { isError: true, content: [{ type: "text", text: "Apenas consultas SELECT sao permitidas." }] };
    }

    const limitedQuery = `SELECT * FROM (${rawQuery}) LIMIT 100;`;
    try {
      const statement = sqliteDatabase.prepare(limitedQuery);
      return { content: [{ type: "text", text: JSON.stringify(statement.all(), null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `Erro SQL: ${(e as Error).message}` }] };
    }
  }

  throw new Error(`Ferramenta desconhecida: ${name}`);
});

const transport = new StdioServerTransport();
await sqliteMcpServer.connect(transport);
// server.ts
