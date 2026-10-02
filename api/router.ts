import { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { errorResponse } from './response.js';

/**
 * Extended Node.js IncomingMessage carrying parsed route parameters,
 * query strings, body payloads, and ambient operator/tenant context.
 */
export interface ApiRequest extends IncomingMessage {
  /**
   * Route parameter key-value pairs (e.g., `:id`).
   */
  params: Record<string, string>;

  /**
   * URL query parameter key-value pairs.
   */
  query: Record<string, string>;

  /**
   * Parsed JSON request payload, or null if no body.
   */
  body: any;

  /**
   * Normalized URL path without query strings.
   */
  path: string;

  /**
   * Active operator isolation identifier.
   */
  operatorId?: string;

  /**
   * Verified operator ID extracted from a valid cryptographic bearer token.
   */
  verifiedOperatorId?: string;

  /**
   * Operator subdomain or path slug resolved from URL or host.
   */
  operatorSlug?: string;

  /**
   * Authenticated user ID, if authenticated.
   */
  userId?: string;

  /**
   * Correlation ID for distributed request tracing.
   */
  correlationId?: string;
}

/**
 * Request handler function processing an API request.
 */
export type Handler = (req: ApiRequest, res: ServerResponse) => Promise<void> | void;

/**
 * Middleware function intercepting and chaining request processing.
 */
export type Middleware = (req: ApiRequest, res: ServerResponse, next: () => Promise<void>) => Promise<void> | void;

interface RouteEntry {
  method: string;
  pattern: string;
  paramNames: string[];
  regex: RegExp;
  handlers: Handler[];
  batchSafe: boolean;
  registrationOrder: number;
}

const MAX_BODY_SIZE_BYTES = 1024 * 1024; // 1 MB

/**
 * Compares two route entries to ensure literal static segments take strict precedence
 * over parameterized wildcard segments (:param), eliminating registration-order sensitivity.
 */
function compareRouteSpecificity(a: RouteEntry, b: RouteEntry): number {
  const segA = a.pattern.split('/').filter(Boolean);
  const segB = b.pattern.split('/').filter(Boolean);
  const minLen = Math.min(segA.length, segB.length);

  for (let i = 0; i < minLen; i++) {
    const isParamA = segA[i]!.startsWith(':');
    const isParamB = segB[i]!.startsWith(':');
    if (!isParamA && isParamB) return -1; // static segment has higher precedence than param
    if (isParamA && !isParamB) return 1;  // param has lower precedence than static
  }

  // When prefixes match, longer paths are more specific
  if (segA.length !== segB.length) {
    return segB.length - segA.length;
  }

  // Preserve initial registration order if specificity is identical
  return a.registrationOrder - b.registrationOrder;
}

/**
 * Zero-dependency HTTP router providing route pattern matching, parameter extraction,
 * streaming JSON body parsing, and middleware pipeline execution.
 */
export class Router {
  private routes: RouteEntry[] = [];
  private middlewares: Middleware[] = [];
  private registrationCounter = 0;

  /**
   * Registers a global middleware function executed on every request.
   *
   * @param middleware - The middleware function to execute.
   */
  public use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * Registers a route pattern and associated handlers for the specified HTTP method.
   *
   * @param method - HTTP verb (e.g. GET, POST, PUT, DELETE).
   * @param pattern - URL pattern string.
   * @param handlers - Sequence of handlers to execute.
   * @param batchSafe - Whether this route can be invoked within batch transactions.
   */
  private register(method: string, pattern: string, handlers: Handler[], batchSafe = false): void {
    const paramNames: string[] = [];
    const normalizedPattern = pattern.startsWith('/') ? pattern : `/${pattern}`;
    
    // Replace :param with regex capture group and extract param names
    const regexPattern = normalizedPattern
      .replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      })
      .replace(/\/$/, ''); // Remove trailing slash for uniformity

    const regex = new RegExp(`^${regexPattern || '/'}/?$`);

    this.routes.push({
      method: method.toUpperCase(),
      pattern: normalizedPattern,
      paramNames,
      regex,
      handlers,
      batchSafe,
      registrationOrder: this.registrationCounter++
    });

    this.sortRoutes();
  }

  /**
   * Sorts registered routes by HTTP method and route specificity,
   * ensuring static routes take priority over parameterized routes.
   */
  private sortRoutes(): void {
    this.routes.sort((a, b) => {
      if (a.method !== b.method) {
        return a.method.localeCompare(b.method);
      }
      return compareRouteSpecificity(a, b);
    });
  }

  /**
   * Registers route handlers for HTTP GET requests.
   *
   * @param pattern - URL pattern string (supports :param placeholders).
   * @param handlers - Sequence of handlers to execute.
   */
  public get(pattern: string, ...handlers: Handler[]): void {
    this.register('GET', pattern, handlers);
  }

  /**
   * Registers a GET route marked safe for batch execution via /api/v1/batch.
   *
   * @param pattern - URL pattern string.
   * @param handlers - Sequence of handlers to execute.
   */
  public getBatchSafe(pattern: string, ...handlers: Handler[]): void {
    this.register('GET', pattern, handlers, true);
  }

  /**
   * Registers a GET route explicitly marked unsafe for batch execution.
   *
   * @param pattern - URL pattern string.
   * @param handlers - Sequence of handlers to execute.
   */
  public getUnsafe(pattern: string, ...handlers: Handler[]): void {
    this.register('GET', pattern, handlers, false);
  }

  /**
   * Registers route handlers for HTTP POST requests.
   *
   * @param pattern - URL pattern string.
   * @param handlers - Sequence of handlers to execute.
   */
  public post(pattern: string, ...handlers: Handler[]): void {
    this.register('POST', pattern, handlers);
  }

  /**
   * Registers route handlers for HTTP PUT requests.
   *
   * @param pattern - URL pattern string.
   * @param handlers - Sequence of handlers to execute.
   */
  public put(pattern: string, ...handlers: Handler[]): void {
    this.register('PUT', pattern, handlers);
  }

  /**
   * Registers route handlers for HTTP PATCH requests.
   *
   * @param pattern - URL pattern string.
   * @param handlers - Sequence of handlers to execute.
   */
  public patch(pattern: string, ...handlers: Handler[]): void {
    this.register('PATCH', pattern, handlers);
  }

  /**
   * Registers route handlers for HTTP DELETE requests.
   *
   * @param pattern - URL pattern string.
   * @param handlers - Sequence of handlers to execute.
   */
  public delete(pattern: string, ...handlers: Handler[]): void {
    this.register('DELETE', pattern, handlers);
  }

  /**
   * Registers route handlers for HTTP OPTIONS requests.
   *
   * @param pattern - URL pattern string.
   * @param handlers - Sequence of handlers to execute.
   */
  public options(pattern: string, ...handlers: Handler[]): void {
    this.register('OPTIONS', pattern, handlers);
  }

  /**
   * Checks whether a GET pathname matches a registered batch-safe route.
   *
   * @param pathname - URL pathname to check.
   * @returns True if route exists and is batch-safe; false otherwise.
   */
  public isBatchSafeGetPath(pathname: string): boolean {
    const route = this.routes.find((entry) => entry.method === 'GET' && entry.regex.test(pathname));
    return route?.batchSafe ?? false;
  }

  private async parseBody(req: IncomingMessage): Promise<any> {
    const method = req.method?.toUpperCase();
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
      return null;
    }

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return null;
    }

    return new Promise((resolve, reject) => {
      let totalBytes = 0;
      const chunks: Buffer[] = [];

      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY_SIZE_BYTES) {
          req.destroy();
          return reject(new Error('PAYLOAD_TOO_LARGE'));
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (chunks.length === 0) {
          return resolve(null);
        }
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (!raw.trim()) {
            return resolve(null);
          }
          const parsed = JSON.parse(raw);
          resolve(parsed);
        } catch {
          reject(new Error('INVALID_JSON'));
        }
      });

      req.on('error', (err) => reject(err));
    });
  }

  /**
   * Main HTTP dispatch entry point. Parses request parameters, query strings, body,
   * matches registered route patterns, and executes the middleware and handler chain.
   *
   * @param req - Raw Node.js IncomingMessage.
   * @param res - Node.js ServerResponse.
   */
  public async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host || '127.0.0.1';
    const parsedUrl = new URL(req.url || '/', `http://${host}`);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase() || 'GET';

    let effectivePathname = pathname;
    const routingMode = (process.env['OPERATOR_ROUTING_MODE'] || 'subdomain').toLowerCase();
    let operatorSlug: string | undefined;

    if (routingMode === 'path' || routingMode === 'both') {
      const pathMatch = pathname.match(/^\/(?:o|operator)\/([a-z0-9-]+)(\/.*)?$/i);
      if (pathMatch && pathMatch[1]) {
        operatorSlug = pathMatch[1].toLowerCase();
        effectivePathname = pathMatch[2] || '/';
      }
    }

    const query: Record<string, string> = {};
    parsedUrl.searchParams.forEach((val, key) => {
      query[key] = val;
    });

    const apiReq = req as ApiRequest;
    apiReq.query = query;
    apiReq.path = effectivePathname;
    apiReq.params = {};
    apiReq.operatorSlug = operatorSlug;

    try {
      apiReq.body = await this.parseBody(req);
    } catch (err: any) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        return errorResponse(res, 'PAYLOAD_TOO_LARGE', 'Request payload exceeds 1MB limit', 413);
      }
      return errorResponse(res, 'INVALID_JSON', 'Malformed JSON in request body', 400);
    }

    // Match route
    let matchedRoute: RouteEntry | null = null;
    const params: Record<string, string> = {};

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = effectivePathname.match(route.regex);
      if (match) {
        matchedRoute = route;
        route.paramNames.forEach((name, index) => {
          const matchedVal = match[index + 1];
          if (matchedVal !== undefined) {
            params[name] = decodeURIComponent(matchedVal);
          }
        });
        break;
      }
    }

    apiReq.params = params;

    // Execute middleware chain then handler
    let index = 0;
    const allMiddlewares = [...this.middlewares];

    const next = async (): Promise<void> => {
      if (index < allMiddlewares.length) {
        const mw = allMiddlewares[index++]!;
        await mw(apiReq, res, next);
      } else if (matchedRoute) {
        for (const handler of matchedRoute.handlers) {
          if (res.writableEnded) break;
          await handler(apiReq, res);
        }
      } else {
        if (method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Operator-ID, X-Request-ID, X-User-ID'
          });
          res.end();
          return;
        }
        errorResponse(res, 'NOT_FOUND', `Route ${method} ${pathname} not found`, 404);
      }
    };

    try {
      await next();
    } catch (error: any) {
      if (!res.writableEnded) {
        const statusCode = error.statusCode || (error.code === 'VALIDATION_ERROR' ? 400 : 500);
        errorResponse(
          res,
          error.code || 'INTERNAL_ERROR',
          error.message || 'An unexpected internal server error occurred',
          statusCode,
          error.details
        );
      }
    }
  }
}
