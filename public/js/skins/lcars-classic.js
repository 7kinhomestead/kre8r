/**
 * LCARS CLASSIC — Kre8Ωr Skin
 * Library Computer Access/Retrieval System, 1987 TNG aesthetic
 *
 * Proof-of-concept for the engine/soul split.
 * This skin radically changes the aesthetic while the bridge layout stays identical.
 * Engine owns layout. Skin owns soul.
 *
 * Tier: creator ($10)
 * Compatible with: SkinManager v1+
 */

window.SKIN_LCARS_CLASSIC = {
  meta: {
    id: 'lcars-classic',
    name: 'LCARS Classic',
    author: 'kre8r-official',
    era: 'TNG 1987–1994',
    version: '1.0.0',
    tier: 'creator',
    price_usd: 10,
    description: 'The original Library Computer Access/Retrieval System. High contrast, warm palette, iconic.',
    preview_emoji: '🖥️',
  },

  tokens: {
    // ── Background & surface ────────────────────────────────────────────────
    // LCARS lives on a pure black void. No depth, no glow layers — flat and stark.
    'mc-bg':            '#000000',   // void
    'mc-panel':         '#1a0a00',   // very dark warm black (panel insets)
    'mc-panel-hi':      '#2a1500',   // slightly lifted warm black (hover/active states)
    'mc-line':          '#ff9900',   // LCARS orange — primary border / separator

    // ── Primary accent (orange replaces teal) ───────────────────────────────
    // In LCARS, orange is the universal accent. Everywhere the base skin used
    // --mc-teal, this skin plugs in orange so every existing component inherits.
    'mc-teal':          '#ff9900',
    'mc-teal-dim':      '#cc7700',
    'mc-cyan':          '#ffcc00',   // LCARS yellow fills the "bright accent" slot

    // ── Text ────────────────────────────────────────────────────────────────
    'mc-text':          '#ff9900',   // primary text: orange
    'mc-text-dim':      '#cc6600',   // secondary / metadata text: dimmed orange
    'mc-text-inv':      '#000000',   // text on colored pill-bars (black on orange)

    // ── Semantic palette ─────────────────────────────────────────────────────
    // LCARS uses flat saturated blocks — no gradients, no glow.
    'mc-amber':         '#ffcc00',   // LCARS yellow — warning, attention
    'mc-red':           '#cc4444',   // LCARS red — alert, critical
    'mc-green':         '#99cc00',   // LCARS green — nominal, online
    'mc-green-soft':    '#669900',   // dimmed green — passive / background health
    'mc-violet':        '#9999ff',   // LCARS blue-purple — science, comms, passive data
    'mc-orange':        '#ff6600',   // secondary orange — decorative pill accents
    'mc-mauve':         '#cc99cc',   // LCARS mauve — the classic pink-lavender bar fill
    'mc-lavender':      '#cc99ff',   // LCARS lavender — tertiary block fill

    // ── Typography ──────────────────────────────────────────────────────────
    // LCARS used a modified Helvetica. No serifs, no humanist curves.
    // Weight variation (ultra-bold headers, regular data) does the hierarchy work.
    'font-hud':         '"Helvetica Neue", "Arial", sans-serif',
    'font-head':        '"Helvetica Neue", "Arial", sans-serif',
    'font-body':        '"Helvetica Neue", "Arial", sans-serif',
    'font-data':        '"Helvetica Neue", "Arial", sans-serif',

    // Font weight tokens — used by the SkinManager to override heading weights
    'font-weight-head': '900',       // ultra-bold pill-bar text
    'font-weight-hud':  '700',       // bold instrument readouts
    'font-weight-body': '400',       // regular data text

    // Letter spacing — LCARS titles are often widely tracked
    'font-tracking-head': '0.12em',
    'font-tracking-hud':  '0.06em',

    // ── Geometry ─────────────────────────────────────────────────────────────
    // LCARS is famously flat and hard-cornered on the data panels,
    // with the swoopy pill-bars handled by specific component classes.
    // panel-radius: 0 removes all rounded corners from the base skin's panels.
    'panel-radius':       '0px',
    'pill-radius':        '28px',    // for the pill/bar decorative elements
    'bracket-radius':     '0px',

    // ── Glow / shadow ────────────────────────────────────────────────────────
    // LCARS has NO glow. Flat illuminated screens, not holographics.
    // Setting glow to none kills the base skin's teal bloom everywhere.
    'glow-primary':       'none',
    'glow-secondary':     'none',
    'glow-alert':         'none',
    'glow-text':          'none',

    // ── Borders ──────────────────────────────────────────────────────────────
    'border-primary':     '2px solid #ff9900',
    'border-secondary':   '1px solid #cc7700',
    'border-dim':         '1px solid #2a1500',

    // ── Instrument style ─────────────────────────────────────────────────────
    // LCARS flips all arc/radial instruments to block-bar style.
    // The SkinManager reads this token to switch the instrument render mode.
    'instrument-style':   'block',

    // ── Motion ───────────────────────────────────────────────────────────────
    // LCARS feels digital and snappy — shorter pulse, no easing curves.
    'motion-pulse-duration':    '2s',
    'motion-panel-reveal':      '120ms',
    'motion-transition-easing': 'steps(4, end)',   // stepped / digital feel

    // ── LCARS-specific decorative tokens ────────────────────────────────────
    // These extend the base token schema. SkinManager passes unknown tokens
    // straight to :root — components can reference them for LCARS-specific
    // flourishes without breaking the base skin's layout.
    'lcars-bar-height':       '40px',   // pill-bar strip height
    'lcars-elbow-size':       '64px',   // size of the curved elbow connector brackets
    'lcars-pill-gap':         '4px',    // gap between pill-bar segments
    'lcars-block-color-a':    '#ff9900',  // orange
    'lcars-block-color-b':    '#ffcc00',  // yellow
    'lcars-block-color-c':    '#cc99cc',  // mauve
    'lcars-block-color-d':    '#9999ff',  // blue-purple
    'lcars-block-color-e':    '#ff6600',  // secondary orange
    'lcars-scan-line-opacity': '0',      // no scanlines — LCARS is not CRT
  },

  // ── Station callsigns ─────────────────────────────────────────────────────
  // LCARS renames every station in TNG terminology.
  // The functions are unchanged — the soul is different.
  station_callsigns: {
    conn:     'COMPUTER',    // main command / chat interface
    ops:      'TREASURY',    // finances / revenue operations
    tactical: 'COMMUNITY',   // audience / community dashboard
    science:  'ANALYTICS',   // data / performance analytics
    comms:    'DOMESTIC',    // email / newsletter / comms
    crew:     'PERSONNEL',   // team / crew management
    eng:      'SYSTEMS',     // infrastructure / settings
  },

  // ── Particles ─────────────────────────────────────────────────────────────
  // LCARS has no starfield. Pure black void.
  // preset: 'none' tells SkinManager to skip Three.js scene init entirely.
  particles: {
    preset:  'none',
    density: 0,
    speed:   0,
    module:  null,
  },

  // ── Sounds ────────────────────────────────────────────────────────────────
  // Null = silent fallback (SkinManager skips registration, no errors).
  // Future: replace nulls with paths to proper LCARS chirp samples.
  sounds: {
    comm_open:      null,   // LCARS two-tone chirp sequence, ~0.5s
    comm_close:     null,   // LCARS acknowledgment tone, ~0.3s
    alert_critical: null,   // LCARS red alert klaxon, ~1.0s
    panel_reveal:   null,   // LCARS panel selection beep, ~0.1s
    ambient_hum:    null,   // No ambient hum — LCARS bridge is silent at rest
  },

  // ── Crew persona ──────────────────────────────────────────────────────────
  // The ship's computer. Neutral. Precise. Informational.
  // The engine still runs the morning brief — only the voice changes.
  crew: {
    first_officer: {
      display_name: 'LCARS COMPUTER',
      persona_override: [
        'You are the ship\'s computer — the Library Computer Access/Retrieval System.',
        'You speak in precise, neutral, informational tones.',
        'No personality. No humor. No speculation.',
        'You report facts in the order of operational priority.',
        'Address the user as "Commander."',
        'Never use contractions.',
        'Never express enthusiasm, concern, or opinion.',
        'End every report with "Awaiting further instructions."',
      ].join(' '),
    },
  },

  // ── CSS overrides ─────────────────────────────────────────────────────────
  // Declarative overrides applied as a <style> block by SkinManager
  // after token injection. Only presentation — never layout, never geometry.
  // These target base-skin component classes to apply LCARS-specific
  // visual treatments that tokens alone cannot express.
  css_overrides: `
    /* ── LCARS pill-bar headers ─────────────────────────────────────────── */
    /* Replace rounded panel headers with flat LCARS block strips */
    [data-skin="lcars-classic"] .panel-header,
    [data-skin="lcars-classic"] .station-label {
      background: var(--lcars-block-color-a);
      color: #000000;
      font-weight: var(--font-weight-head);
      letter-spacing: var(--font-tracking-head);
      border-radius: var(--pill-radius) 0 0 var(--pill-radius);
      padding: 6px 20px 6px 16px;
      text-transform: uppercase;
    }

    /* ── Flat panel borders — no glow, no shadow ────────────────────────── */
    [data-skin="lcars-classic"] .mc-panel,
    [data-skin="lcars-classic"] .instrument-card,
    [data-skin="lcars-classic"] .data-panel {
      border: var(--border-primary);
      box-shadow: none;
      border-radius: var(--panel-radius);
    }

    /* ── Block-style instrument bars (replaces arc gauges) ──────────────── */
    [data-skin="lcars-classic"] .instrument-fill {
      border-radius: 0;
      transition: width var(--motion-panel-reveal) var(--motion-transition-easing);
    }

    /* ── LCARS elbow / corner bracket decorators ────────────────────────── */
    /* The iconic curved corner connectors. Pure CSS, no assets required. */
    [data-skin="lcars-classic"] .bridge-column::before {
      content: '';
      display: block;
      width: var(--lcars-elbow-size);
      height: var(--lcars-elbow-size);
      border-left: 8px solid var(--lcars-block-color-a);
      border-bottom: 8px solid var(--lcars-block-color-a);
      border-radius: 0 0 0 var(--pill-radius);
      margin-bottom: var(--lcars-pill-gap);
    }

    /* ── Alternating pill-bar color sequence ────────────────────────────── */
    /* Mimics the LCARS decorative strip pattern on the left panel column */
    [data-skin="lcars-classic"] .lcars-strip > *:nth-child(5n+1) { background: var(--lcars-block-color-a); }
    [data-skin="lcars-classic"] .lcars-strip > *:nth-child(5n+2) { background: var(--lcars-block-color-b); }
    [data-skin="lcars-classic"] .lcars-strip > *:nth-child(5n+3) { background: var(--lcars-block-color-c); }
    [data-skin="lcars-classic"] .lcars-strip > *:nth-child(5n+4) { background: var(--lcars-block-color-d); }
    [data-skin="lcars-classic"] .lcars-strip > *:nth-child(5n+5) { background: var(--lcars-block-color-e); }

    /* ── Text on colored blocks ─────────────────────────────────────────── */
    [data-skin="lcars-classic"] .lcars-strip > * {
      color: #000000;
      font-weight: var(--font-weight-head);
      letter-spacing: var(--font-tracking-head);
      text-transform: uppercase;
      padding: 6px 12px;
      margin-bottom: var(--lcars-pill-gap);
    }

    /* ── Flat button style ──────────────────────────────────────────────── */
    [data-skin="lcars-classic"] button,
    [data-skin="lcars-classic"] .mc-btn {
      background: var(--lcars-block-color-a);
      color: #000000;
      border: none;
      border-radius: var(--pill-radius);
      font-weight: var(--font-weight-hud);
      letter-spacing: var(--font-tracking-hud);
      text-transform: uppercase;
      box-shadow: none;
    }

    [data-skin="lcars-classic"] button:hover,
    [data-skin="lcars-classic"] .mc-btn:hover {
      background: var(--lcars-block-color-b);
      box-shadow: none;
    }

    /* ── Remove all glows from interactive elements ─────────────────────── */
    [data-skin="lcars-classic"] *:focus,
    [data-skin="lcars-classic"] *:hover {
      outline: none;
      box-shadow: none;
    }

    /* ── Active/selected state: invert block ────────────────────────────── */
    [data-skin="lcars-classic"] .active,
    [data-skin="lcars-classic"] [aria-selected="true"] {
      background: var(--mc-amber);
      color: #000000;
      box-shadow: none;
    }

    /* ── Alert / status colors — flat, no glow ──────────────────────────── */
    [data-skin="lcars-classic"] .status-critical { background: var(--mc-red);    color: #ffffff; }
    [data-skin="lcars-classic"] .status-warning  { background: var(--mc-amber);  color: #000000; }
    [data-skin="lcars-classic"] .status-nominal  { background: var(--mc-green);  color: #000000; }

    /* ── Scrollbars — orange on black ───────────────────────────────────── */
    [data-skin="lcars-classic"] ::-webkit-scrollbar              { width: 6px; background: #000000; }
    [data-skin="lcars-classic"] ::-webkit-scrollbar-thumb        { background: var(--mc-teal-dim); border-radius: 0; }
    [data-skin="lcars-classic"] ::-webkit-scrollbar-thumb:hover  { background: var(--mc-teal); }
  `,

  // ── Skin load / unload lifecycle hooks ───────────────────────────────────
  // SkinManager calls these if present. Use for DOM patches that CSS alone
  // cannot express. Must be idempotent — may be called multiple times.
  onLoad(skinManager) {
    // Mark the root so all [data-skin="lcars-classic"] selectors activate
    document.documentElement.dataset.skin = 'lcars-classic';

    // Inject the CSS override block
    if (!document.getElementById('lcars-classic-css')) {
      const style = document.createElement('style');
      style.id = 'lcars-classic-css';
      style.textContent = window.SKIN_LCARS_CLASSIC.css_overrides;
      document.head.appendChild(style);
    }

    // Stamp LCARS strip class on the left nav column if present
    const leftCol = document.querySelector('.bridge-left-column, .nav-column, #kre8r-nav');
    if (leftCol) leftCol.classList.add('lcars-strip');

    // Disable particle renderer if SkinManager exposes a handle
    if (skinManager && typeof skinManager.stopParticles === 'function') {
      skinManager.stopParticles();
    }
  },

  onUnload(skinManager) {
    // Remove the CSS override block
    const style = document.getElementById('lcars-classic-css');
    if (style) style.remove();

    // Remove LCARS strip class
    const leftCol = document.querySelector('.bridge-left-column, .nav-column, #kre8r-nav');
    if (leftCol) leftCol.classList.remove('lcars-strip');

    // Clear the skin attribute so selectors deactivate
    delete document.documentElement.dataset.skin;
  },
};
