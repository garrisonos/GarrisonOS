import { html, raw, SafeHtml } from '../lib/html.js';

export interface PaginationOptions {
  page: number;
  limit: number;
  total: number;
  baseUrl: string;
  queryParams?: Record<string, string | number | boolean | undefined | null>;
}

/**
 * Renders a standardized, responsive pagination navigation bar for table views.
 *
 * @param options - Pagination configuration parameters.
 * @returns SafeHtml rendered pagination markup or empty raw string if only 1 page with 0 items.
 */
export function renderPagination(options: PaginationOptions): SafeHtml {
  const { limit, total, baseUrl, queryParams = {} } = options;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.max(1, Math.min(options.page || 1, totalPages));

  if (total <= limit && page === 1) {
    // Single page with few items: render simple counter without navigation buttons
    return html`
      <div class="pagination-container" style="justify-content: flex-end;">
        <div style="font-size: 0.85rem; color: var(--text-muted);">
          Showing ${total} ${total === 1 ? 'entry' : 'entries'}
        </div>
      </div>
    `;
  }

  const buildUrl = (targetPage: number): string => {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(queryParams)) {
      if (val !== undefined && val !== null && val !== '' && key !== 'page') {
        params.set(key, String(val));
      }
    }
    params.set('page', String(targetPage));
    const qs = params.toString();
    return `${baseUrl}${qs ? `?${qs}` : ''}`;
  };

  const startItem = total === 0 ? 0 : (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  // Generate visible page numbers (sliding window around current page)
  const pages: (number | 'ellipsis')[] = [];
  const maxButtons = 5;

  if (totalPages <= maxButtons + 2) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    let start = Math.max(2, page - 1);
    let end = Math.min(totalPages - 1, page + 1);

    if (page <= 3) {
      end = 4;
    } else if (page >= totalPages - 2) {
      start = totalPages - 3;
    }

    if (start > 2) pages.push('ellipsis');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push('ellipsis');
    pages.push(totalPages);
  }

  const pageButtons = pages.map((p) => {
    if (p === 'ellipsis') {
      return html`<span style="padding: 0.25rem 0.5rem; color: var(--text-muted);">…</span>`;
    }
    const isCurrent = p === page;
    return html`
      <a href="${buildUrl(p)}" class="pagination-btn ${isCurrent ? 'active' : ''}">
        ${p}
      </a>
    `;
  });

  return html`
    <div class="pagination-container">
      <div>
        Showing <strong>${startItem}</strong> to <strong>${endItem}</strong> of <strong>${total}</strong> entries
      </div>
      <div class="pagination-controls">
        ${page > 1
          ? html`<a href="${buildUrl(page - 1)}" class="pagination-btn">← Previous</a>`
          : html`<span class="pagination-btn disabled">← Previous</span>`}

        ${pageButtons}

        ${page < totalPages
          ? html`<a href="${buildUrl(page + 1)}" class="pagination-btn">Next →</a>`
          : html`<span class="pagination-btn disabled">Next →</span>`}
      </div>
    </div>
  `;
}
