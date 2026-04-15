/**
 * Kre8Ωr Pipeline Tour — public/js/tour.js
 *
 * An interactive overlay tour that walks new creators through the full
 * pipeline in plain English. 8 stops, follows the creative thread from
 * idea to posted.
 *
 * Usage:
 *   startTour()          — start from stop 1
 *   startTour(3)         — start from a specific stop
 *   window.kre8rTour.start() — same as startTour()
 *
 * Auto-triggers on first visit (no localStorage key set).
 * Re-triggerable via the "?" button in the nav.
 */

(function () {
  'use strict';

  const TOUR_KEY = 'kre8r_tour_done';

  // ─────────────────────────────────────────────
  // TOUR STOPS
  // Plain English throughout. Written for a creator, not a developer.
  // ─────────────────────────────────────────────
  const STOPS = [
    {
      nav:   'pre',
      tool:  'Id8Ωr',
      emoji: '💡',
      title: 'It starts with an idea',
      body:  'Open Id8Ωr any time you have a concept you want to explore. Tell it what you\'re thinking — even just a few words — and it researches the topic, validates the angle, and hands you back three titles, three hooks, and three thumbnail concepts. The hardest part of content is already done.',
      href:  '/id8r.html',
    },
    {
      nav:   'pre',
      tool:  'PipΩr',
      emoji: '🗂️',
      title: 'Give your video a spine',
      body:  'PipΩr turns your idea into a project with a beat map — the emotional structure of your video, beat by beat. Think of it like a story outline, but built specifically for how creators hook and hold attention. Every project lives here until it\'s posted.',
      href:  '/pipr.html',
    },
    {
      nav:   'pre',
      tool:  'WritΩr',
      emoji: '✍️',
      title: 'Your script, in your actual voice',
      body:  'WritΩr reads your beat map and writes a full script — but not in generic AI voice. It\'s trained on your actual writing samples from the Soul Builder. The output sounds like you had a really productive day, not like a robot trying to sound human.',
      href:  '/writr.html',
    },
    {
      nav:   'post',
      tool:  'VaultΩr',
      emoji: '📦',
      title: 'Your footage, organized automatically',
      body:  'After you shoot, your footage goes into VaultΩr\'s watch folder. Kre8r automatically classifies every clip — talking head, b-roll, action — rates the quality, and tags what\'s in it so you can search "goat" or "water tank" and find exactly what you need. No manual logging.',
      href:  '/vault.html',
    },
    {
      nav:   'post',
      tool:  'AssemblΩr',
      emoji: '🎬',
      title: 'The edit, without the grind',
      body:  'AssemblΩr reads your transcripts, matches every take to its beat, and builds the selects automatically. You see every option, you pick what lands — one click to swap takes. It\'s not replacing your edit judgment, it\'s removing the 3 hours you spend just getting clips in order.',
      href:  '/editor.html',
    },
    {
      nav:   'post',
      tool:  'ComposΩr',
      emoji: '🎵',
      title: 'Score and sound design',
      body:  'ComposΩr analyzes the emotional arc of your rough cut and generates music prompts matched to each scene — tense, hopeful, triumphant. It works with Suno AI to get you custom tracks, or gives you prompts to use anywhere.',
      href:  '/composor.html',
    },
    {
      nav:   'dist',
      tool:  'MailΩr',
      emoji: '📬',
      title: 'Email your audience automatically',
      body:  'MailΩr writes broadcast emails and community posts for every tier of your audience — free members get one message, paid members get a different one, inner circle gets something personal. All in your voice. You approve, copy, and paste into Kajabi. Done.',
      href:  '/mailor.html',
    },
    {
      nav:   'dist',
      tool:  'NorthΩr',
      emoji: '🧭',
      title: 'Your strategy dashboard',
      body:  'NorthΩr watches your channel performance, spots what\'s working, and tells you exactly what to do next. It\'s not analytics for its own sake — it\'s a system that makes sure every video you make is moving you toward the goal. Check it weekly.',
      href:  '/northr.html',
    },
  ];

  // ─────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────
  let currentStop = 0;
  let overlay     = null;
  let isOpen      = false;

  // ─────────────────────────────────────────────
  // CSS
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('kre8r-tour-css')) return;
    const css = `
/* ── Kre8Ωr Pipeline Tour ── */

#kre8r-tour-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(4px);
  animation: tourFadeIn 0.25s ease both;
}
#kre8r-tour-overlay.closing {
  animation: tourFadeOut 0.2s ease both;
}

@keyframes tourFadeIn  { from { opacity: 0; } to { opacity: 1; } }
@keyframes tourFadeOut { from { opacity: 1; } to { opacity: 0; } }

.tour-card {
  background: #161916;
  border: 1px solid #3d4439;
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.6);
  max-width: 520px;
  width: 100%;
  padding: 36px 40px 28px;
  position: relative;
  animation: tourSlideUp 0.3s cubic-bezier(0.16,1,0.3,1) both;
}
@keyframes tourSlideUp {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}

.tour-close {
  position: absolute;
  top: 16px;
  right: 16px;
  background: none;
  border: none;
  color: #4e5349;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.15s;
  line-height: 1;
}
.tour-close:hover { background: #1c1f1b; color: #8a9487; }

.tour-progress {
  display: flex;
  gap: 5px;
  margin-bottom: 28px;
}
.tour-pip {
  height: 3px;
  flex: 1;
  background: #2a2e28;
  border-radius: 2px;
  transition: background 0.3s ease;
}
.tour-pip.done    { background: #3ecfb2; }
.tour-pip.current { background: #3ecfb2; opacity: 0.5; }

.tour-emoji {
  font-size: 36px;
  margin-bottom: 12px;
  display: block;
  line-height: 1;
}

.tour-nav-tag {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: #3ecfb2;
  background: rgba(62,207,178,0.1);
  border: 1px solid rgba(62,207,178,0.2);
  border-radius: 20px;
  padding: 3px 10px;
  margin-bottom: 10px;
}

.tour-tool-name {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 32px;
  letter-spacing: 2px;
  color: #e8ebe6;
  margin-bottom: 6px;
  line-height: 1;
}

.tour-title {
  font-size: 15px;
  font-weight: 600;
  color: #8a9487;
  margin-bottom: 16px;
}

.tour-body {
  font-size: 14px;
  color: #8a9487;
  line-height: 1.7;
  margin-bottom: 28px;
}

.tour-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tour-skip {
  background: none;
  border: none;
  color: #4e5349;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  cursor: pointer;
  padding: 4px;
  transition: color 0.15s;
}
.tour-skip:hover { color: #8a9487; }

.tour-btns {
  display: flex;
  gap: 8px;
}

.tour-btn-prev {
  background: #1c1f1b;
  border: 1px solid #2a2e28;
  border-radius: 8px;
  color: #8a9487;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  font-weight: 600;
  padding: 9px 16px;
  cursor: pointer;
  transition: all 0.15s;
}
.tour-btn-prev:hover { border-color: #3d4439; color: #e8ebe6; }

.tour-btn-next {
  background: #3ecfb2;
  border: 1px solid #3ecfb2;
  border-radius: 8px;
  color: #0e0f0e;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  font-weight: 700;
  padding: 9px 20px;
  cursor: pointer;
  transition: all 0.15s;
}
.tour-btn-next:hover { background: #5adcc6; border-color: #5adcc6; }

.tour-open-link {
  display: inline-block;
  font-size: 12px;
  color: #3ecfb2;
  text-decoration: none;
  margin-top: 10px;
  opacity: 0.7;
  transition: opacity 0.15s;
}
.tour-open-link:hover { opacity: 1; }

/* ── Tour trigger button in nav ── */
.kn-tour-btn {
  background: none;
  border: 1px solid #2a2e28;
  border-radius: 50%;
  color: #4e5349;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  font-weight: 700;
  width: 26px;
  height: 26px;
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
  margin-left: 4px;
}
.kn-tour-btn:hover {
  border-color: #3ecfb2;
  color: #3ecfb2;
  background: rgba(62,207,178,0.08);
}
`;
    const el = document.createElement('style');
    el.id = 'kre8r-tour-css';
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  function render(stopIndex) {
    const stop = STOPS[stopIndex];
    const isLast = stopIndex === STOPS.length - 1;
    const isFirst = stopIndex === 0;

    const pips = STOPS.map((_, i) => {
      let cls = 'tour-pip';
      if (i < stopIndex) cls += ' done';
      else if (i === stopIndex) cls += ' current';
      return `<div class="${cls}"></div>`;
    }).join('');

    const navLabel = {
      pre:  'Pre-Production',
      prod: 'Production',
      post: 'Post-Production',
      dist: 'Distribution',
    }[stop.nav] || stop.nav;

    const html = `
      <div class="tour-card" role="dialog" aria-modal="true" aria-label="Pipeline tour: ${stop.tool}">
        <button class="tour-close" onclick="window.kre8rTour.close()" aria-label="Close tour">✕</button>
        <div class="tour-progress">${pips}</div>
        <span class="tour-emoji" aria-hidden="true">${stop.emoji}</span>
        <div class="tour-nav-tag">${navLabel}</div>
        <div class="tour-tool-name">${stop.tool}</div>
        <div class="tour-title">${stop.title}</div>
        <div class="tour-body">${stop.body}</div>
        <a href="${stop.href}" class="tour-open-link" target="_self">Open ${stop.tool} →</a>
        <div class="tour-footer">
          <button class="tour-skip" onclick="window.kre8rTour.close()">Skip tour</button>
          <div class="tour-btns">
            ${!isFirst ? `<button class="tour-btn-prev" onclick="window.kre8rTour.prev()">← Back</button>` : ''}
            ${isLast
              ? `<button class="tour-btn-next" onclick="window.kre8rTour.finish()">Let's go ✓</button>`
              : `<button class="tour-btn-next" onclick="window.kre8rTour.next()">Next →</button>`
            }
          </div>
        </div>
      </div>
    `;

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'kre8r-tour-overlay';
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) window.kre8rTour.close();
      });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = html;
    overlay.style.display = 'flex';

    // Trap focus
    const card = overlay.querySelector('.tour-card');
    if (card) card.focus && card.setAttribute('tabindex', '-1');
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  function start(stopIndex) {
    injectStyles();
    currentStop = (typeof stopIndex === 'number') ? stopIndex : 0;
    isOpen = true;
    render(currentStop);
    document.addEventListener('keydown', onKeydown);
  }

  function next() {
    if (currentStop < STOPS.length - 1) {
      currentStop++;
      render(currentStop);
    } else {
      finish();
    }
  }

  function prev() {
    if (currentStop > 0) {
      currentStop--;
      render(currentStop);
    }
  }

  function close() {
    if (!overlay) return;
    overlay.classList.add('closing');
    setTimeout(function() {
      if (overlay) {
        overlay.style.display = 'none';
        overlay.classList.remove('closing');
      }
      isOpen = false;
    }, 200);
    document.removeEventListener('keydown', onKeydown);
  }

  function finish() {
    // Persist both locally and server-side so Electron restarts don't reset the tour
    localStorage.setItem(TOUR_KEY, '1');
    fetch('/api/auth/kv/tour_done', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ value: '1' }),
    }).catch(function() {});
    close();
  }

  function onKeydown(e) {
    if (!isOpen) return;
    if (e.key === 'Escape')     close();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft')  prev();
  }

  // ─────────────────────────────────────────────
  // AUTO-TRIGGER ON FIRST VISIT
  // ─────────────────────────────────────────────
  function maybeAutoStart() {
    // Check server-side flag first (persists across Electron restarts),
    // fall back to localStorage for instant response.
    if (localStorage.getItem(TOUR_KEY)) return; // fast local check
    fetch('/api/auth/kv/tour_done')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.value) {
          localStorage.setItem(TOUR_KEY, '1'); // sync back to local
        } else {
          setTimeout(function() { start(0); }, 800);
        }
      })
      .catch(function() {
        // Server unreachable — fall back to localStorage only
        setTimeout(function() { start(0); }, 800);
      });
  }

  // ─────────────────────────────────────────────
  // EXPORT
  // ─────────────────────────────────────────────
  window.kre8rTour = { start: start, next: next, prev: prev, close: close, finish: finish };
  window.startTour = start; // shorthand

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeAutoStart);
  } else {
    maybeAutoStart();
  }

})();
