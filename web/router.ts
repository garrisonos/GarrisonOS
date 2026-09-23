/**
 * GarrisonOS Web Presentation Layer - Front Controller & Router
 *
 * Directs incoming web requests to appropriate page handlers, handles authentication
 * and first-launch setup verification, CSRF enforcement, layout decoration, and error handling.
 * Pure zero-dependency Node.js execution.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ServerResponse } from 'node:http';
import { PageContext, PageResult, PageHandler } from './lib/page-context.js';
import { renderLayout } from './templates/layout.js';
import { renderNotFoundPage } from './pages/notFound.js';
import { renderErrorPage } from './pages/error.js';
import { HookRegistry } from './lib/hooks.js';

// Import core page handlers
import * as DashboardPage from './pages/dashboard.js';
import * as LoginPage from './pages/login.js';
import * as SetupPage from './pages/setup.js';
import * as AdminPage from './pages/admin.js';

// Import module page handlers
import * as PropertiesIndex from '../modules/properties/frontend/pages/index.js';
import * as PropertiesShow from '../modules/properties/frontend/pages/show.js';
import * as PropertiesEdit from '../modules/properties/frontend/pages/edit.js';

import * as ContactsIndex from '../modules/contacts/frontend/pages/index.js';
import * as ContactsShow from '../modules/contacts/frontend/pages/show.js';

import * as LeasesIndex from '../modules/leases/frontend/pages/index.js';
import * as LeasesShow from '../modules/leases/frontend/pages/show.js';

import * as MaintenanceIndex from '../modules/maintenance/frontend/pages/index.js';
import * as MaintenanceShow from '../modules/maintenance/frontend/pages/show.js';
import * as MaintenancePreventative from '../modules/maintenance/frontend/pages/preventative.js';

import * as AccountingIndex from '../modules/accounting/frontend/pages/index.js';
import * as AccountingClient from '../modules/accounting/frontend/pages/client-accounting.js';
import * as AccountingCOA from '../modules/accounting/frontend/pages/chart-of-accounts.js';
import * as AccountingGL from '../modules/accounting/frontend/pages/general-ledger.js';
import * as AccountingDetail from '../modules/accounting/frontend/pages/ledger-detail.js';
import * as AccountingQB from '../modules/accounting/frontend/pages/quickbooks.js';
import * as AccountingRentRoll from '../modules/accounting/frontend/pages/rent-roll.js';
import * as AccountingScheduleE from '../modules/accounting/frontend/pages/schedule-e.js';
import * as AccountingTrialBalance from '../modules/accounting/frontend/pages/trial-balance.js';

import * as BackupIndex from '../modules/backup/frontend/pages/index.js';

const handleConversationCreate: PageHandler = async (ctx) => {
  const returnUrl = ctx.body['return_url'] || '/dashboard';
  try {
    const isPrivate = ctx.body['is_private'] === '1' || ctx.body['is_private'] === true;
    await ctx.api.post('/api/v1/conversations', {
      entity_type: ctx.body['entity_type'],
      entity_id: ctx.body['entity_id'],
      subject: ctx.body['subject'],
      body: ctx.body['body'],
      is_private: isPrivate
    });
    ctx.session.addFlash('success', 'Conversation thread created successfully');
  } catch (err: any) {
    ctx.session.addFlash('error', `Failed to create conversation: ${err.message}`);
  }
  return { redirect: returnUrl, content: '' };
};

const handleConversationReply: PageHandler = async (ctx) => {
  const convId = ctx.body['conversation_id'];
  const returnUrl = ctx.body['return_url'] || '/dashboard';
  try {
    await ctx.api.post(`/api/v1/conversations/${encodeURIComponent(convId)}/messages`, {
      body: ctx.body['body']
    });
    ctx.session.addFlash('success', 'Reply posted');
  } catch (err: any) {
    ctx.session.addFlash('error', `Failed to post reply: ${err.message}`);
  }
  return { redirect: returnUrl, content: '' };
};

const ROUTE_TABLE: Record<string, PageHandler> = {
  '/': DashboardPage.handle,
  '/dashboard': DashboardPage.handle,
  '/login': LoginPage.handle,
  '/setup': SetupPage.handle,
  '/admin': AdminPage.handle,

  '/properties': PropertiesIndex.handle,
  '/properties/show': PropertiesShow.handle,
  '/properties/edit': PropertiesEdit.handle,

  '/contacts': ContactsIndex.handle,
  '/contacts/show': ContactsShow.handle,

  '/leases': LeasesIndex.handle,
  '/leases/show': LeasesShow.handle,

  '/maintenance': MaintenanceIndex.handle,
  '/maintenance/show': MaintenanceShow.handle,
  '/maintenance/preventative': MaintenancePreventative.handle,

  '/accounting': AccountingIndex.handle,
  '/accounting/client-accounting': AccountingClient.handle,
  '/accounting/chart-of-accounts': AccountingCOA.handle,
  '/accounting/general-ledger': AccountingGL.handle,
  '/accounting/ledger-detail': AccountingDetail.handle,
  '/accounting/quickbooks': AccountingQB.handle,
  '/accounting/rent-roll': AccountingRentRoll.handle,
  '/accounting/schedule-e': AccountingScheduleE.handle,
  '/accounting/trial-balance': AccountingTrialBalance.handle,

  '/conversations/create': handleConversationCreate,
  '/conversations/reply': handleConversationReply,

  '/backup': BackupIndex.handle,
  '/backups': BackupIndex.handle,
};

/**
 * Web front-controller router that directs incoming HTTP presentation requests
 * to appropriate SSR page handlers, verifies setup status and sessions, and handles redirects.
 */
export class WebRouter {
  /**
   * Handle incoming request and dispatch to target page handler.
   *
   * @param ctx - Page context encapsulating HTTP request, response, session, and API client.
   */
  public static async dispatch(ctx: PageContext): Promise<void> {
    const rawPath = ctx.url.pathname.replace(/\/+$/, '') || '/';

    // Handle logout
    if (rawPath === '/logout') {
      ctx.session.clear();
      this.redirect(ctx.res, '/login');
      return;
    }

    // System configuration check (First-Launch Setup Detection)
    let isConfigured = true;
    try {
      const statusRes = await ctx.api.get('/api/v1/system/status');
      isConfigured = !!statusRes?.data?.is_configured;
    } catch {
      // If status check fails, assume configured to avoid blocking normal flow
    }

    if (!isConfigured && rawPath !== '/setup') {
      this.redirect(ctx.res, '/setup');
      return;
    }

    if (isConfigured && rawPath === '/setup') {
      this.redirect(ctx.res, '/login');
      return;
    }

    // Authentication Guard
    const publicPaths = ['/login', '/setup'];
    const isPublic = publicPaths.includes(rawPath);

    if (!isPublic && !ctx.session.user) {
      this.redirect(ctx.res, '/login');
      return;
    }

    // Find handler in static route table
    let handler: PageHandler | null | undefined = Object.hasOwn(ROUTE_TABLE, rawPath)
      ? ROUTE_TABLE[rawPath]
      : null;

    // Fallback: Dynamic module page resolution
    if (!handler) {
      handler = await this.resolveDynamicRoute(rawPath);
    }

    if (!handler) {
      const notFoundContent = renderNotFoundPage();
      const body = renderLayout({
        title: '404 Not Found',
        content: notFoundContent,
        user: ctx.session.user,
        operatorId: ctx.session.operatorId,
        navItems: HookRegistry.getNavigation(),
        flashMessages: ctx.session.getFlash(),
        currentPath: rawPath,
      });
      ctx.res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      ctx.res.end(body);
      return;
    }

    try {
      const result = await handler(ctx);
      if (!result) {
        if (!ctx.res.writableEnded) {
          ctx.res.end();
        }
        return;
      }

      if (result.redirect) {
        this.redirect(ctx.res, result.redirect, result.status || 302);
        return;
      }

      if (result.isFullDocument) {
        const docString = typeof result.content === 'string' ? result.content : result.content.toString();
        ctx.res.writeHead(result.status || 200, { 'Content-Type': 'text/html; charset=utf-8' });
        ctx.res.end(docString);
        return;
      }

      const body = renderLayout({
        title: result.title,
        content: result.content,
        user: ctx.session.user,
        operatorId: ctx.session.operatorId,
        navItems: HookRegistry.getNavigation(),
        flashMessages: ctx.session.getFlash(),
        currentPath: rawPath,
      });

      ctx.res.writeHead(result.status || 200, { 'Content-Type': 'text/html; charset=utf-8' });
      ctx.res.end(body);
    } catch (err) {
      process.stderr.write(`[web] Page handler error: ${String(err)}\n`);
      const errorContent = renderErrorPage(
        'An unexpected error occurred while communicating with the GarrisonOS core engine.',
        'SYSTEM_ERROR'
      );

      const body = renderLayout({
        title: 'Error',
        content: errorContent,
        user: ctx.session.user,
        operatorId: ctx.session.operatorId,
        navItems: HookRegistry.getNavigation(),
        flashMessages: ctx.session.getFlash(),
        currentPath: rawPath,
      });

      ctx.res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      ctx.res.end(body);
    }
  }

  /**
   * Send HTTP redirect response.
   */
  private static redirect(res: ServerResponse, location: string, status: number = 302): void {
    res.setHeader('Location', location);
    res.writeHead(status);
    res.end();
  }

  /**
   * Attempt dynamic resolution for /<module>/<page>
   */
  private static async resolveDynamicRoute(routePath: string): Promise<PageHandler | null> {
    const segments = routePath.split('/').filter(Boolean);
    const modRaw = segments[0];
    if (!modRaw) return null;

    const mod = modRaw === 'backups' ? 'backup' : modRaw;
    const page = segments[1] || 'index';

    const baseDir = process.cwd();
    const candidateDist = path.resolve(baseDir, 'dist/modules', mod, 'frontend/pages', `${page}.js`);
    const candidateSrc = path.resolve(baseDir, 'modules', mod, 'frontend/pages', `${page}.ts`);

    const targetFile = fs.existsSync(candidateDist) ? candidateDist : fs.existsSync(candidateSrc) ? candidateSrc : null;
    if (!targetFile) return null;

    try {
      const modImport = await import(pathToFileURL(targetFile).href);
      if (typeof modImport.handle === 'function') {
        return modImport.handle;
      }
    } catch {
      return null;
    }

    return null;
  }
}
