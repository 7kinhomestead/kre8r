(function () {
  // ─── PART 1: Console Error Interceptor ────────────────────────────────────
  var _originalError = console.error;
  var _errorLog = [];

  console.error = function () {
    var args = Array.prototype.slice.call(arguments);
    _errorLog.push({
      time: new Date().toISOString(),
      msg: args.map(function (a) {
        return typeof a === 'object' ? JSON.stringify(a) : String(a);
      }).join(' ')
    });
    if (_errorLog.length > 5) _errorLog.shift();
    _originalError.apply(console, args);
  };

  window.onerror = function (message, source, lineno, colno, error) {
    _errorLog.push({
      time: new Date().toISOString(),
      msg: 'window.onerror: ' + String(message) + ' @ ' + source + ':' + lineno + ':' + colno
    });
    if (_errorLog.length > 5) _errorLog.shift();
  };

  window.addEventListener('unhandledrejection', function (event) {
    _errorLog.push({
      time: new Date().toISOString(),
      msg: 'UnhandledRejection: ' + (event.reason ? String(event.reason) : 'unknown')
    });
    if (_errorLog.length > 5) _errorLog.shift();
  });

  // ─── PART 2: Context Capture ───────────────────────────────────────────────
  function _captureContext() {
    var params = new URLSearchParams(window.location.search);
    return {
      page: window.location.pathname,
      tool: document.title,
      project_id: params.get('project') || params.get('id') || null,
      browser: navigator.userAgent,
      timestamp: new Date().toISOString(),
      console_errors: JSON.stringify(_errorLog),
      url: window.location.href
    };
  }

  // ─── PART 3 + 4: Inject Button and Modal ──────────────────────────────────
  var _modalOpen = false;
  var _selectedSeverity = 'annoying';

  var _styles = `
    #kre8r-bug-btn {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      padding: 6px 12px;
      font-size: 13px;
      font-family: system-ui, sans-serif;
      background: transparent;
      border: 1px solid #00c2a8;
      color: #00c2a8;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      line-height: 1.4;
    }
    #kre8r-bug-btn:hover {
      background: #00c2a8;
      color: #0e0f0e;
    }
    #kre8r-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.75);
      z-index: 10000;
      display: none;
      align-items: center;
      justify-content: center;
      font-family: system-ui, sans-serif;
    }
    #kre8r-modal-overlay.open {
      display: flex;
    }
    #kre8r-modal-card {
      background: #141614;
      border: 1px solid #2a2e2c;
      border-radius: 12px;
      padding: 28px;
      max-width: 520px;
      width: 90%;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
      color: #e8e8e8;
      box-sizing: border-box;
    }
    #kre8r-modal-card * {
      box-sizing: border-box;
    }
    .br-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
    }
    .br-modal-title {
      font-size: 16px;
      font-weight: 600;
      color: #e8e8e8;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .br-logo-omega {
      color: #00c2a8;
      font-size: 18px;
    }
    .br-close-btn {
      background: none;
      border: none;
      color: #888;
      font-size: 20px;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
      transition: color 0.15s;
    }
    .br-close-btn:hover {
      color: #e8e8e8;
    }
    .br-field {
      margin-bottom: 16px;
    }
    .br-label {
      color: #888;
      font-size: 13px;
      margin-bottom: 4px;
      display: block;
    }
    .br-textarea, .br-input {
      background: #1a1e1d;
      border: 1px solid #2a2e2c;
      color: #e8e8e8;
      padding: 10px 12px;
      border-radius: 6px;
      width: 100%;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      transition: border-color 0.15s;
    }
    .br-textarea {
      resize: vertical;
      min-height: 72px;
    }
    .br-textarea:focus, .br-input:focus {
      border-color: #00c2a8;
      outline: none;
    }
    .br-textarea.error, .br-input.error {
      border-color: #e05555;
    }
    .br-error-msg {
      color: #e05555;
      font-size: 12px;
      margin-top: 4px;
      display: none;
    }
    .br-error-msg.visible {
      display: block;
    }
    .br-severity-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .br-pill {
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      cursor: pointer;
      border: 1px solid #00c2a8;
      background: #1a1e1d;
      color: #00c2a8;
      transition: background 0.15s, color 0.15s;
      user-select: none;
    }
    .br-pill.active {
      background: #00c2a8;
      color: #0e0f0e;
      font-weight: 600;
    }
    .br-pill:hover:not(.active) {
      background: rgba(0,194,168,0.1);
    }
    .br-collapsible-toggle {
      background: none;
      border: none;
      color: #888;
      font-size: 13px;
      cursor: pointer;
      padding: 0;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: color 0.15s;
    }
    .br-collapsible-toggle:hover {
      color: #00c2a8;
    }
    .br-context-pre {
      background: #0d0d0d;
      color: #00c2a8;
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      padding: 12px;
      border-radius: 6px;
      white-space: pre-wrap;
      word-break: break-all;
      display: none;
      margin-top: 4px;
      line-height: 1.5;
    }
    .br-context-pre.open {
      display: block;
    }
    .br-modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
    }
    .br-btn-cancel {
      background: transparent;
      border: 1px solid #2a2e2c;
      color: #888;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-family: system-ui, sans-serif;
      transition: border-color 0.15s, color 0.15s;
    }
    .br-btn-cancel:hover {
      border-color: #888;
      color: #e8e8e8;
    }
    .br-btn-submit {
      background: #00c2a8;
      border: 1px solid #00c2a8;
      color: #0e0f0e;
      padding: 8px 18px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      transition: opacity 0.15s;
    }
    .br-btn-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .br-modal-error {
      color: #e05555;
      font-size: 13px;
      margin-top: 10px;
      text-align: center;
      display: none;
    }
    .br-modal-error.visible {
      display: block;
    }
    /* ─── Toast ─── */
    #kre8r-toast {
      position: fixed;
      bottom: 64px;
      right: 20px;
      z-index: 10001;
      background: #141614;
      border: 1px solid #00c2a8;
      color: #e8e8e8;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 14px;
      font-family: system-ui, sans-serif;
      opacity: 0;
      transform: translateY(20px);
      transition: opacity 0.25s ease, transform 0.25s ease;
      pointer-events: none;
    }
    #kre8r-toast.show {
      opacity: 1;
      transform: translateY(0);
    }
    /* ─── NPS Panel ─── */
    #kre8r-nps-panel {
      position: fixed;
      bottom: 20px;
      left: 20px;
      z-index: 9998;
      background: #141614;
      border: 1px solid #2a2e2c;
      border-radius: 12px;
      padding: 20px 24px;
      max-width: 360px;
      width: calc(100vw - 40px);
      box-shadow: 0 4px 24px rgba(0,194,168,0.1);
      font-family: system-ui, sans-serif;
      color: #e8e8e8;
      display: none;
      box-sizing: border-box;
    }
    #kre8r-nps-panel * {
      box-sizing: border-box;
    }
    #kre8r-nps-panel.open {
      display: block;
    }
    .nps-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .nps-title {
      font-size: 15px;
      font-weight: 600;
    }
    .nps-close {
      background: none;
      border: none;
      color: #888;
      font-size: 18px;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
      transition: color 0.15s;
    }
    .nps-close:hover {
      color: #e8e8e8;
    }
    .nps-sub {
      color: #888;
      font-size: 12px;
      margin-bottom: 14px;
    }
    .nps-stars {
      display: flex;
      gap: 6px;
      margin-bottom: 14px;
    }
    .nps-star {
      font-size: 26px;
      cursor: pointer;
      color: #2a2e2c;
      transition: color 0.1s, transform 0.1s;
      user-select: none;
      line-height: 1;
    }
    .nps-star.filled {
      color: #f0b942;
    }
    .nps-star:hover {
      transform: scale(1.15);
    }
    .nps-comment {
      background: #1a1e1d;
      border: 1px solid #2a2e2c;
      color: #e8e8e8;
      padding: 8px 10px;
      border-radius: 6px;
      width: 100%;
      font-size: 13px;
      font-family: system-ui, sans-serif;
      margin-bottom: 12px;
      transition: border-color 0.15s;
    }
    .nps-comment:focus {
      border-color: #00c2a8;
      outline: none;
    }
    .nps-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .nps-btn-skip {
      background: transparent;
      border: 1px solid #2a2e2c;
      color: #888;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-family: system-ui, sans-serif;
      transition: color 0.15s;
    }
    .nps-btn-skip:hover {
      color: #e8e8e8;
    }
    .nps-btn-submit {
      background: #00c2a8;
      border: 1px solid #00c2a8;
      color: #0e0f0e;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      transition: opacity 0.15s;
    }
    .nps-btn-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    /* ─── NPS mini toast ─── */
    #kre8r-nps-toast {
      position: fixed;
      bottom: 64px;
      left: 20px;
      z-index: 9999;
      background: #141614;
      border: 1px solid #00c2a8;
      color: #e8e8e8;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-family: system-ui, sans-serif;
      opacity: 0;
      transform: translateY(20px);
      transition: opacity 0.25s ease, transform 0.25s ease;
      pointer-events: none;
    }
    #kre8r-nps-toast.show {
      opacity: 1;
      transform: translateY(0);
    }
  `;

  function _injectStyles() {
    var style = document.createElement('style');
    style.textContent = _styles;
    document.head.appendChild(style);
  }

  function _injectButton() {
    var btn = document.createElement('button');
    btn.id = 'kre8r-bug-btn';
    btn.textContent = '⚠ Report Issue';
    btn.addEventListener('click', _openModal);
    document.body.appendChild(btn);
  }

  function _injectModal() {
    var overlay = document.createElement('div');
    overlay.id = 'kre8r-modal-overlay';
    overlay.innerHTML = `
      <div id="kre8r-modal-card" role="dialog" aria-modal="true" aria-labelledby="br-modal-heading">
        <div class="br-modal-header">
          <div class="br-modal-title">
            <span class="br-logo-omega">KRE8Ω</span>
            <span id="br-modal-heading">Report an Issue</span>
          </div>
          <button class="br-close-btn" id="br-modal-close" aria-label="Close">&times;</button>
        </div>

        <div class="br-field">
          <label class="br-label" for="br-what-tried">What were you trying to do?</label>
          <textarea id="br-what-tried" class="br-textarea" rows="3" placeholder="e.g. Generate a script in WritΩr for project #12"></textarea>
          <div class="br-error-msg" id="br-err-tried">Please describe what you were trying to do.</div>
        </div>

        <div class="br-field">
          <label class="br-label" for="br-what-happened">What happened instead?</label>
          <textarea id="br-what-happened" class="br-textarea" rows="3" placeholder="e.g. The page went blank after clicking Generate"></textarea>
          <div class="br-error-msg" id="br-err-happened">Please describe what happened.</div>
        </div>

        <div class="br-field">
          <label class="br-label">Severity</label>
          <div class="br-severity-row" id="br-severity-row">
            <span class="br-pill" data-value="blocker">🔴 Blocker</span>
            <span class="br-pill active" data-value="annoying">🟡 Annoying</span>
            <span class="br-pill" data-value="minor">🟢 Minor</span>
          </div>
        </div>

        <div class="br-field">
          <button class="br-collapsible-toggle" id="br-ctx-toggle" type="button">▸ Show captured context</button>
          <pre class="br-context-pre" id="br-context-pre"></pre>
        </div>

        <div class="br-field">
          <label class="br-label" for="br-name">Your name (optional)</label>
          <input type="text" id="br-name" class="br-input" placeholder="e.g. Jason" />
        </div>

        <div class="br-modal-error" id="br-modal-error">Something went wrong submitting the report. Please try again.</div>

        <div class="br-modal-footer">
          <button class="br-btn-cancel" id="br-btn-cancel" type="button">Cancel</button>
          <button class="br-btn-submit" id="br-btn-submit" type="button">Submit Report →</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Wire close events
    document.getElementById('br-modal-close').addEventListener('click', _closeModal);
    document.getElementById('br-btn-cancel').addEventListener('click', _closeModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _closeModal();
    });

    // Severity pills
    document.getElementById('br-severity-row').addEventListener('click', function (e) {
      var pill = e.target.closest('.br-pill');
      if (!pill) return;
      _selectedSeverity = pill.getAttribute('data-value');
      document.querySelectorAll('.br-pill').forEach(function (p) {
        p.classList.toggle('active', p === pill);
      });
    });

    // Collapsible context
    document.getElementById('br-ctx-toggle').addEventListener('click', function () {
      var pre = document.getElementById('br-context-pre');
      var isOpen = pre.classList.toggle('open');
      this.textContent = isOpen ? '▾ Hide captured context' : '▸ Show captured context';
      if (isOpen) _populateContext();
    });

    // Submit
    document.getElementById('br-btn-submit').addEventListener('click', _submitReport);
  }

  function _populateContext() {
    var ctx = _captureContext();
    var pre = document.getElementById('br-context-pre');
    pre.textContent = [
      'page:           ' + ctx.page,
      'project_id:     ' + (ctx.project_id || 'none'),
      'browser:        ' + ctx.browser.substring(0, 80) + (ctx.browser.length > 80 ? '…' : ''),
      'timestamp:      ' + ctx.timestamp,
      'console_errors: ' + (_errorLog.length + ' captured')
    ].join('\n');
  }

  function _openModal() {
    _modalOpen = true;
    document.getElementById('kre8r-modal-overlay').classList.add('open');
    // Reset form
    document.getElementById('br-what-tried').value = '';
    document.getElementById('br-what-happened').value = '';
    document.getElementById('br-name').value = '';
    document.getElementById('br-what-tried').classList.remove('error');
    document.getElementById('br-what-happened').classList.remove('error');
    document.getElementById('br-err-tried').classList.remove('visible');
    document.getElementById('br-err-happened').classList.remove('visible');
    document.getElementById('br-modal-error').classList.remove('visible');
    document.getElementById('br-btn-submit').disabled = false;
    document.getElementById('br-btn-submit').textContent = 'Submit Report →';
    _selectedSeverity = 'annoying';
    document.querySelectorAll('.br-pill').forEach(function (p) {
      p.classList.toggle('active', p.getAttribute('data-value') === 'annoying');
    });
    // Collapse context
    var pre = document.getElementById('br-context-pre');
    pre.classList.remove('open');
    document.getElementById('br-ctx-toggle').textContent = '▸ Show captured context';
    // Focus first field
    setTimeout(function () {
      document.getElementById('br-what-tried').focus();
    }, 50);
  }

  function _closeModal() {
    _modalOpen = false;
    document.getElementById('kre8r-modal-overlay').classList.remove('open');
  }

  // ─── PART 5: Form Submission ───────────────────────────────────────────────
  function _submitReport() {
    var whatTried = document.getElementById('br-what-tried').value.trim();
    var whatHappened = document.getElementById('br-what-happened').value.trim();
    var valid = true;

    if (!whatTried) {
      document.getElementById('br-what-tried').classList.add('error');
      document.getElementById('br-err-tried').classList.add('visible');
      valid = false;
    } else {
      document.getElementById('br-what-tried').classList.remove('error');
      document.getElementById('br-err-tried').classList.remove('visible');
    }

    if (!whatHappened) {
      document.getElementById('br-what-happened').classList.add('error');
      document.getElementById('br-err-happened').classList.add('visible');
      valid = false;
    } else {
      document.getElementById('br-what-happened').classList.remove('error');
      document.getElementById('br-err-happened').classList.remove('visible');
    }

    if (!valid) return;

    var submitBtn = document.getElementById('br-btn-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    document.getElementById('br-modal-error').classList.remove('visible');

    var ctx = _captureContext();
    var payload = {
      what_tried: whatTried,
      what_happened: whatHappened,
      severity: _selectedSeverity,
      reporter_name: document.getElementById('br-name').value.trim() || null,
      page: ctx.page,
      project_id: ctx.project_id,
      browser: ctx.browser,
      console_errors: ctx.console_errors,
      timestamp: ctx.timestamp
    };

    fetch('/api/beta/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        _closeModal();
        _showToast('Report submitted — thank you! 🙏');
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Report →';
        document.getElementById('br-modal-error').classList.add('visible');
      });
  }

  // ─── PART 6: Success Toast ─────────────────────────────────────────────────
  function _injectToast() {
    var toast = document.createElement('div');
    toast.id = 'kre8r-toast';
    document.body.appendChild(toast);
  }

  function _showToast(msg) {
    var toast = document.getElementById('kre8r-toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(function () {
      toast.classList.remove('show');
    }, 3000);
  }

  // ─── PART 7: NPS Prompt ────────────────────────────────────────────────────
  var _npsScore = 0;
  var _npsProjectId = null;

  function _injectNPS() {
    var panel = document.createElement('div');
    panel.id = 'kre8r-nps-panel';
    panel.innerHTML = `
      <div class="nps-header">
        <span class="nps-title">How was that?</span>
        <button class="nps-close" id="nps-close" aria-label="Close NPS">✕</button>
      </div>
      <div class="nps-sub">Rate your WritΩr experience</div>
      <div class="nps-stars" id="nps-stars">
        <span class="nps-star" data-val="1">★</span>
        <span class="nps-star" data-val="2">★</span>
        <span class="nps-star" data-val="3">★</span>
        <span class="nps-star" data-val="4">★</span>
        <span class="nps-star" data-val="5">★</span>
      </div>
      <input type="text" class="nps-comment" id="nps-comment" placeholder="Any thoughts? (optional)" />
      <div class="nps-footer">
        <button class="nps-btn-skip" id="nps-skip">Skip</button>
        <button class="nps-btn-submit" id="nps-submit" disabled>Submit</button>
      </div>
    `;
    document.body.appendChild(panel);

    var npsToast = document.createElement('div');
    npsToast.id = 'kre8r-nps-toast';
    document.body.appendChild(npsToast);

    // Star interaction
    var stars = document.querySelectorAll('.nps-star');
    stars.forEach(function (star) {
      star.addEventListener('click', function () {
        _npsScore = parseInt(this.getAttribute('data-val'), 10);
        _updateStars(_npsScore);
        document.getElementById('nps-submit').disabled = false;
      });
      star.addEventListener('mouseover', function () {
        _updateStars(parseInt(this.getAttribute('data-val'), 10));
      });
      star.addEventListener('mouseout', function () {
        _updateStars(_npsScore);
      });
    });

    document.getElementById('nps-close').addEventListener('click', function () {
      _dismissNPS(true);
    });
    document.getElementById('nps-skip').addEventListener('click', function () {
      _dismissNPS(true);
    });
    document.getElementById('nps-submit').addEventListener('click', function () {
      _submitNPS();
    });
  }

  function _updateStars(filledCount) {
    document.querySelectorAll('.nps-star').forEach(function (star) {
      var val = parseInt(star.getAttribute('data-val'), 10);
      star.classList.toggle('filled', val <= filledCount);
    });
  }

  function _showNPS(projectId) {
    if (!projectId) return;
    var alreadyShown = localStorage.getItem('kre8r_nps_shown_' + projectId);
    if (alreadyShown) return;
    _npsProjectId = projectId;
    _npsScore = 0;
    _updateStars(0);
    document.getElementById('nps-comment').value = '';
    document.getElementById('nps-submit').disabled = true;
    document.getElementById('kre8r-nps-panel').classList.add('open');
  }

  function _dismissNPS(skipSubmit) {
    document.getElementById('kre8r-nps-panel').classList.remove('open');
    if (_npsProjectId) {
      localStorage.setItem('kre8r_nps_shown_' + _npsProjectId, '1');
    }
    if (skipSubmit) {
      _showNPSToast('Thanks for the feedback ✓');
    }
  }

  function _submitNPS() {
    var submitBtn = document.getElementById('nps-submit');
    submitBtn.disabled = true;
    var ctx = _captureContext();
    var payload = {
      score: _npsScore * 2, // map 1-5 → 2,4,6,8,10
      comment: document.getElementById('nps-comment').value.trim() || null,
      page: ctx.page,
      project_id: _npsProjectId
    };

    fetch('/api/beta/nps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function () {})
      .catch(function () {});

    document.getElementById('kre8r-nps-panel').classList.remove('open');
    if (_npsProjectId) {
      localStorage.setItem('kre8r_nps_shown_' + _npsProjectId, '1');
    }
    _showNPSToast('Thanks for the feedback ✓');
  }

  function _showNPSToast(msg) {
    var toast = document.getElementById('kre8r-nps-toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(function () {
      toast.classList.remove('show');
    }, 3000);
  }

  function _checkPendingNPS() {
    // Check if WritΩr set a pending approval in localStorage
    var approved = localStorage.getItem('kre8r_writr_approved');
    if (!approved) return;
    var alreadyShown = localStorage.getItem('kre8r_nps_shown_' + approved);
    if (!alreadyShown) {
      // Small delay so page settles
      setTimeout(function () {
        _showNPS(approved);
      }, 1200);
    }
  }

  // ─── PART 8: Init ──────────────────────────────────────────────────────────
  function _init() {
    _injectStyles();
    _injectButton();
    _injectModal();
    _injectToast();
    _injectNPS();
    _checkPendingNPS();
  }

  // Expose global for WritΩr to call after script approval
  window.kre8rShowNPS = function (projectId) {
    _showNPS(projectId);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
})();
