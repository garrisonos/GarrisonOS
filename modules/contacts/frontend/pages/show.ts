import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { renderCustomFields } from '../../../../web/templates/custom-fields.js';

/**
 * Handles presentation requests for viewing a single contact detail view,
 * including contact metadata, tax classification, and vendor information.
 *
 * @param ctx - The active web page request context.
 * @returns A promise resolving to the rendered PageResult or redirect.
 */
export async function handle(ctx: PageContext): Promise<PageResult> {
  const id = ctx.query['id'] || '';
  if (!id) {
    return { redirect: '/contacts', content: '' };
  }

  let contact: any = null;
  let error: string | null = null;

  try {
    const res = await ctx.api.get(`/api/v1/contacts/${encodeURIComponent(id)}`);
    contact = res?.data?.contact ?? null;
  } catch (err) {
    process.stderr.write(`[contacts] Failed to load contact: ${String(err)}\n`);
    error = 'Unable to load contact details.';
  }

  if (error) {
    return {
      title: 'Contact Error',
      status: 502,
      content: html`
        <div class="alert alert-danger">${error}</div>
        <p><a href="/contacts" class="btn btn-secondary">← Back to Contacts</a></p>
      `
    };
  }

  if (!contact) {
    return {
      title: 'Contact Not Found',
      content: html`
        <div class="alert alert-danger">Contact not found.</div>
        <p><a href="/contacts" class="btn btn-secondary">← Back to Contacts</a></p>
      `
    };
  }

  const typeFormatted = contact.contact_type
    ? contact.contact_type.charAt(0).toUpperCase() + contact.contact_type.slice(1)
    : '';

  const notesHtml = contact.notes
    ? raw(String(contact.notes).split(/\r?\n/).map((line) => html`${line}`.toString()).join('<br>'))
    : html`<span class="text-muted">No notes recorded for this contact.</span>`;

  const content = html`
    <div class="page-header" data-entity="contact" data-id="${contact.id}">
      <div>
        <a href="/contacts" class="text-muted">← Back to Contacts</a>
        <h1 class="page-title">
          ${contact.first_name} ${contact.last_name}
          <button class="btn-icon" data-action="copy-id" data-copy-value="${contact.id}" title="Copy Contact ID" style="margin-left: 0.5rem; font-size: 0.85rem; background: transparent; border: none; cursor: pointer;">📋</button>
        </h1>
        <p class="page-subtitle">
          <span class="badge">${typeFormatted}</span>
          ${contact.company_name ? html` • ${contact.company_name}` : raw('')}
        </p>
      </div>
      <div>
        <button class="btn btn-secondary" data-action="copy-id" data-copy-value="${contact.id}">📋 Copy ID</button>
      </div>
    </div>

    ${renderCustomFields('contact', contact.custom_fields || {}, { operatorId: ctx.session.operatorId })}

    <div class="grid-2-col">
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Contact Information</h2>
        </div>
        <div class="detail-list">
          <div class="detail-item">
            <span class="detail-label">Full Name</span>
            <span class="detail-value">${contact.first_name} ${contact.last_name}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Contact Type</span>
            <span class="detail-value">${typeFormatted}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Email</span>
            <span class="detail-value">${contact.email ? html`<a href="mailto:${contact.email}">${contact.email}</a>` : '—'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Primary Phone</span>
            <span class="detail-value">${contact.phone || '—'}</span>
          </div>
          ${contact.secondary_phone
            ? html`
              <div class="detail-item">
                <span class="detail-label">Secondary Phone</span>
                <span class="detail-value">${contact.secondary_phone}</span>
              </div>
            `
            : raw('')}
          ${contact.vendor_specialty
            ? html`
              <div class="detail-item">
                <span class="detail-label">Specialty</span>
                <span class="detail-value">${contact.vendor_specialty}</span>
              </div>
            `
            : raw('')}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Notes & Background</h2>
        </div>
        <div class="card-body">
          <p>${notesHtml}</p>
        </div>
      </div>

      ${contact.contact_type === 'vendor'
        ? html`
          <div class="card" style="grid-column: span 2;">
            <div class="card-header">
              <h2 class="card-title">Vendor Compliance & Tax Information</h2>
            </div>
            <div class="detail-list">
              <div class="detail-item">
                <span class="detail-label">Trade Specialization</span>
                <span class="detail-value">
                  ${contact.vendor_specialty ? html`<span class="badge badge-info">${contact.vendor_specialty}</span>` : '—'}
                </span>
              </div>
              <div class="detail-item">
                <span class="detail-label">W-9 Form Status</span>
                <span class="detail-value">
                  ${contact.w9_received
                    ? html`<span class="badge badge-success">✓ Verified On File</span>`
                    : html`<span class="badge badge-warning">⚠ W-9 Pending (Action Required)</span>`}
                </span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Tax Classification</span>
                <span class="detail-value">${contact.tax_classification ? contact.tax_classification.toUpperCase() : 'Not Specified'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Tax ID (Last 4)</span>
                <span class="detail-value">${contact.tax_id_last4 ? `•••-••-${contact.tax_id_last4}` : '—'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">1099 Reporting</span>
                <span class="detail-value">
                  <a href="/accounting/1099-nec" class="btn btn-sm btn-secondary">View 1099-NEC Ledger Schedule →</a>
                </span>
              </div>
            </div>
          </div>
        `
        : raw('')}
    </div>
  `;

  return {
    title: `${contact.first_name} ${contact.last_name}`,
    content
  };
}
