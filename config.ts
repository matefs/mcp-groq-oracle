function parseCommaSeparatedUpperCaseList(rawValue: string | undefined): string[] {
  return (rawValue ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

export const TOOL_NAMES = {
  listTables: "list_tables",
  getTableSchema: "get_table_schema",
  executeReadonlyQuery: "execute_readonly_query",
} as const;

export const oracleConnectionConfig = {
  user: process.env.ORACLE_USER,
  password: process.env.ORACLE_PASSWORD,
  connectString: `${process.env.ORACLE_HOST}:${process.env.ORACLE_PORT ?? "1521"}/${process.env.ORACLE_SID}`,
};

export const defaultOracleSchemas = parseCommaSeparatedUpperCaseList(process.env.ORACLE_SCHEMAS);
export const maxRowsPerQuery = Number(process.env.ROW_LIMIT ?? 100);

export const groqApiKey = process.env.GROQ_API_KEY ?? process.env.GROQ_TOKEN;
export const groqModelName = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

export const webServerPort = Number(process.env.PORT ?? 3000);
