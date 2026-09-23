import { Router } from '../../../api/router.js';
import { successResponse, errorResponse } from '../../../api/response.js';
import { MaintenanceRepository } from './repository.js';
import { eventBus } from '../../../core/events.js';
import { RequestContext } from '../../../core/context.js';

/**
 * Register REST API routes for the Maintenance module.
 *
 * @param router - Application HTTP router.
 */
export function registerRoutes(router: Router): void {
  router.getBatchSafe('/api/v1/maintenance/metrics', (_req, res) => {
    const metrics = MaintenanceRepository.getMaintenanceMetrics();
    successResponse(res, { metrics });
  });

  router.getBatchSafe('/api/v1/maintenance/work-orders', (req, res) => {
    const workOrders = MaintenanceRepository.listWorkOrders({
      status: req.query['status'],
      priority: req.query['priority'],
      property_id: req.query['property_id'],
      unit_id: req.query['unit_id']
    });
    successResponse(res, { workOrders });
  });

  router.post('/api/v1/maintenance/work-orders', (req, res) => {
    const { property_id, title, description } = req.body || {};
    if (!property_id || !title || !description) {
      return errorResponse(res, 'VALIDATION_ERROR', 'property_id, title, and description are required', 400);
    }
    try {
      const workOrder = MaintenanceRepository.createWorkOrder(req.body);
      successResponse(res, { workOrder }, 201);
    } catch (err) {
      return errorResponse(res, 'VALIDATION_ERROR', (err as Error).message, 400);
    }
  });

  router.get('/api/v1/maintenance/work-orders/:id', (req, res) => {
    const workOrder = MaintenanceRepository.getWorkOrderById(req.params['id']!);
    if (!workOrder) {
      return errorResponse(res, 'NOT_FOUND', 'Work order not found', 404);
    }
    successResponse(res, { workOrder });
  });

  router.put('/api/v1/maintenance/work-orders/:id', (req, res) => {
    try {
      const workOrder = MaintenanceRepository.updateWorkOrder(req.params['id']!, req.body || {});
      if (!workOrder) {
        return errorResponse(res, 'NOT_FOUND', 'Work order not found', 404);
      }
      successResponse(res, { workOrder });
    } catch (err) {
      return errorResponse(res, 'VALIDATION_ERROR', (err as Error).message, 400);
    }
  });

  router.post('/api/v1/maintenance/work-orders/:id/complete', (req, res) => {
    const { actual_cost_cents } = req.body || {};
    let cost: number | undefined = undefined;
    if (actual_cost_cents !== undefined) {
      const parsed = Number(actual_cost_cents);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return errorResponse(res, 'VALIDATION_ERROR', 'actual_cost_cents must be a non-negative integer in cents', 400);
      }
      cost = parsed;
    }

    const workOrder = MaintenanceRepository.completeWorkOrder(req.params['id']!, cost);
    if (!workOrder) {
      return errorResponse(res, 'NOT_FOUND', 'Work order not found', 404);
    }

    // Publish work_order.completed event
    eventBus.publish('work_order.completed', {
      workOrderId: workOrder.id,
      propertyId: workOrder.property_id,
      unitId: workOrder.unit_id || undefined,
      actualCostCents: workOrder.actual_cost_cents,
      operatorId: RequestContext.getOperatorId()
    });

    successResponse(res, { workOrder });
  });

  router.delete('/api/v1/maintenance/work-orders/:id', (req, res) => {
    const deleted = MaintenanceRepository.deleteWorkOrder(req.params['id']!);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Work order not found', 404);
    }
    successResponse(res, { deleted: true });
  });

  // --- Preventative Maintenance Schedules ---

  router.getBatchSafe('/api/v1/maintenance/preventative_schedules', (req, res) => {
    let dueBefore: number | undefined;
    if (req.query['due_before'] !== undefined) {
      const parsed = Number(req.query['due_before']);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return errorResponse(res, 'VALIDATION_ERROR', 'due_before must be a positive integer timestamp', 400);
      }
      dueBefore = parsed;
    }

    const schedules = MaintenanceRepository.listPreventativeSchedules({
      property_id: req.query['property_id'],
      category: req.query['category'],
      is_active: req.query['is_active'] !== undefined ? req.query['is_active'] === 'true' || req.query['is_active'] === '1' : undefined,
      due_before: dueBefore
    });

    successResponse(res, schedules);
  });

  router.post('/api/v1/maintenance/preventative_schedules', (req, res) => {
    const { title, description, category, priority, frequency, next_due_date } = req.body || {};
    if (!title || !description || !category || !priority || !frequency || next_due_date === undefined) {
      return errorResponse(
        res,
        'VALIDATION_ERROR',
        'title, description, category, priority, frequency, and next_due_date are required',
        400
      );
    }

    const parsedDue = Number(next_due_date);
    if (!Number.isInteger(parsedDue) || parsedDue <= 0) {
      return errorResponse(res, 'VALIDATION_ERROR', 'next_due_date must be a positive integer millisecond timestamp', 400);
    }

    try {
      const schedule = MaintenanceRepository.createPreventativeSchedule({
        ...req.body,
        next_due_date: parsedDue
      });
      successResponse(res, schedule, 201);
    } catch (err: any) {
      return errorResponse(res, 'VALIDATION_ERROR', err?.message || 'Failed to create schedule', 400);
    }
  });

  router.get('/api/v1/maintenance/preventative_schedules/:id', (req, res) => {
    const id = req.params['id'];
    if (!id) {
      return errorResponse(res, 'VALIDATION_ERROR', 'id parameter is required', 400);
    }
    const schedule = MaintenanceRepository.getPreventativeSchedule(id);
    if (!schedule) {
      return errorResponse(res, 'NOT_FOUND', 'Preventative schedule not found', 404);
    }
    successResponse(res, schedule);
  });

  router.put('/api/v1/maintenance/preventative_schedules/:id', (req, res) => {
    const id = req.params['id'];
    if (!id) {
      return errorResponse(res, 'VALIDATION_ERROR', 'id parameter is required', 400);
    }
    try {
      const updated = MaintenanceRepository.updatePreventativeSchedule(id, req.body || {});
      successResponse(res, updated);
    } catch (err: any) {
      if (err?.message?.includes('not found')) {
        return errorResponse(res, 'NOT_FOUND', 'Preventative schedule not found', 404);
      }
      return errorResponse(res, 'VALIDATION_ERROR', err?.message || 'Failed to update schedule', 400);
    }
  });

  router.delete('/api/v1/maintenance/preventative_schedules/:id', (req, res) => {
    const id = req.params['id'];
    if (!id) {
      return errorResponse(res, 'VALIDATION_ERROR', 'id parameter is required', 400);
    }
    const deleted = MaintenanceRepository.deletePreventativeSchedule(id);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Preventative schedule not found', 404);
    }
    successResponse(res, { deleted: true, id });
  });

  router.post('/api/v1/maintenance/preventative_schedules/:id/trigger', (req, res) => {
    const id = req.params['id'];
    if (!id) {
      return errorResponse(res, 'VALIDATION_ERROR', 'id parameter is required', 400);
    }
    try {
      const workOrder = MaintenanceRepository.triggerPreventativeSchedule(id);
      successResponse(res, { workOrder }, 201);
    } catch (err: any) {
      if (err?.message?.includes('not found')) {
        return errorResponse(res, 'NOT_FOUND', 'Preventative schedule not found', 404);
      }
      return errorResponse(res, 'INTERNAL_ERROR', err?.message || 'Failed to trigger schedule', 500);
    }
  });

  router.post('/api/v1/maintenance/preventative_schedules/run', (_req, res) => {
    try {
      const generated = MaintenanceRepository.runPreventativeMaintenanceCheck();
      successResponse(res, { generated_work_orders: generated, count: generated.length });
    } catch (err: any) {
      return errorResponse(res, 'INTERNAL_ERROR', err?.message || 'Failed to run preventative check', 500);
    }
  });
}

