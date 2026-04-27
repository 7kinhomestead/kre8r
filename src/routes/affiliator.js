'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// ── Image upload storage ──────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '../../public/uploads/affiliate');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const imgUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename:    (_req, file,  cb) => {
      const ext  = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `gear-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype));
  }
});

// ── OG image scraper (best-effort, never throws) ──────────────────────────────
async function scrapeOgImage(url) {
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(6000),
                                    headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const html = await res.text();
    const m    = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
              || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

// ── Partners ──────────────────────────────────────────────────────────────────

router.get('/partners', (req, res) => {
  res.json(db.prepare('SELECT * FROM affiliate_partners ORDER BY status DESC, partner_name').all());
});

router.post('/partners', (req, res) => {
  const { partner_key, partner_name, tag_param, tag_value, commission_pct, signup_url, status, notes } = req.body;
  if (!partner_key || !partner_name) return res.status(400).json({ error: 'partner_key and partner_name required' });
  db.prepare(`INSERT INTO affiliate_partners
    (partner_key,partner_name,tag_param,tag_value,commission_pct,signup_url,status,notes)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(partner_key) DO UPDATE SET
      partner_name=excluded.partner_name, tag_param=excluded.tag_param,
      tag_value=excluded.tag_value, commission_pct=excluded.commission_pct,
      signup_url=excluded.signup_url, status=excluded.status, notes=excluded.notes`
  ).run(partner_key, partner_name, tag_param||null, tag_value||null,
        commission_pct||0, signup_url||null, status||'pending', notes||null);
  res.json({ ok: true });
});

router.put('/partners/:key', (req, res) => {
  const fields = ['partner_name','tag_param','tag_value','commission_pct','signup_url','status','notes'];
  const sets = []; const vals = [];
  fields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); } });
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.key);
  db.prepare(`UPDATE affiliate_partners SET ${sets.join(',')} WHERE partner_key=?`).run(...vals);
  res.json({ ok: true });
});

router.delete('/partners/:key', (req, res) => {
  db.prepare('DELETE FROM affiliate_partners WHERE partner_key=?').run(req.params.key);
  res.json({ ok: true });
});

// ── Links ─────────────────────────────────────────────────────────────────────

router.get('/links', (req, res) => {
  const { partner_key, tool } = req.query;
  let sql = 'SELECT * FROM affiliate_links WHERE 1=1';
  const params = [];
  if (partner_key) { sql += ' AND partner_key=?'; params.push(partner_key); }
  if (tool)        { sql += ' AND tool=?';         params.push(tool); }
  sql += ' ORDER BY tool, partner_key, label';
  res.json(db.prepare(sql).all(...params));
});

router.post('/links', async (req, res) => {
  const { partner_key, link_key, label, destination_url, tool,
          show_on_gear, gear_category, gear_price, gear_emoji, gear_description } = req.body;
  if (!partner_key || !link_key || !label || !destination_url)
    return res.status(400).json({ error: 'partner_key, link_key, label, destination_url required' });

  const r = db.prepare(`INSERT INTO affiliate_links
    (partner_key,link_key,label,destination_url,tool,show_on_gear,gear_category,gear_price,gear_emoji,gear_description)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(partner_key,link_key) DO UPDATE SET
      label=excluded.label, destination_url=excluded.destination_url, tool=excluded.tool,
      show_on_gear=excluded.show_on_gear, gear_category=excluded.gear_category,
      gear_price=excluded.gear_price, gear_emoji=excluded.gear_emoji, gear_description=excluded.gear_description`
  ).run(partner_key, link_key, label, destination_url, tool||null,
        show_on_gear ? 1 : 0, gear_category||null, gear_price||null, gear_emoji||null, gear_description||null);

  const linkId = r.lastInsertRowid;
  res.json({ ok: true, id: linkId });

  // Scrape OG image in background — don't block the response
  if (linkId && destination_url) {
    scrapeOgImage(destination_url).then(ogUrl => {
      if (ogUrl) db.prepare('UPDATE affiliate_links SET og_image_url=? WHERE id=? AND og_image_url IS NULL')
                   .run(ogUrl, linkId);
    });
  }
});

router.put('/links/:id', (req, res) => {
  const fields = ['label','destination_url','tool','active',
                  'show_on_gear','gear_category','gear_price','gear_emoji','gear_description','og_image_url'];
  const sets = []; const vals = [];
  fields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]); } });
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE affiliate_links SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json({ ok: true });
});

// ── Public gear endpoint (CORS open — consumed by 7kinhomestead.land/gear) ───
router.get('/gear-public', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const rows = db.prepare(`
    SELECT l.id, l.partner_key, l.link_key, l.label,
           l.gear_category, l.gear_price, l.gear_emoji, l.gear_description, l.og_image_url
    FROM affiliate_links l
    WHERE l.show_on_gear = 1 AND l.active = 1
    ORDER BY l.gear_category, l.label
  `).all();
  // Build tracked redirect URLs
  const base = req.protocol + '://' + req.get('host');
  const gear = rows.map(r => ({
    ...r,
    href: `${base}/r/${r.partner_key}/${r.link_key}`,
    // Make locally-uploaded images absolute so gear.html on kre8r-land can load them
    og_image_url: r.og_image_url
      ? (r.og_image_url.startsWith('http') ? r.og_image_url : `${base}${r.og_image_url}`)
      : null
  }));
  res.json(gear);
});

router.delete('/links/:id', (req, res) => {
  db.prepare('DELETE FROM affiliate_links WHERE id=?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

// ── Image upload / OG re-scrape for a link ────────────────────────────────────
// POST /api/affiliator/links/:id/image  (multipart: field "image")
// POST /api/affiliator/links/:id/rescrape  (re-fetch OG image from destination_url)
router.post('/links/:id/image', imgUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file received' });
  const url = `/uploads/affiliate/${req.file.filename}`;
  db.prepare('UPDATE affiliate_links SET og_image_url=? WHERE id=?').run(url, parseInt(req.params.id));
  res.json({ ok: true, og_image_url: url });
});

router.post('/links/:id/rescrape', async (req, res) => {
  const link = db.prepare('SELECT destination_url FROM affiliate_links WHERE id=?').get(parseInt(req.params.id));
  if (!link) return res.status(404).json({ error: 'Link not found' });
  const ogUrl = await scrapeOgImage(link.destination_url);
  if (ogUrl) {
    db.prepare('UPDATE affiliate_links SET og_image_url=? WHERE id=?').run(ogUrl, parseInt(req.params.id));
    res.json({ ok: true, og_image_url: ogUrl });
  } else {
    res.json({ ok: false, error: 'No OG image found at destination URL' });
  }
});

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get('/analytics', (req, res) => {
  const byPartner = db.prepare(`
    SELECT c.partner_key, p.partner_name, p.commission_pct,
           COUNT(*) AS clicks,
           COUNT(DISTINCT c.link_key) AS links_used,
           strftime('%Y-%m-%d', MAX(c.clicked_at)) AS last_click
    FROM affiliate_clicks c
    LEFT JOIN affiliate_partners p ON p.partner_key = c.partner_key
    GROUP BY c.partner_key ORDER BY clicks DESC
  `).all();

  const byLink = db.prepare(`
    SELECT c.partner_key, c.link_key, l.label, l.tool,
           COUNT(*) AS clicks,
           strftime('%Y-%m-%d', MAX(c.clicked_at)) AS last_click
    FROM affiliate_clicks c
    LEFT JOIN affiliate_links l ON l.partner_key=c.partner_key AND l.link_key=c.link_key
    GROUP BY c.partner_key, c.link_key ORDER BY clicks DESC LIMIT 50
  `).all();

  const byDay = db.prepare(`
    SELECT strftime('%Y-%m-%d', clicked_at) AS day, COUNT(*) AS clicks
    FROM affiliate_clicks
    WHERE clicked_at >= datetime('now', '-30 days')
    GROUP BY day ORDER BY day ASC
  `).all();

  const total = db.prepare('SELECT COUNT(*) AS n FROM affiliate_clicks').get().n;

  res.json({ total, byPartner, byLink, byDay });
});

// ── Commissions (confirmed earnings → OrgΩr TreasΩr bridge) ─────────────────

router.get('/commissions', (req, res) => {
  const { partner_key } = req.query;
  let sql = `SELECT ac.*, p.partner_name FROM affiliate_commissions ac
             LEFT JOIN affiliate_partners p ON p.partner_key = ac.partner_key`;
  const params = [];
  if (partner_key) { sql += ' WHERE ac.partner_key=?'; params.push(partner_key); }
  sql += ' ORDER BY ac.received_at DESC LIMIT 100';
  res.json(db.prepare(sql).all(...params));
});

router.post('/commissions', async (req, res) => {
  const { partner_key, link_key, amount, description, received_at } = req.body;
  if (!partner_key || !amount) return res.status(400).json({ error: 'partner_key and amount required' });
  if (parseFloat(amount) <= 0) return res.status(400).json({ error: 'amount must be positive' });

  const partner = db.prepare('SELECT * FROM affiliate_partners WHERE partner_key=?').get(partner_key);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });

  const ts = received_at || new Date().toISOString().slice(0, 19).replace('T', ' ');
  const label = description || `${partner.partner_name} affiliate commission`;

  const r = db.prepare(`
    INSERT INTO affiliate_commissions (partner_key, link_key, amount, description, received_at)
    VALUES (?,?,?,?,?)
  `).run(partner_key, link_key || null, parseFloat(amount), label, ts);

  const commissionId = r.lastInsertRowid;
  let orgr_synced = false;
  let orgr_income_id = null;

  // Bridge to OrgΩr TreasΩr (fire and don't block the response)
  const orgrUrl  = process.env.ORGR_URL;
  const orgrOrgId = process.env.ORGR_DEFAULT_ORG_ID;
  const orgrToken = process.env.ORGR_INTERNAL_TOKEN;

  if (orgrUrl && orgrOrgId) {
    try {
      const orgrRes = await fetch(`${orgrUrl}/api/treasor/income/${orgrOrgId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(orgrToken ? { 'x-internal-token': orgrToken } : {})
        },
        body: JSON.stringify({
          amount: parseFloat(amount),
          source: `affiliate:${partner_key}`,
          description: label,
          received_at: ts
        })
      });
      if (orgrRes.ok) {
        const orgrData = await orgrRes.json();
        orgr_income_id = orgrData.id || null;
        orgr_synced = true;
        db.prepare('UPDATE affiliate_commissions SET orgr_synced=1, orgr_income_id=? WHERE id=?')
          .run(orgr_income_id, commissionId);
      }
    } catch (_) {}
  }

  res.json({ id: commissionId, orgr_synced, orgr_income_id });
});

// ── Link URL builder ──────────────────────────────────────────────────────────

router.get('/tracked-url', (req, res) => {
  const { partner_key, link_key, vid } = req.query;
  if (!partner_key || !link_key) return res.status(400).json({ error: 'partner_key and link_key required' });
  const base = req.protocol + '://' + req.get('host');
  const url  = `${base}/r/${partner_key}/${link_key}${vid ? '?vid=' + vid : ''}`;
  res.json({ url });
});

module.exports = router;
