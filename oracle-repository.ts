import oracledb from "oracledb";
import { maxRowsPerQuery, oracleConnectionConfig } from "./config.ts";

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

const MAX_TABLES_PER_SEARCH = 30;
const TABLES_WITH_COMMENTS_FROM_CLAUSE = `FROM all_tables t
  LEFT JOIN all_tab_comments c ON c.owner = t.owner AND c.table_name = t.table_name`;

type OracleRow = Record<string, unknown>;
type NamedBinds = Record<string, string>;

async function withReadOnlyConnection<T>(work: (connection: oracledb.Connection) => Promise<T>): Promise<T> {
  const connection = await oracledb.getConnection(oracleConnectionConfig);
  try {
    await connection.execute("SET TRANSACTION READ ONLY");
    return await work(connection);
  } finally {
    await connection.close();
  }
}

function buildNamedInClause(values: string[], bindPrefix: string): { placeholders: string; binds: NamedBinds } {
  const binds: NamedBinds = {};
  const placeholderNames = values.map((value, index) => {
    const bindName = `${bindPrefix}${index}`;
    binds[bindName] = value;
    return `:${bindName}`;
  });
  return { placeholders: placeholderNames.join(","), binds };
}

export async function countTablesBySchema(schemas: string[]): Promise<OracleRow[]> {
  const { placeholders, binds } = buildNamedInClause(schemas, "owner");
  const ownerFilter = schemas.length ? `WHERE owner IN (${placeholders})` : "";
  const result = await withReadOnlyConnection((connection) =>
    connection.execute<OracleRow>(
      `SELECT owner, COUNT(*) AS tabelas FROM all_tables ${ownerFilter} GROUP BY owner ORDER BY owner`,
      binds,
    ),
  );
  return result.rows ?? [];
}

export async function searchTablesWithComments(
  owners: string[],
  searchTermUpperCase: string,
): Promise<{ totalMatchingTables: number; tables: OracleRow[] }> {
  const filterConditions = ["1=1"];
  const { placeholders, binds } = buildNamedInClause(owners, "owner");
  if (owners.length) filterConditions.push(`t.owner IN (${placeholders})`);
  if (searchTermUpperCase) {
    binds.searchPattern = `%${searchTermUpperCase}%`;
    filterConditions.push("(t.table_name LIKE :searchPattern OR UPPER(c.comments) LIKE :searchPattern)");
  }
  const whereClause = `WHERE ${filterConditions.join(" AND ")}`;

  return withReadOnlyConnection(async (connection) => {
    const tablesResult = await connection.execute<OracleRow>(
      `SELECT t.owner, t.table_name, SUBSTR(c.comments, 1, 80) AS comments
       ${TABLES_WITH_COMMENTS_FROM_CLAUSE} ${whereClause}
       ORDER BY t.owner, t.table_name FETCH FIRST ${MAX_TABLES_PER_SEARCH} ROWS ONLY`,
      binds,
    );
    const countResult = await connection.execute<{ N: number }>(
      `SELECT COUNT(*) AS n ${TABLES_WITH_COMMENTS_FROM_CLAUSE} ${whereClause}`,
      binds,
    );
    return { totalMatchingTables: countResult.rows?.[0]?.N ?? 0, tables: tablesResult.rows ?? [] };
  });
}

export async function describeTableColumnsAndKeys(
  owner: string,
  tableName: string,
): Promise<{ columns: OracleRow[]; keys: OracleRow[] }> {
  const binds = { owner, tableName };
  return withReadOnlyConnection(async (connection) => {
    const columnsResult = await connection.execute<OracleRow>(
      `SELECT c.column_name, c.data_type, c.data_length, c.data_precision, c.nullable, SUBSTR(m.comments, 1, 100) AS comments
         FROM all_tab_columns c
         LEFT JOIN all_col_comments m ON m.owner = c.owner AND m.table_name = c.table_name AND m.column_name = c.column_name
        WHERE c.owner = :owner AND c.table_name = :tableName
        ORDER BY c.column_id`,
      binds,
    );
    const primaryAndForeignKeysResult = await connection.execute<OracleRow>(
      `SELECT k.constraint_type, k.constraint_name, cc.column_name, r.owner r_owner, r.table_name r_table
         FROM all_constraints k
         JOIN all_cons_columns cc ON cc.owner = k.owner AND cc.constraint_name = k.constraint_name
         LEFT JOIN all_constraints r ON r.owner = k.r_owner AND r.constraint_name = k.r_constraint_name
        WHERE k.owner = :owner AND k.table_name = :tableName AND k.constraint_type IN ('P', 'R')
        ORDER BY k.constraint_name, cc.position`,
      binds,
    );
    return { columns: columnsResult.rows ?? [], keys: primaryAndForeignKeysResult.rows ?? [] };
  });
}

export async function executeRowLimitedSelect(validatedSelectSql: string): Promise<OracleRow[]> {
  const result = await withReadOnlyConnection((connection) =>
    connection.execute<OracleRow>(
      `SELECT * FROM (${validatedSelectSql}) WHERE ROWNUM <= ${maxRowsPerQuery}`,
      [],
      { maxRows: maxRowsPerQuery },
    ),
  );
  return result.rows ?? [];
}
