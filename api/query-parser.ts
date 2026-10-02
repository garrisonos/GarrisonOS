/**
 * Universal Temporal Query & Multi-Key Sorting Parser
 *
 * Provides standardized zero-dependency parsing and validation for:
 * 1. Millisecond timestamp interval filters (*_start and *_end)
 * 2. Multi-column SQL order_by sorting with strict column whitelisting
 */

/**
 * Result envelope returned by temporal parameter validation.
 */
export interface TemporalValidationResult {
  /** Map of parsed and validated timestamp parameters (e.g. created_at_start: 1700000000000). */
  params: Record<string, number>;
  /** Error message if validation fails; undefined otherwise. */
  error?: string;
}

/**
 * Result envelope returned by order_by clause parsing.
 */
export interface OrderByParseResult {
  /** Sanitized SQL ORDER BY expression (e.g. "due_date ASC, created_at DESC"). */
  clause: string;
  /** Error message if validation fails; undefined otherwise. */
  error?: string;
}

/**
 * Validates temporal query parameters ending in *_start or *_end.
 *
 * Ensures values are non-negative integer millisecond timestamps and that
 * start bounds do not exceed end bounds.
 *
 * @param query - Raw URL query key-value pairs from the request.
 * @param allowedFields - Optional whitelist of allowed root field names (e.g. ['created_at', 'updated_at', 'due_date']).
 * @returns Result object with validated numeric timestamps or an error message.
 */
export function validateTemporalParams(
  query: Record<string, string | undefined>,
  allowedFields?: string[]
): TemporalValidationResult {
  const params: Record<string, number> = {};
  const allowedSet = allowedFields ? new Set(allowedFields) : null;

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;

    const match = key.match(/^(.+)_(start|end)$/);
    if (!match) continue;

    const rootField = match[1]!;
    if (allowedSet && !allowedSet.has(rootField)) {
      continue;
    }

    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) {
      return {
        params: {},
        error: `Query parameter "${key}" must be a non-negative integer millisecond timestamp`
      };
    }

    params[key] = num;
  }

  // Cross-validate that start <= end for each root field
  for (const key of Object.keys(params)) {
    if (key.endsWith('_start')) {
      const rootField = key.slice(0, -6);
      const endKey = `${rootField}_end`;
      const startVal = params[key];
      const endVal = params[endKey];

      if (startVal !== undefined && endVal !== undefined && startVal > endVal) {
        return {
          params: {},
          error: `Query parameter "${key}" cannot be greater than "${endKey}"`
        };
      }
    }
  }

  return { params };
}

/**
 * Parses and whitelists a multi-key order_by query string.
 *
 * Expected format: `order_by=field1:asc,field2:desc` or `order_by=field1,field2:desc` (defaults to ASC).
 *
 * @param orderByParam - The raw query string value for order_by.
 * @param allowedColumns - Whitelist of permitted column identifiers.
 * @param defaultClause - Default SQL ORDER BY clause to use if order_by is omitted or empty.
 * @returns Result object containing the safe sanitized SQL clause or a validation error.
 */
export function parseOrderByClause(
  orderByParam: string | undefined,
  allowedColumns: string[],
  defaultClause: string = 'created_at ASC'
): OrderByParseResult {
  if (!orderByParam || typeof orderByParam !== 'string' || orderByParam.trim() === '') {
    return { clause: defaultClause };
  }

  const allowedSet = new Set(allowedColumns);
  const parts = orderByParam.split(',').map((p) => p.trim()).filter(Boolean);

  if (parts.length === 0) {
    return { clause: defaultClause };
  }

  const sqlParts: string[] = [];

  for (const part of parts) {
    const tokens = part.split(':').map((t) => t.trim());
    const column = tokens[0]!;
    const directionRaw = (tokens[1] || 'asc').toLowerCase();

    if (!allowedSet.has(column)) {
      return {
        clause: '',
        error: `Invalid sort column "${column}". Allowed columns are: ${allowedColumns.join(', ')}`
      };
    }

    if (directionRaw !== 'asc' && directionRaw !== 'desc') {
      return {
        clause: '',
        error: `Invalid sort direction "${directionRaw}" for column "${column}". Must be "asc" or "desc"`
      };
    }

    const direction = directionRaw === 'desc' ? 'DESC' : 'ASC';
    sqlParts.push(`${column} ${direction}`);
  }

  return { clause: sqlParts.join(', ') };
}

/**
 * Converts validated temporal query parameters into a parameterized SQL clause and params array.
 *
 * @param temporalParams - Validated temporal params map from validateTemporalParams.
 * @param tableAlias - Optional table alias prefix (e.g. "p" for "p.created_at").
 * @returns Object with the SQL string snippet and corresponding parameter array.
 */
export function buildTemporalSqlConditions(
  temporalParams: Record<string, number>,
  tableAlias?: string
): { sql: string; params: number[] } {
  let sql = '';
  const params: number[] = [];
  const prefix = tableAlias ? `${tableAlias}.` : '';

  for (const [key, value] of Object.entries(temporalParams)) {
    if (key.endsWith('_start')) {
      const column = key.slice(0, -6);
      sql += ` AND ${prefix}${column} >= ?`;
      params.push(value);
    } else if (key.endsWith('_end')) {
      const column = key.slice(0, -4);
      sql += ` AND ${prefix}${column} <= ?`;
      params.push(value);
    }
  }

  return { sql, params };
}
