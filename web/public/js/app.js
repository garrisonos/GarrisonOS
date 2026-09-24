// GarrisonOS Lightweight UI Enhancements & Theme Management
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

  // 3. Hotkey: Alt+D to toggle dark mode
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      toggleTheme();
    }
  });

  // 4. Admin Branding Preset Selection
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
});
