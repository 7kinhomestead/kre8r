/**
 * HEARTH — Creator skin ($12)
 * The homestead command center. Warm amber lantern-light, wood-grain textures,
 * fireside-ember particle system. The anti-starship that proves the skin system
 * isn't locked to sci-fi. For Jason's brand: 7 Kin Homestead at dawn.
 *
 * Loaded by SkinManager. Written to :root under [data-skin="hearth"].
 */
window.SKIN_HEARTH = {
  meta: {
    id: 'hearth',
    name: 'Hearth',
    author: 'kre8r-official',
    era: 'Homestead — warm, grounded, alive',
    version: '1.0.0',
    tier: 'creator',
    price_usd: 12,
    description: 'The anti-starship. Amber lantern-light, wood-grain warmth, fireside-ember particles. Your command center feels like a homestead kitchen at dawn.',
    preview_emoji: '🔥',
  },

  tokens: {
    // ── Backgrounds & surfaces ──────────────────────────────────────────
    // Deep charred-wood black → warm dark brown panels
    'mc-bg':          '#0d0906',
    'mc-panel':       '#1a1108',
    'mc-panel-hi':    '#22160a',
    'mc-line':        '#2e1f0e',

    // ── Brand palette — amber/ember replaces teal/cyan ──────────────────
    'mc-teal':        '#e8860a',   // primary accent: lantern amber
    'mc-teal-dim':    '#7a3e02',   // dimmed amber
    'mc-cyan':        '#d4620a',   // secondary accent: ember orange
    'mc-amber':       '#f0a020',   // unchanged — amber stays amber
    'mc-red':         '#c0392b',   // coals-red
    'mc-green':       '#6a9b4a',   // moss green
    'mc-green-soft':  '#a8c880',   // soft sage
    'mc-violet':      '#7a5c3a',   // weathered purple-brown (muted)
    'mc-orange':      '#e05a1a',   // deep ember

    // ── Text — warm cream instead of cool teal-white ────────────────────
    'mc-text':        '#f0e4cc',
    'mc-text-dim':    '#6b4e2a',

    // ── Station accent colors — warm earthy palette ─────────────────────
    'conn-color':     '#e8860a',   // amber: navigation/conn
    'tactical-color': '#e05a1a',   // ember: tactical
    'ops-color':      '#7a5c3a',   // weathered brown: ops
    'science-color':  '#6a9b4a',   // moss: science/growth
    'comms-color':    '#a8c880',   // sage: comms
    'eng-color':      '#d4620a',   // hot ember: engineering

    // ── Typography — handcrafted warmth ─────────────────────────────────
    // Crimson Text: serif warmth for headings (replaces Bebas Neue cold impact)
    // Source Serif 4: warm readable body (replaces Exo 2 sci-fi feel)
    // Orbitron kept for HUD readability — instruments still need to be readable
    'font-hud':  "'Orbitron', monospace",
    'font-head': "'Crimson Text', Georgia, serif",
    'font-data': "'Source Serif 4', Georgia, serif",
    'font-body': "'Source Serif 4', Georgia, serif",

    // ── Geometry & motion — organic, slower, softer ──────────────────────
    'panel-radius':           '2px',   // less sharp than starfleet's 4px
    'glow-primary':           '0 0 14px rgba(232,134,10,0.5)',
    'motion-pulse-duration':  '6s',    // slower breathing — campfire rhythm
    'instrument-style':       'arc',   // arcs still work, just warm-colored
  },

  station_callsigns: {
    conn:     'WAYPOINT',
    ops:      'STORES',
    tactical: 'FENCE LINE',
    science:  'FIELD',
    comms:    'SIGNAL',
    crew:     'CREW',
    eng:      'WORKSHOP',
  },

  particles: {
    preset:          'fireside-embers',
    density:         0.7,
    speed:           0.3,            // slow drift upward, like embers
    color_primary:   '#e8860a',      // amber
    color_secondary: '#e05a1a',      // ember red-orange
  },

  sounds: {
    comm_open:      null,  // ElevenLabs: "soft wooden wind-chime, two notes, 0.8 seconds"
    comm_close:     null,  // ElevenLabs: "quiet wooden knock, single tap, 0.2 seconds"
    alert_critical: null,  // ElevenLabs: "iron triangle farm bell, three strikes, urgent"
    panel_reveal:   null,  // ElevenLabs: "soft paper page turn, gentle, 0.15 seconds"
    ambient_hum:    null,  // ElevenLabs: "quiet farmhouse morning ambience, fire crackling distant birds, looping"
  },

  crew: {
    // The foreman persona — warm, direct, folksy. Same function as Number One; different voice.
    first_officer: {
      persona_override: {
        name: 'The Foreman',
        voice: 'warm, plainspoken, encouraging — talks like a neighbor who knows what they\'re doing',
        greeting_style: 'Morning brief like a daily farm check-in, not a starship status report',
        alert_style: 'Direct and calm — "we\'ve got a fence down on the east side" not "ALERT: perimeter breach"',
        mission_language: 'homestead and harvest metaphors — "the harvest is ready", "plant this idea now", "this one needs more growing time"',
      },
    },
  },
};
