/**
 * STARFLEET COMMAND — Foundation skin (free, default)
 * SNW / Discovery bridge aesthetic. This formalizes the current mission-control.html
 * :root tokens as the canonical baseline all other skins diff against.
 *
 * Loaded by SkinManager. Written to :root under [data-skin="starfleet-command"].
 */
window.SKIN_STARFLEET_COMMAND = {
  meta: {
    id: 'starfleet-command',
    name: 'Starfleet Command',
    author: 'kre8r-official',
    era: 'SNW / Discovery bridge',
    version: '1.0.0',
    tier: 'foundation',
    price_usd: 0,
    description: 'The default bridge. SNW/Discovery aesthetic. Deep space, teal systems, holographic depth.',
    preview_emoji: '🚀',
  },

  tokens: {
    // ── Backgrounds & surfaces ──────────────────────────────────────────
    'mc-bg':          '#060c0e',
    'mc-panel':       '#0d1e20',
    'mc-panel-hi':    '#112428',
    'mc-line':        '#1a2e32',

    // ── Brand palette ───────────────────────────────────────────────────
    'mc-teal':        '#14b8a6',
    'mc-teal-dim':    '#0d6b62',
    'mc-cyan':        '#06b6d4',
    'mc-amber':       '#f0a020',
    'mc-red':         '#ef4444',
    'mc-green':       '#22c55e',
    'mc-green-soft':  '#86efac',
    'mc-violet':      '#8b5cf6',
    'mc-orange':      '#fb923c',

    // ── Text ────────────────────────────────────────────────────────────
    'mc-text':        '#d4edea',
    'mc-text-dim':    '#4a7070',

    // ── Station accent colors ───────────────────────────────────────────
    'conn-color':     '#14b8a6',
    'tactical-color': '#f0a020',
    'ops-color':      '#8b5cf6',
    'science-color':  '#06b6d4',
    'comms-color':    '#86efac',
    'eng-color':      '#fb923c',

    // ── Typography ──────────────────────────────────────────────────────
    'font-hud':  "'Orbitron', monospace",
    'font-head': "'Bebas Neue', sans-serif",
    'font-data': "'Exo 2', system-ui, sans-serif",
    'font-body': "'Exo 2', system-ui, sans-serif",

    // ── Geometry & motion ───────────────────────────────────────────────
    'panel-radius':           '4px',
    'glow-primary':           '0 0 12px rgba(20,184,166,0.6)',
    'motion-pulse-duration':  '4s',
    'instrument-style':       'arc',
  },

  station_callsigns: {
    conn:     'CONN',
    ops:      'OPS',
    tactical: 'TACTICAL',
    science:  'SCIENCE',
    comms:    'COMMS',
    crew:     'CREW',
    eng:      'ENG',
  },

  particles: {
    preset:          'deep-starfield',
    density:         1.0,
    speed:           0.5,
    color_primary:   '#14b8a6',
    color_secondary: '#6db6ff',
  },

  sounds: {
    comm_open:      null,  // ElevenLabs: "soft two-tone starfleet comm chime, 1 second"
    comm_close:     null,  // ElevenLabs: "brief static transmission close, 0.3 seconds"
    alert_critical: null,  // ElevenLabs: "starfleet red alert klaxon, single tone, 0.8 seconds"
    panel_reveal:   null,  // ElevenLabs: "soft LCARS panel activation chirp, 0.2 seconds"
    ambient_hum:    null,  // ElevenLabs: "subtle bridge ambient electronic hum, looping"
  },

  // No crew overrides — Number One, Grex, and Dale run their standard personas.
  crew: {},
};
