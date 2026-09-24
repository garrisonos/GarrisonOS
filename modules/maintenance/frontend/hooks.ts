import { HookRegistry } from '../../../web/lib/hooks.js';

HookRegistry.registerNavigation({
  label: 'Maintenance',
  route: '/maintenance',
  icon: 'tool',
  order: 50,
  section: 'operations'
});

HookRegistry.registerNavigation({
  label: 'Preventative Maintenance',
  route: '/maintenance/preventative',
  icon: 'calendar',
  order: 55,
  section: 'operations'
});

HookRegistry.registerDashboardCard('/api/v1/maintenance/metrics', (res: any) => {
  try {
    if (!res || res.success !== true) {
      return null;
    }
    const metrics = res.data?.metrics || {};
    const openOrders = metrics.openWorkOrders ?? 0;
    const emergencies = metrics.emergencyWorkOrders ?? 0;

    return {
      id: 'maintenance_metric',
      title: 'Open Work Orders',
      value: String(openOrders),
      subtitle: emergencies > 0 ? `${emergencies} emergency repairs pending` : 'All priority levels normal',
      order: 30
    };
  } catch {
    return null;
  }
});
