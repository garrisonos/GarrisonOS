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

  // =========================================================================
  // RECURRING LEASE CHARGES
  // =========================================================================

  router.get('/api/v1/leases/:id/recurring_charges', (req, res) => {
    const charges = LeasesRepository.listRecurringCharges(req.params.id!);
    successResponse(res, { charges });
  });

  router.post('/api/v1/leases/:id/recurring_charges', (req, res) => {
    const { charge_category, amount_cents, gl_account_id, billing_frequency, billing_day, description } = req.body || {};

    const validCategories = ['base_rent', 'pet_rent', 'parking_fee', 'storage_fee', 'utility_surcharge', 'amenity_fee'];
    if (!charge_category || !validCategories.includes(charge_category)) {
      return errorResponse(
        res,
        'VALIDATION_ERROR',
        `charge_category must be one of: ${validCategories.join(', ')}`,
        400
      );
    }

    if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
      return errorResponse(res, 'VALIDATION_ERROR', 'amount_cents must be a positive integer in cents', 400);
    }

    if (!description || typeof description !== 'string') {
      return errorResponse(res, 'VALIDATION_ERROR', 'description is required', 400);
    }

    try {
      const charge = LeasesRepository.addRecurringCharge({
        lease_id: req.params.id!,
        charge_category,
        amount_cents,
        gl_account_id,
        billing_frequency,
        billing_day,
        description
      });
      successResponse(res, { charge }, 201);
    } catch (err: any) {
      return errorResponse(res, 'VALIDATION_ERROR', err.message, 400);
    }
  });

  router.delete('/api/v1/leases/:id/recurring_charges/:charge_id', (req, res) => {
    const chargeId = req.params.charge_id || req.params.chargeId;
    const deleted = LeasesRepository.deleteRecurringCharge(chargeId!);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Recurring charge not found', 404);
    }
    successResponse(res, { deleted: true });
  });

  // =========================================================================
  // LATE FEE POLICIES & DELINQUENCY
  // =========================================================================

  router.get('/api/v1/leases/late_fee_policies', (_req, res) => {
    const policies = LeasesRepository.listLateFeePolicies();
    successResponse(res, { policies });
  });

  router.post('/api/v1/leases/late_fee_policies', (req, res) => {
    const {
      portfolio_id,
      property_id,
      grace_period_days,
      due_day,
      calculation_type,
      flat_fee_cents,
      percentage_bps,
      delinquency_threshold_cents,
      statutory_cap_cents
    } = req.body || {};

    const validTypes = ['flat_fee', 'percentage_of_delinquency', 'daily_accrual'];
    if (!calculation_type || !validTypes.includes(calculation_type)) {
      return errorResponse(
        res,
        'VALIDATION_ERROR',
        `calculation_type must be one of: ${validTypes.join(', ')}`,
        400
      );
    }

    try {
      const policy = LeasesRepository.createLateFeePolicy({
        portfolio_id,
        property_id,
        grace_period_days,
        due_day,
        calculation_type,
        flat_fee_cents,
        percentage_bps,
        delinquency_threshold_cents,
        statutory_cap_cents
      });
      successResponse(res, { policy }, 201);
    } catch (err: any) {
      return errorResponse(res, 'VALIDATION_ERROR', err.message, 400);
    }
  });

  router.get('/api/v1/leases/:id/late_fee_policy', (req, res) => {
    const policy = LeasesRepository.getActiveLateFeePolicyForLease(req.params.id!);
    successResponse(res, { policy });
  });

  router.get('/api/v1/leases/:id/calculate_late_fee', (req, res) => {
    let asOfDateMs: number | undefined;
    const rawAsOf = req.query['as_of'];
    if (rawAsOf !== undefined && rawAsOf !== null && rawAsOf !== '') {
      const parsed = Number(rawAsOf);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return errorResponse(
          res,
          'VALIDATION_ERROR',
          'Query parameter "as_of" must be a positive integer millisecond timestamp',
          400
        );
      }
      asOfDateMs = parsed;
    }

    try {
      const delinquency = LeasesRepository.calculateLateFee(req.params.id!, asOfDateMs);
      successResponse(res, { delinquency });
    } catch (err: any) {
      return errorResponse(res, 'VALIDATION_ERROR', err.message, 400);
    }
  });

  router.post('/api/v1/leases/:id/apply_late_fee', (req, res) => {
    let asOfDateMs: number | undefined;
    const rawAsOf = req.body?.as_of ?? req.query['as_of'];
    if (rawAsOf !== undefined && rawAsOf !== null && rawAsOf !== '') {
      const parsed = Number(rawAsOf);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return errorResponse(
          res,
          'VALIDATION_ERROR',
          'Parameter "as_of" must be a positive integer millisecond timestamp',
          400
        );
      }
      asOfDateMs = parsed;
    }

    try {
      const outcome = LeasesRepository.applyLateFee(req.params.id!, asOfDateMs);
      successResponse(res, outcome);
    } catch (err: any) {
      return errorResponse(res, 'VALIDATION_ERROR', err.message, 400);
    }
  });

  // =========================================================================
  // LEASE CREDITS & CONCESSIONS
  // =========================================================================

  router.get('/api/v1/leases/:id/credits', (req, res) => {
    const credits = LeasesRepository.listCreditConcessions(req.params.id!);
    successResponse(res, { credits });
  });

  router.post('/api/v1/leases/:id/credits', (req, res) => {
    const { credit_type, amount_cents, gl_account_id, reason, effective_date } = req.body || {};

    const validTypes = ['promotional_concession', 'maintenance_inconvenience', 'discretionary_credit', 'bad_debt_writeoff'];
    if (!credit_type || !validTypes.includes(credit_type)) {
      return errorResponse(
        res,
        'VALIDATION_ERROR',
        `credit_type must be one of: ${validTypes.join(', ')}`,
        400
      );
    }

    if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
      return errorResponse(res, 'VALIDATION_ERROR', 'amount_cents must be a positive integer in cents', 400);
    }

    if (!reason || typeof reason !== 'string') {
      return errorResponse(res, 'VALIDATION_ERROR', 'reason is required', 400);
    }

    try {
      const credit = LeasesRepository.addCreditConcession({
        lease_id: req.params.id!,
        credit_type,
        amount_cents,
        gl_account_id,
        reason,
        effective_date
      });
      successResponse(res, { credit }, 201);
    } catch (err: any) {
      return errorResponse(res, 'VALIDATION_ERROR', err.message, 400);
    }
  });

  // =========================================================================
  // SECURITY DEPOSIT REFUNDS
  // =========================================================================

  router.get('/api/v1/leases/:id/refunds', (req, res) => {
    const refunds = LeasesRepository.listDepositRefunds(req.params.id!);
    successResponse(res, { refunds });
  });

  router.post('/api/v1/leases/:id/refunds', (req, res) => {
    const {
      recipient_contact_id,
      refund_type,
      refund_amount_cents,
      funding_account_id,
      disbursement_method,
      check_number,
      disbursement_date
    } = req.body || {};

    if (!recipient_contact_id) {
      return errorResponse(res, 'VALIDATION_ERROR', 'recipient_contact_id is required', 400);
    }

    const validTypes = ['deposit_disposition', 'overpayment_return'];
    if (!refund_type || !validTypes.includes(refund_type)) {
      return errorResponse(
        res,
        'VALIDATION_ERROR',
        `refund_type must be one of: ${validTypes.join(', ')}`,
        400
      );
    }

    if (!Number.isInteger(refund_amount_cents) || refund_amount_cents <= 0) {
      return errorResponse(res, 'VALIDATION_ERROR', 'refund_amount_cents must be a positive integer in cents', 400);
    }

    const validMethods = ['check', 'ach'];
    if (!disbursement_method || !validMethods.includes(disbursement_method)) {
      return errorResponse(
        res,
        'VALIDATION_ERROR',
        `disbursement_method must be one of: ${validMethods.join(', ')}`,
        400
      );
    }

    try {
      const refund = LeasesRepository.issueDepositRefund({
        lease_id: req.params.id!,
        recipient_contact_id,
        refund_type,
        refund_amount_cents,
        funding_account_id,
        disbursement_method,
        check_number,
        disbursement_date
      });
      successResponse(res, { refund }, 201);
    } catch (err: any) {
      return errorResponse(res, 'VALIDATION_ERROR', err.message, 400);
    }
  });
}

