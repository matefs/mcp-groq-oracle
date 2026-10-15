const STARTS_WITH_SELECT_OR_WITH = /^(select|with)\b/i;
const FORBIDDEN_WRITE_OR_PLSQL_KEYWORDS =
  /\b(insert|update|delete|merge|drop|truncate|alter|create|grant|revoke|execute|call|begin|declare|commit|rollback|for\s+update)\b/i;
const QUOTED_STRING_LITERAL = /'(?:[^']|'')*'/g;
const TRAILING_SEMICOLONS = /;+\s*$/;

export type ReadonlyQueryValidation =
  | { isAllowed: true; sanitizedSql: string }
  | { isAllowed: false; rejectionReason: string };

export function validateReadonlyQuery(rawSql: unknown): ReadonlyQueryValidation {
  const sqlWithoutTrailingSemicolons = String(rawSql ?? "").trim().replace(TRAILING_SEMICOLONS, "");

  const isSingleSelectStatement =
    STARTS_WITH_SELECT_OR_WITH.test(sqlWithoutTrailingSemicolons) && !sqlWithoutTrailingSemicolons.includes(";");
  if (!isSingleSelectStatement) {
    return { isAllowed: false, rejectionReason: "Apenas uma consulta SELECT/WITH e permitida." };
  }

  const sqlWithoutStringLiterals = sqlWithoutTrailingSemicolons.replace(QUOTED_STRING_LITERAL, "''");
  if (FORBIDDEN_WRITE_OR_PLSQL_KEYWORDS.test(sqlWithoutStringLiterals)) {
    return { isAllowed: false, rejectionReason: "Comando nao permitido: somente leitura." };
  }

  return { isAllowed: true, sanitizedSql: sqlWithoutTrailingSemicolons };
}
