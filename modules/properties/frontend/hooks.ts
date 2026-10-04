import { HookRegistry } from '../../../web/lib/hooks.js';

HookRegistry.registerNavigation({
  label: 'Properties',
  route: '/properties',
  icon: 'building',
  order: 10,
  section: 'portfolio'
});

HookRegistry.registerNavigation({
  label: 'Amenities Catalog',
  route: '/properties/amenities',
  icon: 'list',
  order: 15,
  section: 'portfolio'
});

HookRegistry.registerDashboardCard('/api/v1/properties/metrics/occupancy', (res: any) => {
  try {
    if (!res || res.success !== true) {
      return null;
    }
    const metrics = res.data?.metrics || {};
    const occupancyRate = metrics.occupancyRatePercentage ?? 0;
    const totalUnits = metrics.totalUnits ?? 0;
    const occupiedUnits = metrics.occupiedUnits ?? 0;

    return {
      id: 'occupancy_metric',
      title: 'Portfolio Occupancy',
      value: `${Number(occupancyRate).toFixed(1)}%`,
      subtitle: `${occupiedUnits} of ${totalUnits} units occupied`,
      order: 10
    };
  } catch {
    return null;
  }
});
