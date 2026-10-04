import { HookRegistry } from '../../../web/lib/hooks.js';

HookRegistry.registerNavigation({
  label: 'Accounting',
  route: '/accounting',
  icon: 'dollar-sign',
  order: 40,
  section: 'financial'
});

HookRegistry.registerNavigation({
  label: 'Bills & AP',
  route: '/accounting/bills',
  icon: 'file-text',
  order: 41,
  section: 'financial'
});

HookRegistry.registerNavigation({
  label: 'Check Register',
  route: '/accounting/checks',
  icon: 'dollar-sign',
  order: 42,
  section: 'financial'
});

HookRegistry.registerNavigation({
  label: 'Bank Deposits',
  route: '/accounting/deposits',
  icon: 'database',
  order: 43,
  section: 'financial'
});

HookRegistry.registerNavigation({
  label: 'General Ledger',
  route: '/accounting/general-ledger',
  icon: 'book',
  order: 44,
  section: 'financial'
});

HookRegistry.registerNavigation({
  label: 'Trial Balance',
  route: '/accounting/trial-balance',
  icon: 'file-bar-chart',
  order: 45,
  section: 'financial'
});

HookRegistry.registerNavigation({
  label: 'Rent Roll',
  route: '/accounting/rent-roll',
  icon: 'list',
  order: 46,
  section: 'financial'
});

HookRegistry.registerNavigation({
  label: 'Schedule E Tax',
  route: '/accounting/schedule-e',
  icon: 'file-bar-chart',
  order: 47,
  section: 'financial'
});

HookRegistry.registerNavigation({
  label: 'QuickBooks Sync',
  route: '/accounting/quickbooks',
  icon: 'file-text',
  order: 48,
  section: 'financial'
});

HookRegistry.registerNavigation({
  label: 'Chart of Accounts',
  route: '/accounting/chart-of-accounts',
  icon: 'file-text',
  order: 49,
  section: 'financial'
});

HookRegistry.registerNavigation({
  label: 'Client Accounting',
  route: '/accounting/client-accounting',
  icon: 'file-bar-chart',
  order: 50,
  section: 'financial'
});

HookRegistry.registerDashboardCard('/api/v1/accounting/rent-roll', (res: any) => {
  try {
    if (!res || res.success !== true) {
      return null;
    }
    const summary = res.data?.summary || {};
    const delinquencyCents = summary.totalDelinquencyCents ?? 0;
    const scheduledCents = summary.totalScheduledRentCents ?? 0;

    const delFmt = (delinquencyCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const schedFmt = (scheduledCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return {
      id: 'delinquency_metric',
      title: 'Delinquent Balance',
      value: `$${delFmt}`,
      subtitle: `Against $${schedFmt} total monthly roll`,
      order: 20
    };
  } catch {
    return null;
  }
});
