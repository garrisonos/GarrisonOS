import { Router } from '../../../api/router.js';
import { successResponse, errorResponse } from '../../../api/response.js';
import { LeasesRepository } from './repository.js';
import { eventBus } from '../../../core/events.js';
import { RequestContext } from '../../../core/context.js';

export function registerRoutes(router: Router): void {
  router.get('/api/v1/leases', (req, res) => {
    const leases = LeasesRepository.listLeases({
      status: req.query.status,
      unit_id: req.query.unit_id
    });
    successResponse(res, { leases });
  });

  router.post('/api/v1/leases', (req, res) => {
    const { unit_id, start_date, end_date, rent_amount_cents } = req.body || {};
    if (!unit_id || !start_date || !end_date || rent_amount_cents === undefined) {
      return errorResponse(res, 'VALIDATION_ERROR', 'unit_id, start_date, end_date, and rent_amount_cents are required', 400);
    }
    const lease = LeasesRepository.createLease(req.body);
    successResponse(res, { lease }, 201);
  });

  router.get('/api/v1/leases/:id', (req, res) => {
    const lease = LeasesRepository.getLeaseById(req.params.id!);
    if (!lease) {
      return errorResponse(res, 'NOT_FOUND', 'Lease not found', 404);
    }
    successResponse(res, { lease });
  });

  router.put('/api/v1/leases/:id', (req, res) => {
    const lease = LeasesRepository.updateLease(req.params.id!, req.body || {});
    if (!lease) {
      return errorResponse(res, 'NOT_FOUND', 'Lease not found', 404);
    }
    successResponse(res, { lease });
  });

  router.post('/api/v1/leases/:id/activate', (req, res) => {
    const lease = LeasesRepository.updateLeaseStatus(req.params.id!, 'active');
    if (!lease) {
      return errorResponse(res, 'NOT_FOUND', 'Lease not found', 404);
    }

    // Publish lease.activated event
    eventBus.publish('lease.activated', {
      leaseId: lease.id,
      unitId: lease.unit_id,
      operatorId: RequestContext.getOperatorId(),
      rentAmountCents: lease.rent_amount_cents
    });

    successResponse(res, { lease, status: 'active' });
  });

  router.post('/api/v1/leases/:id/terminate', (req, res) => {
    const { notice_date, move_out_date } = req.body || {};
    let parsedNoticeDate: number | undefined;
    let parsedMoveOutDate: number | undefined;

    if (notice_date !== undefined && notice_date !== null && notice_date !== '') {
      parsedNoticeDate = Number(notice_date);
      if (!Number.isFinite(parsedNoticeDate) || parsedNoticeDate <= 0) {
        return errorResponse(res, 'VALIDATION_ERROR', 'notice_date must be a valid positive epoch timestamp', 400);
      }
    }

    if (move_out_date !== undefined && move_out_date !== null && move_out_date !== '') {
      parsedMoveOutDate = Number(move_out_date);
      if (!Number.isFinite(parsedMoveOutDate) || parsedMoveOutDate <= 0) {
        return errorResponse(res, 'VALIDATION_ERROR', 'move_out_date must be a valid positive epoch timestamp', 400);
      }
    }

    const lease = LeasesRepository.updateLeaseStatus(req.params.id!, 'terminated', parsedNoticeDate, parsedMoveOutDate);
    if (!lease) {
      return errorResponse(res, 'NOT_FOUND', 'Lease not found', 404);
    }

    // Publish lease.terminated event
    eventBus.publish('lease.terminated', {
      leaseId: lease.id,
      unitId: lease.unit_id,
      operatorId: RequestContext.getOperatorId()
    });

    successResponse(res, { lease, status: 'terminated' });
  });

  router.post('/api/v1/leases/:id/contacts', (req, res) => {
    const { contact_id, role, is_financially_responsible } = req.body || {};
    if (!contact_id || !role) {
      return errorResponse(res, 'VALIDATION_ERROR', 'contact_id and role are required', 400);
    }
    const added = LeasesRepository.addLeaseContact(
      req.params.id!,
      contact_id,
      role,
      is_financially_responsible !== false
    );
    if (!added) {
      return errorResponse(res, 'NOT_FOUND', 'Unable to add signatory to lease', 400);
    }
    const lease = LeasesRepository.getLeaseById(req.params.id!);
    successResponse(res, { lease });
  });

  router.delete('/api/v1/leases/:id/contacts/:contact_id', (req, res) => {
    const contactId = req.params.contact_id || req.params.contactId;
    const removed = LeasesRepository.removeLeaseContact(req.params.id!, contactId!);
    if (!removed) {
      return errorResponse(res, 'NOT_FOUND', 'Signatory not found on lease', 404);
    }
    successResponse(res, { removed: true });
  });

  router.delete('/api/v1/leases/:id', (req, res) => {
    const deleted = LeasesRepository.deleteLease(req.params.id!);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Lease not found', 404);
    }
    successResponse(res, { deleted: true });
  });
}
