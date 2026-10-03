import { PageContext, PageResult } from '../lib/page-context.js';
import { html, raw, SafeHtml } from '../lib/html.js';
import { SearchResponseData, SearchResultItem } from '../../api/search.js';

export async function handle(ctx: PageContext): Promise<PageResult> {
  const query = (ctx.query['q'] || '').trim();
  const activeTab = (ctx.query['tab'] || 'all').toLowerCase();

  let searchData: SearchResponseData = {
    query,
    total: 0,
    has_filtered_results: false,
    results: [],
    categories: { properties: [], people: [], financials: [], maintenance: [] }
  };

  if (query) {
    try {
      const res = await ctx.api.get(`/api/v1/search?q=${encodeURIComponent(query)}&limit=50`);
      if (res?.data) {
        searchData = res.data;
      }
    } catch {
      // Fallback empty searchData
    }
  }

  const propsCount = searchData.results.filter((r) => r.category === 'properties').length;
  const peopleCount = searchData.results.filter((r) => r.category === 'people').length;
  const finCount = searchData.results.filter((r) => r.category === 'financials').length;
  const maintCount = searchData.results.filter((r) => r.category === 'maintenance').length;

  let displayItems = searchData.results;
  if (activeTab === 'properties') {
    displayItems = searchData.results.filter((r) => r.category === 'properties');
  } else if (activeTab === 'people') {
    displayItems = searchData.results.filter((r) => r.category === 'people');
  } else if (activeTab === 'financials') {
    displayItems = searchData.results.filter((r) => r.category === 'financials');
  } else if (activeTab === 'maintenance') {
    displayItems = searchData.results.filter((r) => r.category === 'maintenance');
  }

  const categoryIcons: Record<string, string> = {
    properties: '🏢',
    people: '👥',
    financials: '💵',
    maintenance: '🛠️'
  };

  const content = html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Universal Search</h1>
        <p class="page-subtitle text-muted">
          ${query
            ? html`Showing search results for <strong class="font-mono">"${query}"</strong> (${searchData.total} items)`
            : html`Search across properties, units, leases, contacts, bills, checks, and work orders.`}
        </p>
      </div>
    </div>

    <!-- Search Box and Syntax Help -->
    <div class="card" style="margin-bottom: 1.5rem; padding: 1.25rem;">
      <form action="/search" method="GET" style="display: flex; gap: 0.75rem; align-items: center;">
        <input
          type="search"
          name="q"
          value="${query}"
          class="form-control"
          placeholder="Search keywords or use filters like type:bill, status:open, vendor:acme..."
          style="flex: 1; font-size: 1rem; padding: 0.65rem 1rem;"
          autofocus
        />
        <button type="submit" class="btn btn-primary" style="padding: 0.65rem 1.5rem;">🔍 Search</button>
      </form>
      <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
        <small class="text-muted" style="font-weight: 600;">Quick Filter Shortcuts:</small>
        <a href="/search?q=${encodeURIComponent('type:property ' + query.replace(/type:\w+/g, '').trim())}" class="badge badge-subtle">type:property</a>
        <a href="/search?q=${encodeURIComponent('type:unit ' + query.replace(/type:\w+/g, '').trim())}" class="badge badge-subtle">type:unit</a>
        <a href="/search?q=${encodeURIComponent('type:bill status:open')}" class="badge badge-subtle">type:bill status:open</a>
        <a href="/search?q=${encodeURIComponent('type:contact ' + query.replace(/type:\w+/g, '').trim())}" class="badge badge-subtle">type:contact</a>
        <a href="/search?q=${encodeURIComponent('type:work_order ' + query.replace(/type:\w+/g, '').trim())}" class="badge badge-subtle">type:work_order</a>
      </div>
    </div>

    <!-- Scoped Results Notice -->
    ${searchData.has_filtered_results
      ? html`
          <div class="alert alert-info" style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.75rem;">
            <span>ℹ️</span>
            <div>
              <strong>Permission-Filtered View:</strong> Results are automatically restricted to your assigned operator and role permissions.
            </div>
          </div>
        `
      : raw('')}

    <!-- Tabbed Categories Navigation -->
    <div class="search-tabs" style="display: flex; border-bottom: 1px solid var(--border-color); margin-bottom: 1.5rem; gap: 0.5rem;">
      <a href="/search?q=${encodeURIComponent(query)}&tab=all" class="tab-btn ${activeTab === 'all' ? 'active' : ''}">
        All Results <span class="badge badge-secondary">${searchData.total}</span>
      </a>
      <a href="/search?q=${encodeURIComponent(query)}&tab=properties" class="tab-btn ${activeTab === 'properties' ? 'active' : ''}">
        🏢 Properties & Units <span class="badge badge-secondary">${propsCount}</span>
      </a>
      <a href="/search?q=${encodeURIComponent(query)}&tab=people" class="tab-btn ${activeTab === 'people' ? 'active' : ''}">
        👥 People & Leases <span class="badge badge-secondary">${peopleCount}</span>
      </a>
      <a href="/search?q=${encodeURIComponent(query)}&tab=financials" class="tab-btn ${activeTab === 'financials' ? 'active' : ''}">
        💵 Financials <span class="badge badge-secondary">${finCount}</span>
      </a>
      <a href="/search?q=${encodeURIComponent(query)}&tab=maintenance" class="tab-btn ${activeTab === 'maintenance' ? 'active' : ''}">
        🛠️ Maintenance <span class="badge badge-secondary">${maintCount}</span>
      </a>
    </div>

    <!-- Results List -->
    <div class="search-results-list" id="search-results-container">
      ${displayItems.length > 0
        ? html`
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
              ${displayItems.map(
                (item) => html`
                  <div
                    class="card search-result-card"
                    data-entity-type="${item.entity_type}"
                    data-entity-id="${item.id}"
                    data-category="${item.category}"
                    style="padding: 1rem 1.25rem; display: flex; justify-content: space-between; align-items: center; transition: transform 0.15s ease, box-shadow 0.15s ease;"
                  >
                    <div style="display: flex; gap: 1rem; align-items: center;">
                      <span style="font-size: 1.5rem;">${categoryIcons[item.category] || '📄'}</span>
                      <div>
                        <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.25rem;">
                          <a href="${item.url}" style="font-size: 1.05rem; font-weight: 600; color: var(--primary);">
                            ${item.title}
                          </a>
                          <span class="badge badge-secondary" style="font-size: 0.7rem; text-transform: uppercase;">
                            ${item.badge || item.entity_type}
                          </span>
                          ${item.status
                            ? html`<span class="badge ${item.status === 'open' || item.status === 'occupied' ? 'badge-success' : 'badge-warning'}">
                                ${item.status}
                              </span>`
                            : raw('')}
                        </div>
                        <div class="text-muted" style="font-size: 0.85rem;">
                          ${item.subtitle}
                        </div>
                      </div>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                      <button
                        type="button"
                        class="btn btn-sm btn-subtle btn-copy-id"
                        data-action="copy-id"
                        data-target-id="${item.id}"
                        title="Copy record UUID"
                        style="padding: 0.3rem 0.6rem; font-size: 0.75rem;"
                      >
                        📋 Copy ID
                      </button>
                      <a href="${item.url}" class="btn btn-sm btn-secondary" style="padding: 0.3rem 0.75rem;">
                        View ->
                      </a>
                    </div>
                  </div>
                `
              )}
            </div>
          `
        : html`
            <div class="card" style="text-align: center; padding: 3rem 1.5rem;">
              <span style="font-size: 3rem; display: block; margin-bottom: 1rem;">🔍</span>
              <h3>No matching records found</h3>
              <p class="text-muted" style="max-width: 500px; margin: 0 auto 1.5rem;">
                ${query
                  ? 'We could not find any records matching your search terms or filters. Try adjusting your query or switching tabs.'
                  : 'Enter a keyword, address, invoice number, check number, or tenant name above to begin searching.'}
              </p>
              ${query
                ? html`<a href="/search" class="btn btn-secondary">Clear Search Filters</a>`
                : raw('')}
            </div>
          `}
    </div>
  `;

  return {
    title: query ? `Search: ${query}` : 'Universal Search',
    content
  };
}
