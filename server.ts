import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import oracledb from "oracledb";

// Modo thin (JS puro): nao precisa de Oracle Client instalado.
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

const { ORACLE_HOST, ORACLE_PORT = "1521", ORACLE_SID, ORACLE_USER, ORACLE_PASSWORD } = process.env;
const SCHEMAS = (process.env.ORACLE_SCHEMAS ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const ROW_LIMIT = Number(process.env.ROW_LIMIT ?? 100);
const MAX_CHARS = 8000;

async function withConnection<T>(fn: (c: oracledb.Connection) => Promise<T>): Promise<T> {
  const conn = await oracledb.getConnection({
    user: ORACLE_USER,
    password: ORACLE_PASSWORD,
    connectString: `${ORACLE_HOST}:${ORACLE_PORT}/${ORACLE_SID}`,
  });
  try {
    // Defesa extra: qualquer DML nesta sessao falha.
    await conn.execute("SET TRANSACTION READ ONLY");
    return await fn(conn);
  } finally {
    await conn.close();
  }
}

const ident = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9_$#]/g, "");
const text = (data: unknown, isError = false) => {
  let t = typeof data === "string" ? data : JSON.stringify(data);
  if (t.length > MAX_CHARS) t = t.slice(0, MAX_CHARS) + "\n...[truncado; refine a consulta]";
  return { isError, content: [{ type: "text", text: t }] };
};

const server = new Server({ name: "oracle-query-service", version: "2.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_tables",
      description: `Lista tabelas Oracle (owner, nome, comentario). Filtre por 'search' (parte do nome ou comentario) e/ou 'owner'. Schemas padrao: ${SCHEMAS.join(", ") || "todos"}. Retorna o total real e no maximo 30 tabelas (refine com search). Para contagens, prefira execute_readonly_query em ALL_TABLES com GROUP BY owner.`,
      inputSchema: {
        type: "object",
        properties: {
          search: { type: ["string", "null"], description: "Trecho do nome/comentario da tabela (opcional, pode ser null)" },
          owner: { type: ["string", "null"], description: "Schema/owner (opcional, pode ser null)" },
        },
      },
    },
    {
      name: "get_table_schema",
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
      name: "execute_readonly_query",
      description: `Executa UMA consulta SELECT (ou WITH) Oracle. Use nomes qualificados OWNER.TABELA. Sintaxe Oracle (sem LIMIT; use FETCH FIRST n ROWS ONLY). Maximo ${ROW_LIMIT} linhas.`,
      inputSchema: {
        type: "object",
        properties: { sqlQuery: { type: "string", description: "Instrucao SQL SELECT Oracle, sem ponto-e-virgula" } },
        required: ["sqlQuery"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "list_tables") {
      const owner = ident(args?.owner);
      const search = String(args?.search ?? "").toUpperCase().slice(0, 60);
      const owners = owner ? [owner] : SCHEMAS;
      if (!owner && !search) {
        const ow = SCHEMAS.length ? SCHEMAS : [""];
        const b: Record<string, unknown> = {};
        const inList = SCHEMAS.length ? `WHERE owner IN (${ow.map((o, i) => ((b[`o${i}`] = o), `:o${i}`)).join(",")})` : "";
        const r = await withConnection((c) => c.execute(`SELECT owner, COUNT(*) AS tabelas FROM all_tables ${inList} GROUP BY owner ORDER BY owner`, b as any));
        return text({ resumo_por_schema: r.rows, dica: "Para ver tabelas de um schema, chame list_tables com owner e/ou search." });
      }
      const binds: Record<string, unknown> = {};
      let where = "WHERE 1=1";
      if (owners.length) {
        where += ` AND t.owner IN (${owners.map((o, i) => ((binds[`o${i}`] = o), `:o${i}`)).join(",")})`;
      }
      if (search) {
        binds.s = `%${search}%`;
        where += " AND (t.table_name LIKE :s OR UPPER(c.comments) LIKE :s)";
      }
      const r = await withConnection((c) =>
        c.execute(
          `SELECT t.owner, t.table_name, SUBSTR(c.comments,1,80) AS comments
             FROM all_tables t LEFT JOIN all_tab_comments c ON c.owner=t.owner AND c.table_name=t.table_name
             ${where} ORDER BY t.owner, t.table_name FETCH FIRST 30 ROWS ONLY`,
          binds as any,
        ),
      );
      const total = await withConnection((c) =>
        c.execute(`SELECT COUNT(*) AS n FROM all_tables t LEFT JOIN all_tab_comments c ON c.owner=t.owner AND c.table_name=t.table_name ${where}`, binds as any),
      );
      return text({ total: (total.rows as any)[0].N, mostrando: r.rows!.length, tabelas: r.rows });
    }

    if (name === "get_table_schema") {
      const owner = ident(args?.owner), table = ident(args?.tableName);
      const r = await withConnection(async (c) => {
        const b = { o: owner, t: table };
        const cols = await c.execute(
          `SELECT c.column_name, c.data_type, c.data_length, c.data_precision, c.nullable, SUBSTR(m.comments,1,100) AS comments
             FROM all_tab_columns c LEFT JOIN all_col_comments m ON m.owner=c.owner AND m.table_name=c.table_name AND m.column_name=c.column_name
            WHERE c.owner=:o AND c.table_name=:t ORDER BY c.column_id`, b);
        const cons = await c.execute(
          `SELECT k.constraint_type, k.constraint_name, cc.column_name, r.owner r_owner, r.table_name r_table
             FROM all_constraints k JOIN all_cons_columns cc ON cc.owner=k.owner AND cc.constraint_name=k.constraint_name
             LEFT JOIN all_constraints r ON r.owner=k.r_owner AND r.constraint_name=k.r_constraint_name
            WHERE k.owner=:o AND k.table_name=:t AND k.constraint_type IN ('P','R') ORDER BY k.constraint_name, cc.position`, b);
        return { columns: cols.rows, keys: cons.rows };
      });
      return text(r);
    }

    if (name === "execute_readonly_query") {
      const raw = String(args?.sqlQuery ?? "").trim().replace(/;+\s*$/, "");
      if (!/^(select|with)\b/i.test(raw) || raw.includes(";")) {
        return text("Apenas uma consulta SELECT/WITH e permitida.", true);
      }
      if (/\b(insert|update|delete|merge|drop|truncate|alter|create|grant|revoke|execute|call|begin|declare|commit|rollback|for\s+update)\b/i.test(raw.replace(/'(?:[^']|'')*'/g, "''"))) {
        return text("Comando nao permitido: somente leitura.", true);
      }
      const rows = await withConnection((c) =>
        c.execute(`SELECT * FROM (${raw}) WHERE ROWNUM <= ${ROW_LIMIT}`, [], { maxRows: ROW_LIMIT }),
      );
      return text(rows.rows);
    }

    return text(`Ferramenta desconhecida: ${name}`, true);
  } catch (e) {
    return text(`Erro Oracle: ${(e as Error).message}`, true);
  }
});

await server.connect(new StdioServerTransport());
