/*!
 * Kre8Ωr Course Completion Beacon  (Pillar 2)
 * Embed in a Kajabi lesson's custom-code block (or load via <script src>).
 *
 * Closes Kajabi's reporting blind spot: it has no per-member completion API, but the logged-in
 * member's identity IS exposed client-side at window.Kajabi.currentSiteUser
 *   = { id, type:"Member", contactId }   (confirmed on a live 7kinhomestead.com lesson, Jun 17 2026)
 *
 * Fires three events to /api/kajabi-track:
 *   - lesson_view   on page load
 *   - video_end     when a Wistia lesson video reaches the end
 *   - mark_complete when the member clicks "Mark As Complete"
 *
 * Identity join key is contact_id (the Kajabi CRM contactId). No email is exposed — and we don't
 * need one. Posts as text/plain via sendBeacon so it's a CORS simple request (no preflight).
 *
 * Endpoint: override by setting window.KRE8R_BEACON_ENDPOINT before this script loads
 * (e.g. an ngrok URL for local testing); otherwise defaults to production.
 */
(function () {
  if (window.__kre8rBeaconLoaded) return;        // guard against double-init
  window.__kre8rBeaconLoaded = true;

  var ENDPOINT = window.KRE8R_BEACON_ENDPOINT || 'https://kre8r.app/api/kajabi-track';

  // --- Identity (the whole reason this works) ---------------------------------
  var u = (window.Kajabi && window.Kajabi.currentSiteUser) || null;
  if (!u || (!u.contactId && !u.id)) return;      // no logged-in member → nothing useful to log

  // --- Parse course / module / lesson from the URL ----------------------------
  var path = location.pathname;
  function grab(re) { var m = path.match(re); return m ? m[1] : null; }
  var ctx = {
    product_slug : grab(/\/products\/([^/]+)/),
    category_id  : grab(/\/categories\/(\d+)/),
    post_id      : grab(/\/posts\/(\d+)/),
  };

  function lessonTitle() {
    var el = document.querySelector('.post-title, .lesson-title, .lesson__title, [data-post-title], main h1, h1');
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) : (document.title || '').slice(0, 300);
  }

  // --- Sender: sendBeacon (text/plain → no preflight), fetch keepalive fallback -
  function send(event, progress) {
    var payload = {
      contact_id   : u.contactId || null,
      site_user_id : u.id || null,
      member_type  : u.type || null,
      product_slug : ctx.product_slug,
      category_id  : ctx.category_id,
      post_id      : ctx.post_id,
      lesson_title : lessonTitle(),
      event        : event,
      progress     : (progress != null ? progress : null),
      url          : location.href.slice(0, 500),
    };
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }));
        return;
      }
    } catch (e) { /* fall through */ }
    try {
      fetch(ENDPOINT, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'no-cors' });
    } catch (e) { /* fire-and-forget */ }
  }

  // --- 1) lesson_view on load -------------------------------------------------
  send('lesson_view');

  // --- 2) mark_complete on the completion button (event delegation) -----------
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest
      ? ev.target.closest('[data-post-completion-toggle], .mark-as-complete, .btn--completion, .lesson-complete-wrap button, .lesson-complete-wrap a')
      : null;
    if (t) send('mark_complete');
  }, true);

  // --- 3) video_end via Wistia (lessons use Wistia) ---------------------------
  try {
    window._wq = window._wq || [];
    window._wq.push({ id: '_all', onReady: function (video) {
      try { video.bind('end', function () { send('video_end', 100); }); } catch (e) {}
    }});
  } catch (e) {}
})();
