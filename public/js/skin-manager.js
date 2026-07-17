/**
 * SkinManager — Kre8Ωr Mission Control
 *
 * The presentation layer decoupling engine. Owns token injection, particle swap hooks,
 * sound registration, crew persona overrides, refit transitions, and skin persistence.
 *
 * Architecture rule: the engine owns layout; the skin owns soul.
 * A malformed skin CANNOT break the bridge — worst case it fails validation and the default loads.
 */

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT SKIN (Starfleet Command — ships with product, always the fallback)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SKIN = {
  meta: {
    id: 'starfleet-command',
    name: 'Starfleet Command',
    author: 'kre8r-official',
    era: 'SNW / Discovery bridge',
    version: '1.0.0',
    tier: 'foundation',
    price_usd: 0,
  },
  tokens: {
    'mc-bg':                '#060c0e',
    'mc-panel':             '#0d1e20',
    'mc-panel-hi':          '#112428',
    'mc-line':              '#1a2e32',
    'mc-teal':              '#14b8a6',
    'mc-teal-dim':          '#0d6b62',
    'mc-cyan':              '#06b6d4',
    'mc-text':              '#d4edea',
    'mc-text-dim':          '#4a7070',
    'mc-amber':             '#f0a020',
    'mc-red':               '#ef4444',
    'mc-green':             '#22c55e',
    'mc-green-soft':        '#86efac',
    'mc-violet':            '#8b5cf6',
    'mc-orange':            '#fb923c',
    'conn-color':           '#14b8a6',
    'tactical-color':       '#f0a020',
    'ops-color':            '#8b5cf6',
    'science-color':        '#06b6d4',
    'comms-color':          '#86efac',
    'eng-color':            '#fb923c',
    'font-hud':             "'Orbitron', monospace",
    'font-head':            "'Bebas Neue', sans-serif",
    'font-data':            "'Exo 2', system-ui, sans-serif",
    'font-body':            "'Exo 2', system-ui, sans-serif",
    'panel-radius':         '4px',
    'glow-primary':         '0 0 12px rgba(20,184,166,0.6)',
    'motion-pulse-duration':'4s',
    'instrument-style':     'arc',
  },
  sounds: {},
  crew:   {},
};

// ─────────────────────────────────────────────────────────────────────────────
// REQUIRED TOKEN SCHEMA
// Every skin must provide these — or the default value fills in.
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_TOKENS = [
  'mc-bg', 'mc-panel', 'mc-panel-hi', 'mc-line',
  'mc-teal', 'mc-teal-dim', 'mc-text', 'mc-text-dim',
  'mc-amber', 'mc-red', 'mc-green', 'mc-violet',
  'mc-green-soft', 'mc-orange',
  'font-hud', 'font-head', 'font-body',
  'panel-radius', 'motion-pulse-duration',
];

const LOCALSTORAGE_KEY = 'kre8r_skin';

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL STATE
// ─────────────────────────────────────────────────────────────────────────────

let _currentSkin   = null;   // full skin config object currently applied
let _sounds        = {};     // event-name → Audio element map
let _audioCtx      = null;   // lazily created Web Audio context
let _refitting     = false;  // guard against concurrent refits

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a skin config object against the required token schema.
 * Returns { valid: bool, missing: string[], warnings: string[] }.
 *
 * @param {object} skinConfig
 * @returns {{ valid: boolean, missing: string[], warnings: string[] }}
 */
function _validateSkin(skinConfig) {
  const warnings = [];
  const missing  = [];

  if (!skinConfig || typeof skinConfig !== 'object') {
    return { valid: false, missing: ['<entire skin config>'], warnings: [] };
  }
  if (!skinConfig.meta || !skinConfig.meta.id) {
    return { valid: false, missing: ['meta.id'], warnings: [] };
  }

  const tokens = skinConfig.tokens || {};

  for (const key of REQUIRED_TOKENS) {
    if (!Object.prototype.hasOwnProperty.call(tokens, key) || tokens[key] === undefined || tokens[key] === null || tokens[key] === '') {
      missing.push(key);
    }
  }

  if (!skinConfig.sounds)  warnings.push('No sounds map — sound hooks will be silent.');
  if (!skinConfig.crew)    warnings.push('No crew map — persona overrides unavailable.');
  if (!skinConfig.particles) warnings.push('No particles config — particle scene will use current defaults.');

  return { valid: true, missing, warnings };
}

/**
 * Merges a skin's token map with the default skin's tokens so every required token
 * resolves to a value. Non-required extra tokens from the skin are passed through.
 *
 * @param {object} skinTokens  — the incoming skin's tokens object
 * @returns {object}           — complete resolved token map
 */
function _resolveTokens(skinTokens) {
  const resolved = Object.assign({}, DEFAULT_SKIN.tokens, skinTokens || {});
  // Defensive: enforce every required token has a value (belt + suspenders)
  for (const key of REQUIRED_TOKENS) {
    if (!resolved[key]) {
      resolved[key] = DEFAULT_SKIN.tokens[key];
    }
  }
  return resolved;
}

/**
 * Writes a resolved token map to :root CSS custom properties.
 * Also sets document.documentElement.dataset.skin for [data-skin] selectors.
 *
 * @param {object} tokens   — resolved token map (key → value, no '--' prefix)
 * @param {string} skinId   — skin meta.id
 */
function _applyTokens(tokens, skinId) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--${key}`, value);
  }
  root.dataset.skin = skinId;
}

/**
 * Lazily returns a Web Audio context (created once, then reused).
 * Falls back gracefully if the browser blocks it.
 *
 * @returns {AudioContext|null}
 */
function _getAudioContext() {
  if (_audioCtx) return _audioCtx;
  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    console.warn('[SkinManager] Web Audio API unavailable:', e.message);
    _audioCtx = null;
  }
  return _audioCtx;
}

/**
 * Registers a sounds map (event-name → url) into _sounds as Audio elements.
 * Pre-loads (preload="auto") so playback is instant.
 *
 * @param {object} soundsMap  — e.g. { comm_open: 'sounds/chime.mp3', ... }
 */
function _registerSounds(soundsMap) {
  _sounds = {};
  if (!soundsMap || typeof soundsMap !== 'object') return;
  for (const [event, url] of Object.entries(soundsMap)) {
    if (!url) continue;
    try {
      const audio    = new Audio(url);
      audio.preload  = 'auto';
      _sounds[event] = audio;
    } catch (e) {
      console.warn(`[SkinManager] Could not register sound "${event}" → ${url}:`, e.message);
    }
  }
}

/**
 * Returns all instrument panel elements on the page, ordered left-to-right by
 * their bounding rect x coordinate. Used for sequential refit animation.
 *
 * Looks for elements with class: .panel, .instrument, .station-card, .gauge-panel, .hud-panel
 *
 * @returns {Element[]}
 */
function _getInstrumentPanels() {
  const selector = [
    '.panel',
    '.instrument',
    '.station-card',
    '.gauge-panel',
    '.hud-panel',
    '[data-instrument]',
  ].join(', ');

  const elements = Array.from(document.querySelectorAll(selector));

  // Sort left-to-right by bounding rect
  return elements.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.left - rb.left;
  });
}

/**
 * Dims or brightens all instrument panels sequentially (left-to-right, 80ms stagger).
 *
 * @param {'dim'|'bright'} direction
 * @param {number} staggerMs   — ms between each panel (default 80)
 * @returns {Promise<void>}    — resolves when the last panel finishes
 */
function _animatePanels(direction, staggerMs = 80) {
  return new Promise((resolve) => {
    const panels  = _getInstrumentPanels();
    const opacity = direction === 'dim' ? '0.3' : '1';
    const transitionMs = 200;

    if (panels.length === 0) {
      resolve();
      return;
    }

    panels.forEach((panel, i) => {
      setTimeout(() => {
        panel.style.transition = `opacity ${transitionMs}ms ease`;
        panel.style.opacity    = opacity;
        if (i === panels.length - 1) {
          setTimeout(resolve, transitionMs + 20);
        }
      }, i * staggerMs);
    });
  });
}

/**
 * Flashes a single-frame static-burst overlay over the whole page.
 *
 * @returns {Promise<void>}  — resolves after the overlay fades out
 */
function _staticBurst() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position:       'fixed',
      inset:          '0',
      zIndex:         '99999',
      background:     'rgba(255, 255, 255, 0.08)',
      pointerEvents:  'none',
      transition:     'opacity 150ms ease',
      opacity:        '1',
    });
    document.body.appendChild(overlay);

    // One frame visible, then fade
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          resolve();
        }, 200);
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

const SkinManager = {

  /**
   * Apply a skin config immediately (no transition animation).
   * Validates tokens, fills fallbacks, writes CSS custom properties, registers sounds + crew.
   * Persists the skin ID to localStorage.
   *
   * @param {object} skinConfig  — a full skin manifest object (parsed skin.json)
   * @returns {boolean}          — true if skin applied, false if validation failed hard
   */
  load(skinConfig) {
    const { valid, missing, warnings } = _validateSkin(skinConfig);

    if (!valid) {
      console.error('[SkinManager] Skin failed validation — loading default.', { missing });
      this.reset();
      return false;
    }

    if (missing.length > 0) {
      console.warn(
        `[SkinManager] Skin "${skinConfig.meta.id}" missing tokens [${missing.join(', ')}] — falling back to defaults.`
      );
    }
    if (warnings.length > 0) {
      warnings.forEach(w => console.info(`[SkinManager] ${w}`));
    }

    // Resolve tokens (skin + fallback defaults)
    const resolved = _resolveTokens(skinConfig.tokens);
    _applyTokens(resolved, skinConfig.meta.id);

    // Particle hook
    if (skinConfig.particles && typeof window.setSkinParticles === 'function') {
      try {
        window.setSkinParticles(skinConfig.particles);
      } catch (e) {
        console.warn('[SkinManager] Particle swap failed:', e.message);
      }
    }

    // Sound registration
    _registerSounds(skinConfig.sounds || {});

    // Store current skin
    _currentSkin = skinConfig;

    // Persist
    try {
      localStorage.setItem(LOCALSTORAGE_KEY, skinConfig.meta.id);
      // Store full config for restoration (compact stringify)
      localStorage.setItem(`${LOCALSTORAGE_KEY}_config`, JSON.stringify(skinConfig));
    } catch (e) {
      console.warn('[SkinManager] Could not persist skin to localStorage:', e.message);
    }

    return true;
  },

  /**
   * Animated refit transition to a new skin.
   *
   * Sequence:
   *   1. Instruments dim sequentially left-to-right (80ms stagger, ~200ms each)
   *   2. 600ms hold at dim
   *   3. Static burst overlay (1 frame, rgba 0.08)
   *   4. New skin tokens applied instantly
   *   5. Instruments brighten sequentially left-to-right
   *   Total: ~1.4s
   *
   * Re-entrant calls while a refit is in progress are ignored.
   *
   * @param {object} skinConfig  — the new skin manifest
   * @returns {Promise<boolean>} — resolves true if successful, false if blocked or invalid
   */
  async refit(skinConfig) {
    if (_refitting) {
      console.warn('[SkinManager] Refit already in progress — ignoring.');
      return false;
    }

    const { valid, missing } = _validateSkin(skinConfig);
    if (!valid) {
      console.error('[SkinManager] Refit target failed validation — aborting.', { missing });
      return false;
    }

    _refitting = true;

    try {
      // Step 1: Power down — dim sequentially
      await _animatePanels('dim', 80);

      // Step 2: Hold at dim
      await new Promise(r => setTimeout(r, 600));

      // Step 3: Static burst
      await _staticBurst();

      // Step 4: Apply new skin (no transition animation — we handle it manually)
      const resolved = _resolveTokens(skinConfig.tokens);
      _applyTokens(resolved, skinConfig.meta.id);

      if (skinConfig.particles && typeof window.setSkinParticles === 'function') {
        try { window.setSkinParticles(skinConfig.particles); } catch (e) {/* swallow */}
      }

      _registerSounds(skinConfig.sounds || {});
      _currentSkin = skinConfig;

      try {
        localStorage.setItem(LOCALSTORAGE_KEY, skinConfig.meta.id);
        localStorage.setItem(`${LOCALSTORAGE_KEY}_config`, JSON.stringify(skinConfig));
      } catch (e) { /* swallow localStorage errors */ }

      // Step 5: Power up — brighten sequentially
      await _animatePanels('bright', 80);

    } finally {
      _refitting = false;
    }

    return true;
  },

  /**
   * Restore the last-used skin from localStorage.
   * If no persisted skin or config is corrupt, applies the default skin silently.
   *
   * @returns {boolean}  — true if a non-default skin was restored
   */
  restore() {
    try {
      const storedId     = localStorage.getItem(LOCALSTORAGE_KEY);
      const storedConfig = localStorage.getItem(`${LOCALSTORAGE_KEY}_config`);

      if (!storedId || storedId === DEFAULT_SKIN.meta.id) {
        this.reset();
        return false;
      }

      if (storedConfig) {
        const parsed = JSON.parse(storedConfig);
        const loaded = this.load(parsed);
        if (loaded) return true;
      }
    } catch (e) {
      console.warn('[SkinManager] Could not restore skin from localStorage:', e.message);
    }

    // Fall through to default
    this.reset();
    return false;
  },

  /**
   * Returns the current skin's meta object, or null if no skin has been loaded.
   *
   * @returns {object|null}
   */
  current() {
    return _currentSkin ? _currentSkin.meta : null;
  },

  /**
   * Play a named sound from the current skin's registered audio.
   * Silently no-ops if the sound is not registered.
   *
   * Sound names match the skin.json `sounds` keys: 'comm_open', 'comm_close',
   * 'alert_critical', 'ambient_hum', etc.
   *
   * @param {string} soundName
   */
  play(soundName) {
    const audio = _sounds[soundName];
    if (!audio) return;

    // Unlock Web Audio context on first play (browsers require a user gesture)
    const ctx = _getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {/* swallow */});
    }

    // Reset and play (handles rapid re-triggering cleanly)
    try {
      audio.currentTime = 0;
      audio.play().catch(e => {
        // Autoplay policy — not a crash, just silence
        console.info(`[SkinManager] Sound "${soundName}" blocked by autoplay policy.`);
      });
    } catch (e) {
      console.warn(`[SkinManager] Could not play sound "${soundName}":`, e.message);
    }
  },

  /**
   * Returns the persona prompt override string for a given crew role,
   * or null if the current skin does not override that role.
   *
   * The crew map in skin.json may contain per-role manifest paths or inline
   * persona overrides. SkinManager surfaces whatever the skin provides.
   *
   * @param {string} role  — e.g. 'first_officer', 'tactical', 'conn'
   * @returns {object|null}  — the crew role config object, or null
   */
  getCrewPersona(role) {
    if (!_currentSkin || !_currentSkin.crew) return null;
    return _currentSkin.crew[role] || null;
  },

  /**
   * Revert to the default Starfleet Command skin.
   * Writes all default tokens, clears persisted skin ID.
   */
  reset() {
    const resolved = _resolveTokens(DEFAULT_SKIN.tokens);
    _applyTokens(resolved, DEFAULT_SKIN.meta.id);
    _registerSounds({});
    _currentSkin = DEFAULT_SKIN;

    try {
      localStorage.removeItem(LOCALSTORAGE_KEY);
      localStorage.removeItem(`${LOCALSTORAGE_KEY}_config`);
    } catch (e) { /* swallow */ }
  },

  // ─── Expose internals for testing / Refit Bay UI ──────────────────────────

  /** The default skin config object. Read-only reference. */
  DEFAULT_SKIN,

  /** The required token schema array. */
  REQUIRED_TOKENS,

  /**
   * Validate a skin config without applying it.
   * Useful for the Refit Bay preview and the k8skin CLI validator.
   *
   * @param {object} skinConfig
   * @returns {{ valid: boolean, missing: string[], warnings: string[] }}
   */
  validate(skinConfig) {
    return _validateSkin(skinConfig);
  },

  /**
   * Resolve what a skin's full token map would look like after fallback merging.
   * Returns the merged token object — useful for live preview diffs.
   *
   * @param {object} skinTokens
   * @returns {object}
   */
  resolveTokens(skinTokens) {
    return _resolveTokens(skinTokens);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-INIT
// Restore persisted skin as soon as the DOM is ready.
// ─────────────────────────────────────────────────────────────────────────────

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SkinManager.restore());
  } else {
    // DOM already ready (script loaded late / module)
    SkinManager.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL — window.SkinManager for all pages
// ─────────────────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.SkinManager = SkinManager;
}
