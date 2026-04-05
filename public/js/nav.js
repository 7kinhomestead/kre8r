/**
 * Kre8Ωr — Shared Navigation Component
 *
 * Usage on every page:
 *   <div id="kre8r-nav"></div>
 *   <script src="/js/nav.js"></script>
 *   <script>initNav()</script>
 *
 * Features:
 *   - Click-to-toggle dropdowns (no hover timing issues)
 *   - Padding bridge eliminating hover gap
 *   - Auto-detects active page and highlights correct item + category
 *   - Keyboard accessible (Tab, Enter, Space, Escape, Arrow keys)
 *   - Mobile hamburger with full-screen overlay
 *
 * SINE RESISTENTIA
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // NAV STRUCTURE
  // ─────────────────────────────────────────────
  const NAV = {
    categories: [
      {
        id: 'pre',
        label: 'Pre',
        items: [
          { label: 'Soul BuildΩr', href: '/soul-buildr.html', soul: true },
          { label: 'Id8Ωr',   href: '/id8r.html' },
          { label: 'PipΩr',   href: '/pipr.html' },
          { label: 'WritΩr',  href: '/writr.html' },
        ]
      },
      {
        id: 'prod',
        label: 'Prod',
        items: [
          { label: 'DirectΩr',     href: '/director.html' },
          { label: 'ShootDay',     href: '/shootday.html' },
          { label: 'TeleprΩmpter', href: '/teleprompter.html' },
        ]
      },
      {
        id: 'post',
        label: 'Post',
        items: [
          { label: 'VaultΩr',  href: '/vault.html' },
          { label: 'EditΩr',   href: '/editor.html' },
          { label: 'ReviewΩr', href: '/reviewr.html' },
          { label: 'ComposΩr', href: '/composor.html' },
        ]
      },
      {
        id: 'dist',
        label: 'Dist',
        items: [
          { label: 'GateΩr',    sublabel: 'M1', href: '/m1-approval-dashboard.html' },
          { label: 'PackageΩr', sublabel: 'M2', href: '/m2-package-generator.html' },
          { label: 'CaptionΩr', sublabel: 'M3', href: '/m3-caption-generator.html' },
          { label: 'MailΩr',    sublabel: 'M4', href: '/mailor.html' },
          { label: 'AudiencΩr', sublabel: 'M5', href: '/audience.html' },
          { label: 'AutomatΩr', href: '/automator.html' },
          { label: 'AnalΩzr',   href: '/analytr.html', soon: true },
        ]
      }
    ]
  };

  // ─────────────────────────────────────────────
  // ACTIVE STATE DETECTION
  // ─────────────────────────────────────────────
  function getActivePage() {
    const path = window.location.pathname;
    // Normalize: handle both /page.html and /
    return path === '/' ? '/' : path.toLowerCase();
  }

  function isItemActive(item) {
    const page = getActivePage();
    const href = item.href.toLowerCase();
    return page === href;
  }

  function isCategoryActive(cat) {
    return cat.items.some(item => isItemActive(item));
  }

  // ─────────────────────────────────────────────
  // CSS INJECTION
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('kre8r-nav-css')) return;
    const css = `
/* ── Kre8Ωr Navigation ── */
#kre8r-nav { position: relative; z-index: 200; }

.kn-nav {
  position: sticky;
  top: 0;
  z-index: 200;
  height: var(--nav-height, 54px);
  background: rgba(14,15,14,0.94);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--border, #2a2e28);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  gap: 8px;
}

/* Logo */
.kn-logo {
  font-family: var(--font-head, 'Bebas Neue', sans-serif);
  font-size: 24px;
  letter-spacing: 2px;
  color: var(--text, #e8ebe6);
  text-decoration: none;
  flex-shrink: 0;
  line-height: 1;
}
.kn-logo-omega { color: var(--teal, #3ecfb2); }

/* Desktop menu */
.kn-menu {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* Category button */
.kn-cat-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-dim, #8a9487);
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 13px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: var(--radius-sm, 6px);
  transition: all 0.15s;
  white-space: nowrap;
  letter-spacing: 0.3px;
  user-select: none;
}
.kn-cat-btn:hover,
.kn-dropdown.is-open .kn-cat-btn {
  background: var(--bg-card-2, #1c1f1b);
  color: var(--text, #e8ebe6);
}
.kn-cat-btn.is-active {
  background: var(--teal-glow, rgba(62,207,178,0.10));
  color: var(--teal, #3ecfb2);
}
.kn-cat-btn.is-active:hover,
.kn-dropdown.is-open .kn-cat-btn.is-active {
  background: var(--teal-glow, rgba(62,207,178,0.10));
  color: var(--teal, #3ecfb2);
}

.kn-chevron {
  font-size: 9px;
  opacity: 0.6;
  transition: transform 0.15s;
  display: inline-block;
}
.kn-dropdown.is-open .kn-chevron {
  transform: rotate(180deg);
}

/* Dropdown wrapper — the padding bridge lives here */
.kn-dropdown {
  position: relative;
  display: inline-flex;
}

.kn-dropdown-wrap {
  position: absolute;
  top: 100%;
  right: 0;
  padding-top: 8px; /* ← bridge gap: invisible padding so mouse never leaves hover zone */
  z-index: 300;
  display: none;
  min-width: 180px;
}
.kn-dropdown.is-open .kn-dropdown-wrap {
  display: block;
}

/* The visible menu box */
.kn-dropdown-menu {
  background: var(--bg-card, #161916);
  border: 1px solid var(--border-bright, #3d4439);
  border-radius: var(--radius, 10px);
  padding: 6px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.5);
  animation: kn-fadeIn 0.12s ease;
}

@keyframes kn-fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Menu items */
.kn-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-dim, #8a9487);
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  padding: 8px 12px;
  border-radius: var(--radius-sm, 6px);
  transition: all 0.12s;
  white-space: nowrap;
}
.kn-menu-item:hover:not(.is-soon) {
  background: var(--bg-card-2, #1c1f1b);
  color: var(--text, #e8ebe6);
}
.kn-menu-item.is-active {
  background: var(--teal-glow, rgba(62,207,178,0.10));
  color: var(--teal, #3ecfb2);
  font-weight: 600;
}
.kn-menu-item.is-soon {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}
.kn-menu-item.is-soon:hover {
  background: none;
  color: var(--text-dim, #8a9487);
}

/* Item meta (M1, M2 labels) */
.kn-item-sublabel {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: var(--text-dimmer, #4e5349);
  text-transform: uppercase;
}
.kn-menu-item.is-active .kn-item-sublabel {
  color: var(--teal, #3ecfb2);
  opacity: 0.7;
}

/* Soon badge */
.kn-soon-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 20px;
  background: var(--bg-card-2, #1c1f1b);
  border: 1px solid var(--border-bright, #3d4439);
  color: var(--text-dimmer, #4e5349);
  flex-shrink: 0;
}

/* Soul badge — shown when no creator-profile.json yet */
.kn-soul-badge {
  font-size: 10px;
  flex-shrink: 0;
}

/* Divider */
.kn-divider {
  height: 1px;
  background: var(--border, #2a2e28);
  margin: 4px 8px;
}

/* Hamburger — hidden on desktop */
.kn-hamburger {
  display: none;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-dim, #8a9487);
  font-size: 20px;
  padding: 6px;
  border-radius: var(--radius-sm, 6px);
  transition: all 0.15s;
  line-height: 1;
}
.kn-hamburger:hover {
  background: var(--bg-card-2, #1c1f1b);
  color: var(--text, #e8ebe6);
}

/* ── Mobile overlay ── */
.kn-mobile-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 500;
  background: var(--bg, #0e0f0e);
  overflow-y: auto;
  padding: 16px;
  animation: kn-slideIn 0.2s ease;
}
.kn-mobile-overlay.is-open {
  display: block;
}
@keyframes kn-slideIn {
  from { opacity: 0; transform: translateX(100%); }
  to   { opacity: 1; transform: translateX(0); }
}

.kn-mobile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 32px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border, #2a2e28);
}
.kn-mobile-logo {
  font-family: var(--font-head, 'Bebas Neue', sans-serif);
  font-size: 26px;
  letter-spacing: 2px;
  color: var(--text, #e8ebe6);
  text-decoration: none;
}
.kn-mobile-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-dim, #8a9487);
  font-size: 22px;
  padding: 6px;
  border-radius: var(--radius-sm, 6px);
  transition: all 0.15s;
}
.kn-mobile-close:hover {
  background: var(--bg-card-2, #1c1f1b);
  color: var(--text, #e8ebe6);
}

.kn-mobile-section {
  margin-bottom: 28px;
}
.kn-mobile-section-label {
  font-family: var(--font-head, 'Bebas Neue', sans-serif);
  font-size: 11px;
  letter-spacing: 2.5px;
  color: var(--text-dimmer, #4e5349);
  text-transform: uppercase;
  margin-bottom: 8px;
  padding: 0 4px;
}
.kn-mobile-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-mid, #8a9487);
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
  padding: 12px 16px;
  border-radius: var(--radius, 10px);
  transition: all 0.12s;
  border: 1px solid transparent;
}
.kn-mobile-item:hover:not(.is-soon) {
  background: var(--bg-card, #161916);
  border-color: var(--border, #2a2e28);
  color: var(--text, #e8ebe6);
}
.kn-mobile-item.is-active {
  background: var(--teal-glow, rgba(62,207,178,0.10));
  border-color: rgba(62,207,178,0.25);
  color: var(--teal, #3ecfb2);
  font-weight: 600;
}
.kn-mobile-item.is-soon {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .kn-menu { display: none; }
  .kn-hamburger { display: flex; align-items: center; }
}
@media (min-width: 769px) {
  .kn-mobile-overlay { display: none !important; }
}
`;
    const style = document.createElement('style');
    style.id = 'kre8r-nav-css';
    style.textContent = css;
    document.head.insertBefore(style, document.head.firstChild);
  }

  // ─────────────────────────────────────────────
  // BUILD NAV HTML
  // ─────────────────────────────────────────────
  function buildNav() {
    const activePage = getActivePage();

    // Desktop category dropdowns
    const categoryHTML = NAV.categories.map(cat => {
      const catActive = isCategoryActive(cat);
      const itemsHTML = cat.items.map(item => {
        const active = isItemActive(item);
        const classes = ['kn-menu-item', active ? 'is-active' : '', item.soon ? 'is-soon' : ''].filter(Boolean).join(' ');
        const sublabelHTML = item.sublabel
          ? `<span class="kn-item-sublabel">${item.sublabel}</span>`
          : '';
        const soonHTML = item.soon
          ? `<span class="kn-soon-badge">Soon</span>`
          : '';
        const soulHTML = item.soul
          ? `<span class="kn-soul-badge" data-soul-badge>✨</span>`
          : '';
        const rightHTML = sublabelHTML || soonHTML || soulHTML;

        if (item.soon) {
          return `<span class="${classes}" tabindex="-1" aria-disabled="true">
            <span>${escHtml(item.label)}</span>
            ${rightHTML}
          </span>`;
        }
        return `<a href="${item.href}" class="${classes}" role="menuitem" tabindex="${active ? '0' : '-1'}">
          <span>${escHtml(item.label)}</span>
          ${rightHTML}
        </a>`;
      }).join('');

      return `<div class="kn-dropdown" data-category="${cat.id}" role="none">
        <button
          class="kn-cat-btn${catActive ? ' is-active' : ''}"
          aria-haspopup="true"
          aria-expanded="false"
          aria-label="${cat.label} tools"
          tabindex="0"
        >
          ${escHtml(cat.label)} <span class="kn-chevron" aria-hidden="true">▾</span>
        </button>
        <div class="kn-dropdown-wrap">
          <div class="kn-dropdown-menu" role="menu" aria-label="${cat.label}">
            ${itemsHTML}
          </div>
        </div>
      </div>`;
    }).join('');

    // Mobile overlay sections
    const mobileSections = NAV.categories.map(cat => {
      const itemsHTML = cat.items.map(item => {
        const active = isItemActive(item);
        const classes = ['kn-mobile-item', active ? 'is-active' : '', item.soon ? 'is-soon' : ''].filter(Boolean).join(' ');
        const soonHTML = item.soon ? `<span class="kn-soon-badge">Soon</span>` : '';
        const sublabelHTML = item.sublabel ? `<span class="kn-item-sublabel">${item.sublabel}</span>` : '';
        const soulHTML = item.soul ? `<span class="kn-soul-badge" data-soul-badge>✨</span>` : '';

        if (item.soon) {
          return `<span class="${classes}" aria-disabled="true">
            <span>${escHtml(item.label)}</span>
            ${soonHTML}
          </span>`;
        }
        return `<a href="${item.href}" class="${classes}">
          <span>${escHtml(item.label)}</span>
          ${sublabelHTML || soulHTML}
        </a>`;
      }).join('');

      return `<div class="kn-mobile-section">
        <div class="kn-mobile-section-label">${escHtml(cat.label)}</div>
        ${itemsHTML}
      </div>`;
    }).join('');

    const navHTML = `
      <nav class="kn-nav" role="navigation" aria-label="Kre8Ωr main navigation">
        <a href="/" class="kn-logo" aria-label="Kre8Ωr home">
          KRE<span class="kn-logo-omega">8Ω</span>R
        </a>
        <div class="kn-menu" role="menubar" aria-label="Navigation categories">
          ${categoryHTML}
        </div>
        <button class="kn-hamburger" aria-label="Open navigation menu" aria-expanded="false" aria-controls="kn-mobile-overlay">
          ☰
        </button>
      </nav>
      <div id="kn-mobile-overlay" class="kn-mobile-overlay" role="dialog" aria-label="Navigation menu" aria-modal="true" hidden>
        <div class="kn-mobile-header">
          <a href="/" class="kn-mobile-logo">KRE<span style="color:var(--teal,#3ecfb2)">8Ω</span>R</a>
          <button class="kn-mobile-close" aria-label="Close navigation menu">✕</button>
        </div>
        ${mobileSections}
      </div>
    `;

    return navHTML;
  }

  // ─────────────────────────────────────────────
  // EVENT HANDLERS
  // ─────────────────────────────────────────────
  function closeAllDropdowns() {
    document.querySelectorAll('.kn-dropdown.is-open').forEach(d => {
      d.classList.remove('is-open');
      const btn = d.querySelector('.kn-cat-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  function openDropdown(dropdown) {
    closeAllDropdowns();
    dropdown.classList.add('is-open');
    const btn = dropdown.querySelector('.kn-cat-btn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  function attachEvents(container) {
    // ── Click outside closes all dropdowns ──
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.kn-dropdown')) {
        closeAllDropdowns();
      }
    });

    // ── Category button clicks ──
    container.querySelectorAll('.kn-cat-btn').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const dropdown = btn.closest('.kn-dropdown');
        if (dropdown.classList.contains('is-open')) {
          closeAllDropdowns();
        } else {
          openDropdown(dropdown);
        }
      });
    });

    // ── Keyboard: Escape closes ──
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeAllDropdowns();
        closeMobileOverlay();
        // Return focus to the button that opened it
        const activeBtn = container.querySelector('.kn-cat-btn[aria-expanded="false"]');
      }
    });

    // ── Keyboard: Enter/Space on category buttons ──
    container.querySelectorAll('.kn-cat-btn').forEach(btn => {
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          btn.click();
          // Focus first item in dropdown
          const dropdown = btn.closest('.kn-dropdown');
          const firstItem = dropdown.querySelector('.kn-menu-item:not(.is-soon)');
          if (firstItem) setTimeout(() => firstItem.focus(), 50);
        }
      });
    });

    // ── Keyboard: Arrow keys inside dropdown ──
    container.querySelectorAll('.kn-dropdown-menu').forEach(menu => {
      menu.addEventListener('keydown', function (e) {
        const items = Array.from(menu.querySelectorAll('.kn-menu-item:not(.is-soon)'));
        const focused = document.activeElement;
        const idx = items.indexOf(focused);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = items[idx + 1] || items[0];
          if (next) next.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = items[idx - 1] || items[items.length - 1];
          if (prev) prev.focus();
        } else if (e.key === 'Tab') {
          closeAllDropdowns();
        }
      });
    });

    // ── Hamburger ──
    const hamburger = container.querySelector('.kn-hamburger');
    const overlay = document.getElementById('kn-mobile-overlay');

    function openMobileOverlay() {
      if (!overlay) return;
      overlay.hidden = false;
      overlay.classList.add('is-open');
      hamburger.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      const closeBtn = overlay.querySelector('.kn-mobile-close');
      if (closeBtn) closeBtn.focus();
    }

    function closeMobileOverlay() {
      if (!overlay) return;
      overlay.classList.remove('is-open');
      overlay.hidden = true;
      hamburger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    // Make closeMobileOverlay available in outer scope
    window._knCloseMobile = closeMobileOverlay;

    if (hamburger) {
      hamburger.addEventListener('click', function () {
        if (overlay && !overlay.hidden) {
          closeMobileOverlay();
        } else {
          openMobileOverlay();
        }
      });
    }

    if (overlay) {
      const closeBtn = overlay.querySelector('.kn-mobile-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', closeMobileOverlay);
      }
      // Close on overlay background click (not on menu content)
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeMobileOverlay();
      });
    }
  }

  // Update outer closeMobileOverlay reference
  function closeMobileOverlay() {
    if (window._knCloseMobile) window._knCloseMobile();
  }

  // ─────────────────────────────────────────────
  // UTILITY
  // ─────────────────────────────────────────────
  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  window.initNav = function () {
    injectStyles();

    const container = document.getElementById('kre8r-nav');
    if (!container) {
      console.warn('[Nav] No #kre8r-nav element found. Add <div id="kre8r-nav"></div> to your page.');
      return;
    }

    container.innerHTML = buildNav();
    attachEvents(container);

    // Hide ✨ soul badge if creator-profile.json already exists
    fetch('/api/soul-buildr/status').then(function(r) { return r.json(); }).then(function(d) {
      if (d.exists) {
        document.querySelectorAll('[data-soul-badge]').forEach(function(el) {
          el.style.display = 'none';
        });
      }
    }).catch(function() {});
  };

})();
