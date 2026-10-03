// GarrisonOS Lightweight UI Enhancements, Universal Search, and Accounting Presentation
document.addEventListener('DOMContentLoaded', () => {
  // 1. Close modals on clicking backdrop
  document.querySelectorAll('dialog.modal').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      const rect = dialog.getBoundingClientRect();
      const isInDialog = (
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width
      );
      if (!isInDialog) {
        dialog.close();
      }
    });
  });

  // 2. Global Dark Mode Toggle Logic
  const themeToggleButtons = document.querySelectorAll('.theme-toggle-btn');

  function updateThemeButtonLabels(isDark) {
    themeToggleButtons.forEach((btn) => {
      btn.textContent = isDark ? '☀️ Light' : '🌙 Dark';
      btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    try {
      localStorage.setItem('garrison_theme', nextTheme);
    } catch {
      // Ignore if localStorage unavailable
    }
    updateThemeButtonLabels(nextTheme === 'dark');
  }

  themeToggleButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleTheme();
    });
  });

  const isInitiallyDark = document.documentElement.getAttribute('data-theme') === 'dark';
  updateThemeButtonLabels(isInitiallyDark);

  // 3. Hotkeys: Alt+D to toggle dark mode, Ctrl+K or '/' to focus Universal Search
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      toggleTheme();
      return;
    }

    // Ctrl+K or Cmd+K or '/' to focus search bar
    const searchInput = document.getElementById('topbar-search-input');
    if (searchInput) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else if (e.key === '/' && document.activeElement !== searchInput && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '')) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    }
  });

  // 4. Universal Search Controller with 300ms Debounce & Keyboard Navigation
  const searchInput = document.getElementById('topbar-search-input');
  const searchDropdown = document.getElementById('search-quick-results');

  if (searchInput && searchDropdown) {
    let debounceTimer = null;
    let selectedIndex = -1;

    function closeSearchDropdown() {
      searchDropdown.style.display = 'none';
      searchDropdown.innerHTML = '';
      selectedIndex = -1;
    }

    function renderQuickResults(data) {
      if (!data || !data.results || data.results.length === 0) {
        searchDropdown.innerHTML = `
          <div class="search-empty-state text-muted text-center py-3 px-2">
            No quick matches found. Press <kbd>Enter</kbd> to run full search across all entities.
          </div>
        `;
        searchDropdown.style.display = 'block';
        return;
      }

      // Group by category (top 3 per category)
      const categories = {};
      data.results.forEach((item) => {
        const cat = item.category || 'Other';
        if (!categories[cat]) categories[cat] = [];
        if (categories[cat].length < 3) {
          categories[cat].push(item);
        }
      });

      let html = '<div class="search-quick-list" role="listbox">';
      let itemIdx = 0;

      for (const [catName, items] of Object.entries(categories)) {
        html += `<div class="search-category-header text-uppercase text-muted fw-bold px-3 pt-2 pb-1 small">${catName}</div>`;
        items.forEach((item) => {
          html += `
            <a href="${item.url}" class="search-result-item d-flex align-items-center px-3 py-2 text-decoration-none border-bottom text-dark" role="option" data-index="${itemIdx}" tabindex="-1">
              <span class="search-item-icon me-2 fs-5">${item.icon || '🔍'}</span>
              <div class="flex-grow-1 overflow-hidden">
                <div class="d-flex justify-content-between align-items-center">
                  <strong class="text-truncate">${escapeHtml(item.title)}</strong>
                  <span class="badge bg-light text-secondary border ms-2">${escapeHtml(item.badge || item.type)}</span>
                </div>
                <div class="small text-muted text-truncate">${escapeHtml(item.subtitle || '')}</div>
              </div>
            </a>
          `;
          itemIdx++;
        });
      }

      html += `
        </div>
        <div class="search-dropdown-footer d-flex justify-content-between align-items-center px-3 py-2 bg-light border-top small text-muted">
          <span>Press <kbd>↑</kbd> <kbd>↓</kbd> to navigate, <kbd>Enter</kbd> to select</span>
          <a href="/search?q=${encodeURIComponent(searchInput.value.trim())}" class="fw-semibold">See all results &rarr;</a>
        </div>
      `;

      searchDropdown.innerHTML = html;
      searchDropdown.style.display = 'block';
      selectedIndex = -1;
    }

    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = searchInput.value.trim();

      if (query.length < 1) {
        closeSearchDropdown();
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}&limit=15`);
          if (res.ok) {
            const json = await res.json();
            if (json.success && json.data) {
              renderQuickResults(json.data);
            }
          }
        } catch {
          // Ignore network errors in quick search
        }
      }, 300);
    });

    searchInput.addEventListener('keydown', (e) => {
      const items = searchDropdown.querySelectorAll('.search-result-item');
      if (searchDropdown.style.display === 'none' || items.length === 0) {
        if (e.key === 'Escape') {
          closeSearchDropdown();
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % items.length;
        updateItemSelection(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        updateItemSelection(items);
      } else if (e.key === 'Enter') {
        if (selectedIndex >= 0 && items[selectedIndex]) {
          e.preventDefault();
          items[selectedIndex].click();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeSearchDropdown();
      }
    });

    function updateItemSelection(items) {
      items.forEach((item, idx) => {
        if (idx === selectedIndex) {
          item.classList.add('active', 'bg-light');
          item.scrollIntoView({ block: 'nearest' });
        } else {
          item.classList.remove('active', 'bg-light');
        }
      });
    }

    // Close search dropdown on click outside
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
        closeSearchDropdown();
      }
    });
  }

  // 5. Global Clipboard Helper: button[data-action="copy-id"]
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('button[data-action="copy-id"]');
    if (!copyBtn) return;

    e.preventDefault();
    const idToCopy = copyBtn.getAttribute('data-id') || copyBtn.textContent.trim();
    if (!idToCopy) return;

    navigator.clipboard.writeText(idToCopy).then(() => {
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = '✅ Copied!';
      copyBtn.classList.add('text-success');
      setTimeout(() => {
        copyBtn.innerHTML = originalText;
        copyBtn.classList.remove('text-success');
      }, 1500);
    }).catch(() => {
      // Fallback
    });
  });

  // 6. Check Register Batch Print Modal & Selector
  const selectAllChecks = document.getElementById('select-all-checks');
  const checkCheckboxes = document.querySelectorAll('input[name="check_ids"]');
  const btnBatchPrint = document.getElementById('btn-batch-print-modal');
  const previewFrame = document.getElementById('check-preview-frame');

  if (selectAllChecks && checkCheckboxes.length > 0) {
    selectAllChecks.addEventListener('change', () => {
      checkCheckboxes.forEach((cb) => {
        cb.checked = selectAllChecks.checked;
      });
      updateBatchCheckButtons();
    });

    checkCheckboxes.forEach((cb) => {
      cb.addEventListener('change', updateBatchCheckButtons);
    });

    function updateBatchCheckButtons() {
      const selected = Array.from(checkCheckboxes).filter((cb) => cb.checked);
      if (btnBatchPrint) {
        btnBatchPrint.disabled = selected.length === 0;
        btnBatchPrint.textContent = selected.length > 0 ? `🖨️ Batch Print (${selected.length} Checks)` : '🖨️ Batch Print Checks';
      }
    }

    if (btnBatchPrint) {
      btnBatchPrint.addEventListener('click', () => {
        const selectedIds = Array.from(checkCheckboxes)
          .filter((cb) => cb.checked)
          .map((cb) => cb.value);

        if (selectedIds.length === 0) return;

        const url = `/api/v1/accounting/checks/batch-pdf?ids=${encodeURIComponent(selectedIds.join(','))}`;
        if (previewFrame) {
          previewFrame.src = url;
        }

        const modalEl = document.getElementById('modalBatchChecks');
        if (modalEl && window.bootstrap) {
          const bsModal = new window.bootstrap.Modal(modalEl);
          bsModal.show();
        }
      });
    }
  }

  // 7. Bank Deposit Batching Running Total Calculator
  const depositCheckboxes = document.querySelectorAll('.deposit-payment-check');
  const selectAllDeposits = document.getElementById('select-all-deposits');
  const selectedCountSpan = document.getElementById('deposit-selected-count');
  const selectedSumSpan = document.getElementById('deposit-selected-sum');
  const submitDepositBtn = document.getElementById('btn-submit-deposit');

  if (depositCheckboxes.length > 0) {
    function recalculateDepositTotal() {
      let count = 0;
      let totalCents = 0;

      depositCheckboxes.forEach((cb) => {
        if (cb.checked) {
          count++;
          const cents = parseInt(cb.getAttribute('data-cents') || '0', 10);
          totalCents += cents;
        }
      });

      if (selectedCountSpan) selectedCountSpan.textContent = String(count);
      if (selectedSumSpan) selectedSumSpan.textContent = `$${(totalCents / 100).toFixed(2)}`;
      if (submitDepositBtn) submitDepositBtn.disabled = count === 0;
    }

    if (selectAllDeposits) {
      selectAllDeposits.addEventListener('change', () => {
        depositCheckboxes.forEach((cb) => {
          cb.checked = selectAllDeposits.checked;
        });
        recalculateDepositTotal();
      });
    }

    depositCheckboxes.forEach((cb) => {
      cb.addEventListener('change', recalculateDepositTotal);
    });

    recalculateDepositTotal();
  }

  // 8. AP Bill Entry Allocation Splits & Penny Balancing
  const billTotalInput = document.getElementById('bill-total-amount');
  const splitsTableBody = document.getElementById('bill-splits-body');
  const btnAddSplit = document.getElementById('btn-add-split-line');
  const splitRemainingSpan = document.getElementById('split-remaining-amount');

  if (billTotalInput && splitsTableBody) {
    function recalculateBillSplits() {
      const totalDollars = parseFloat(billTotalInput.value || '0') || 0;
      const totalCents = Math.round(totalDollars * 100);

      let allocatedCents = 0;
      const lineInputs = splitsTableBody.querySelectorAll('.split-amount-input');
      lineInputs.forEach((input) => {
        const lineDollars = parseFloat(input.value || '0') || 0;
        allocatedCents += Math.round(lineDollars * 100);
      });

      const remainingCents = totalCents - allocatedCents;
      const remainingDollars = (remainingCents / 100).toFixed(2);

      if (splitRemainingSpan) {
        if (remainingCents === 0 && totalCents > 0) {
          splitRemainingSpan.textContent = `Balanced ($0.00 Remaining)`;
          splitRemainingSpan.className = 'badge bg-success';
        } else {
          splitRemainingSpan.textContent = `Unbalanced ($${remainingDollars} Remaining)`;
          splitRemainingSpan.className = 'badge bg-danger';
        }
      }
    }

    billTotalInput.addEventListener('input', recalculateBillSplits);
    splitsTableBody.addEventListener('input', (e) => {
      if (e.target.classList.contains('split-amount-input')) {
        recalculateBillSplits();
      }
    });

    if (btnAddSplit) {
      btnAddSplit.addEventListener('click', () => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>
            <select name="split_property_id[]" class="form-select form-select-sm" required>
              <option value="">-- Select Property --</option>
              ${window.PROPERTY_OPTIONS || ''}
            </select>
          </td>
          <td>
            <input type="text" name="split_unit_id[]" class="form-control form-select-sm" placeholder="Optional Unit">
          </td>
          <td>
            <select name="split_account_id[]" class="form-select form-select-sm" required>
              <option value="">-- Select Expense GL --</option>
              ${window.EXPENSE_ACCOUNT_OPTIONS || ''}
            </select>
          </td>
          <td>
            <input type="number" step="0.01" name="split_amount[]" class="form-control form-control-sm split-amount-input" placeholder="0.00" required>
          </td>
          <td>
            <input type="text" name="split_memo[]" class="form-control form-control-sm" placeholder="Allocation notes">
          </td>
          <td class="text-center">
            <button type="button" class="btn btn-sm btn-outline-danger btn-remove-split">❌</button>
          </td>
        `;
        splitsTableBody.appendChild(row);
        recalculateBillSplits();
      });
    }

    splitsTableBody.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-remove-split')) {
        const tr = e.target.closest('tr');
        if (tr) {
          tr.remove();
          recalculateBillSplits();
        }
      }
    });
  }

  // 9. Admin Branding Preset Selection
  const presetCards = document.querySelectorAll('.preset-card[data-preset]');
  presetCards.forEach((card) => {
    card.addEventListener('click', () => {
      const presetId = card.getAttribute('data-preset');
      const primary = card.getAttribute('data-primary');
      const hover = card.getAttribute('data-hover');
      const accent = card.getAttribute('data-accent');

      presetCards.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');

      const presetRadio = document.querySelector(`input[name="theme_preset"][value="${presetId}"]`);
      if (presetRadio) {
        presetRadio.checked = true;
      }

      if (primary) {
        const primaryInput = document.getElementById('primary_color');
        if (primaryInput) primaryInput.value = primary;
      }
      if (hover) {
        const hoverInput = document.getElementById('primary_hover');
        if (hoverInput) hoverInput.value = hover;
      }
      if (accent) {
        const accentInput = document.getElementById('accent_color');
        if (accentInput) accentInput.value = accent;
      }
    });
  });

  // Helper: HTML escaper for search quick results
  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 10. Universal Entity Preview & Modal Navigation
  const UUID_REGEX = /[0-9a-f0-9]{8}-[0-9a-f0-9]{4}-[0-9a-f0-9]{4}-[0-9a-f0-9]{4}-[0-9a-f0-9]{12}/i;

  // Ensure universal preview modal dialog exists in DOM
  let entityModal = document.getElementById('universal-entity-preview-modal');
  if (!entityModal) {
    entityModal = document.createElement('dialog');
    entityModal.id = 'universal-entity-preview-modal';
    entityModal.className = 'modal entity-preview-modal';
    entityModal.innerHTML = `
      <div class="entity-preview-box">
        <div class="entity-preview-header">
          <div style="display: flex; align-items: center; gap: 0.75rem; flex: 1; min-width: 0;">
            <h3 id="entity-preview-title" class="entity-preview-title text-truncate">Loading Preview...</h3>
            <span id="entity-preview-badge" class="badge">Entity</span>
          </div>
          <button type="button" class="btn-icon entity-preview-close" aria-label="Close" style="background: none; border: none; font-size: 1.25rem; cursor: pointer; color: var(--text-muted); padding: 0.25rem 0.5rem;">✕</button>
        </div>
        <div id="entity-preview-body" class="entity-preview-body">
          <div class="entity-preview-loading text-center py-4 text-muted">
            <span class="spinner"></span> Loading entity details...
          </div>
        </div>
        <div class="entity-preview-footer" style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color, #e2e8f0);">
          <button type="button" class="btn btn-secondary entity-preview-close">Close</button>
          <a id="entity-preview-full-btn" href="#" class="btn btn-primary">Open Full View ↗</a>
        </div>
      </div>
    `;
    document.body.appendChild(entityModal);

    // Close handlers for entityModal
    entityModal.querySelectorAll('.entity-preview-close').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        entityModal.close();
      });
    });

    entityModal.addEventListener('click', (event) => {
      const rect = entityModal.getBoundingClientRect();
      const isInDialog = (
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width
      );
      if (!isInDialog) {
        entityModal.close();
      }
    });
  }

  function extractUuid(str) {
    if (!str || typeof str !== 'string') return null;
    const match = str.match(UUID_REGEX);
    return match ? match[0] : null;
  }

  function inferTypeFromUrl(url) {
    if (!url) return undefined;
    if (url.includes('/properties/units/')) return 'unit';
    if (url.includes('/properties/')) return 'property';
    if (url.includes('/leases/')) return 'lease';
    if (url.includes('/contacts/')) return 'contact';
    if (url.includes('/maintenance/')) return 'work_order';
    if (url.includes('/accounting/bills/')) return 'bill';
    if (url.includes('/accounting/checks/')) return 'check';
    if (url.includes('/accounting/deposits/')) return 'deposit';
    if (url.includes('/accounting')) return 'transaction';
    return undefined;
  }

  // Scan and mark unlinked raw UUIDs in tables or code elements as clickable
  function markRawUuids() {
    const candidateElements = document.querySelectorAll('td, .badge, code, span:not(.entity-clickable)');
    candidateElements.forEach((el) => {
      if (el.children.length === 0 && el.textContent) {
        const text = el.textContent.trim();
        const uuid = extractUuid(text);
        if (uuid && text.length <= 45 && !el.closest('a') && !el.classList.contains('entity-clickable')) {
          el.classList.add('entity-clickable');
          el.setAttribute('data-entity-id', uuid);
          el.setAttribute('title', 'Click to preview entity');
        }
      }
    });
  }
  markRawUuids();

  // Global click interception
  document.addEventListener('click', async (e) => {
    // 1. Check if clicked target or parent has entity identifiers
    const entityTarget = e.target.closest('[data-entity-id], [data-uuid], a[href*="id="], .entity-clickable');
    if (!entityTarget) return;

    // Check if the click occurred inside ANY currently open dialog/modal
    const openModal = e.target.closest('dialog[open], .modal[open], [role="dialog"][open]');

    let targetHref = entityTarget.getAttribute('href');
    const entityId = entityTarget.getAttribute('data-entity-id') ||
                     entityTarget.getAttribute('data-uuid') ||
                     (targetHref ? extractUuid(targetHref) : null) ||
                     extractUuid(entityTarget.textContent || '');

    const typeHint = entityTarget.getAttribute('data-entity-type') ||
                     (targetHref ? inferTypeFromUrl(targetHref) : undefined);

    if (!entityId) return;

    // RULE 1: If clicked INSIDE an already open modal:
    // "when in a modal it should cause the modal to close and the main view to navigate to their full page"
    if (openModal) {
      e.preventDefault();
      e.stopPropagation();

      // Close all open modals/dialogs
      if (typeof openModal.close === 'function') {
        openModal.close();
      }
      openModal.removeAttribute('open');
      if (entityModal && entityModal.open) {
        entityModal.close();
      }

      // If we already know the targetHref (and it's a page link, not #), navigate to it
      if (targetHref && targetHref !== '#' && !targetHref.startsWith('javascript:')) {
        window.location.href = targetHref;
        return;
      }

      // If no direct href, fetch the entity preview to resolve its fullUrl
      try {
        const res = await fetch(`/api/v1/entities/preview?id=${encodeURIComponent(entityId)}${typeHint ? `&type=${encodeURIComponent(typeHint)}` : ''}`);
        const data = await res.json();
        if (data && data.success && data.data && data.data.fullUrl) {
          window.location.href = data.data.fullUrl;
        }
      } catch {
        // Fallback
      }
      return;
    }

    // RULE 2: If clicked in MAIN VIEW (not in modal):
    // "when they appear in the main view, it should pop up a modal with a brief summary and a button to see the full view"
    e.preventDefault();
    e.stopPropagation();

    // Populate modal with loading state and open
    const titleEl = document.getElementById('entity-preview-title');
    const badgeEl = document.getElementById('entity-preview-badge');
    const bodyEl = document.getElementById('entity-preview-body');
    const fullBtn = document.getElementById('entity-preview-full-btn');

    if (titleEl) titleEl.textContent = 'Loading entity...';
    if (badgeEl) {
      badgeEl.textContent = typeHint ? typeHint.replace(/_/g, ' ').toUpperCase() : 'ENTITY';
      badgeEl.className = 'badge';
    }
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div class="entity-preview-loading text-center py-4 text-muted">
          <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">⏳</div>
          Loading entity summary...
        </div>
      `;
    }
    if (fullBtn) {
      fullBtn.href = targetHref || '#';
      fullBtn.style.display = 'inline-block';
    }

    if (typeof entityModal.showModal === 'function') {
      entityModal.showModal();
    } else {
      entityModal.setAttribute('open', '');
    }

    try {
      const res = await fetch(`/api/v1/entities/preview?id=${encodeURIComponent(entityId)}${typeHint ? `&type=${encodeURIComponent(typeHint)}` : ''}`);
      const data = await res.json();
      if (!data || !data.success || !data.data) {
        if (bodyEl) {
          bodyEl.innerHTML = `
            <div class="alert alert-danger" style="margin: 1rem 0;">
              ${escapeHtml(data?.error?.message || 'Entity details could not be found.')}
            </div>
          `;
        }
        return;
      }

      const p = data.data;
      if (titleEl) titleEl.textContent = p.title || 'Entity Summary';
      if (badgeEl) {
        badgeEl.textContent = p.badge || 'ENTITY';
        badgeEl.className = `badge ${p.badgeClass || ''}`;
      }
      if (fullBtn) {
        fullBtn.href = p.fullUrl || '#';
      }

      const summaryRows = (p.summary || []).map((f) => `
        <div class="preview-row">
          <div class="preview-label">${escapeHtml(f.label)}</div>
          <div class="preview-value">${escapeHtml(f.value)}</div>
        </div>
      `).join('');

      if (bodyEl) {
        bodyEl.innerHTML = `
          <div class="entity-preview-grid">
            ${summaryRows}
          </div>
        `;
      }
    } catch (err) {
      if (bodyEl) {
        bodyEl.innerHTML = `
          <div class="alert alert-danger" style="margin: 1rem 0;">
            Failed to load entity preview: ${escapeHtml(err.message)}
          </div>
        `;
      }
    }
  });
});
