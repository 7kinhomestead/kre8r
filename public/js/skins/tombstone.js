/**
 * TOMBSTONE — Creator skin ($12) — "I'm your huckleberry."
 * A full western narrative universe. Tombstone (1993) aesthetic: warm sepia,
 * silver-amber, gunmetal, dust. The bridge becomes a Sheriff's office; the crew
 * become the gunslingers, bankers, deputies, saloon keepers, and wire operators
 * of Tombstone Territory.
 *
 * Schema mirrors the other skins (window.SKIN_*): meta + bare token keys (no `--`
 * prefix — SkinManager prepends it). System prompts for each persona are defined
 * server-side in src/routes/mission.js (CREW_PERSONAS['tombstone']). The crew map
 * here drives the display name/title/color shown in the Comm Window.
 *
 * Loaded by SkinManager. Written to :root under [data-skin="tombstone"].
 */
window.SKIN_TOMBSTONE = {
  meta: {
    id: 'tombstone',
    name: 'Tombstone',
    author: 'kre8r-official',
    era: "Tombstone Territory, 1881 — \"I'm your huckleberry.\"",
    version: '1.0.0',
    tier: 'creator',
    price_usd: 12,
    description: "A full western universe. The bridge becomes a Sheriff's office. Doc Holliday gives the morning report, the Banker keeps the ledger, the Deputy works the docket, Belle runs the saloon, and the wire brings the figures. Warm sepia, silver-amber, gunmetal, dust.",
    preview_emoji: '🤠',
  },

  tokens: {
    // ── Backgrounds & surfaces — charred wood / dark leather ─────────────
    'mc-bg':          '#0f0a06',
    'mc-panel':       '#1a1208',
    'mc-panel-hi':    '#22180c',
    'mc-line':        '#2e2010',

    // ── Brand palette — amber/silver replaces teal/cyan ──────────────────
    'mc-teal':        '#d97706',   // primary accent: lamplight amber
    'mc-teal-dim':    '#7c4a06',   // dimmed amber
    'mc-cyan':        '#0891b2',   // secondary accent: telegraph blue-steel
    'mc-amber':       '#f59e0b',   // gold
    'mc-red':         '#dc2626',   // blood / danger
    'mc-green':       '#65a30d',   // sagebrush
    'mc-green-soft':  '#a3b86a',   // dusty sage
    'mc-violet':      '#b45309',   // burnt sienna (stands in for violet)
    'mc-orange':      '#ea7c1a',   // ember

    // ── Text — warm parchment cream ──────────────────────────────────────
    'mc-text':        '#e8d5b0',
    'mc-text-dim':    'rgba(232,213,176,0.45)',

    // ── Station accent colors — earthy frontier palette ──────────────────
    'conn-color':     '#d97706',   // amber: the trail / pipeline
    'tactical-color': '#d97706',   // saloon amber: community
    'ops-color':      '#b45309',   // silver-banker bronze: business
    'science-color':  '#0891b2',   // telegraph steel: audience
    'comms-color':    '#a3b86a',   // sage: family / homestead
    'eng-color':      '#ea7c1a',   // ember: engineering

    // ── Typography — frontier print ──────────────────────────────────────
    // Rye / Smokum would be ideal western faces; fall back gracefully to serif.
    'font-hud':  "'Rye', 'Courier New', monospace",
    'font-head': "'Rye', 'Playfair Display', Georgia, serif",
    'font-data': "'Courier New', Courier, monospace",
    'font-body': "'Playfair Display', Georgia, serif",

    // ── Shape & motion ───────────────────────────────────────────────────
    'panel-radius':         '2px',
    'glow-primary':         '0 0 12px rgba(217,119,6,0.55)',
    'glow-primary-strong':  '0 0 18px rgba(217,119,6,0.7)',
    'mc-glow':              'rgba(217,119,6,0.15)',
    'motion-pulse-duration':'4s',
    'instrument-style':     'arc',
  },

  // ── UI language overrides — swap bridge terminology for western ────────
  // (Consumed by getSkinLanguage() in mission-control.html for the FIRE sequence;
  //  kept here too so the whole universe lives in one file.)
  language: {
    captain:     'Sheriff',
    briefing:    'Morning Report',
    targetLock:  'DRAW IRON',
    fire:        'DRAW!',
    directHit:   "GOT 'EM, SHERIFF",
    standDown:   'HOLSTER IT',
    channelOpen: 'WIRE OPEN',
  },

  // ── Crew persona display overrides (visual only) ───────────────────────
  // System prompts are server-side in CREW_PERSONAS['tombstone'] (mission.js).
  crew: {
    'number-one': { name: 'DOC HOLLIDAY',      title: 'FIRST GUN · 7 KIN HOMESTEAD',    color: '#d97706', glyph: '🃏' },
    'grex':       { name: 'BANKER McCLELLAND', title: 'SILVER BANKER · TOMBSTONE',       color: '#b45309', glyph: '🪙' },
    'dale':       { name: 'DEPUTY FITCH',      title: 'TOWN DEPUTY · TOMBSTONE',         color: '#92400e', glyph: '⭐' },
    'vaelyn':     { name: 'BELLE CAVENDISH',   title: 'SALOON PROPRIETOR · TOMBSTONE',   color: '#d97706', glyph: '♠' },
    'axiom':      { name: 'WIRE OPERATOR',     title: 'TELEGRAPH OFFICE · TOMBSTONE',    color: '#0891b2', glyph: '—·—' },
  },

  sounds: {},
};
