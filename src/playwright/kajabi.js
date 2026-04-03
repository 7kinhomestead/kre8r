/**
 * Kre8Ωr — src/playwright/kajabi.js
 *
 * All Kajabi browser automation actions.
 * Receives a `page` object from Playwright connected via CDP.
 *
 * Every action:
 *   - Waits for networkidle after navigation
 *   - Uses page.fill() not page.type()
 *   - Takes a screenshot to /tmp on failure
 *   - Returns { ok: true, ... } or { ok: false, error, screenshot }
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const creatorProfile = require(path.join(__dirname, '../../creator-profile.json'));
const KAJABI_SITE_ID = (creatorProfile.kajabi || {}).site_id || '';
const KAJABI_BASE    = 'https://app.kajabi.com/admin';
const KAJABI_SITE    = `${KAJABI_BASE}/sites/${KAJABI_SITE_ID}`;

// ─── Utility ────────────────────────────────────────────────────────────────

async function screenshotOnFail(page, label) {
  try {
    const ts   = Date.now();
    const file = path.join(os.tmpdir(), `playwright-debug-${label}-${ts}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch (_) {
    return null;
  }
}

async function nav(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
}

async function fillRichText(page, selector, content) {
  // Kajabi uses a contenteditable div for rich text — try evaluate first, fall back to fill
  try {
    await page.waitForSelector(selector, { timeout: 8000 });
    await page.evaluate((sel, text) => {
      const el = document.querySelector(sel);
      if (el) { el.innerHTML = ''; el.textContent = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }, selector, content);
  } catch (_) {
    await page.fill(selector, content);
  }
}

// ─── sendBroadcast ───────────────────────────────────────────────────────────
// Follows the exact Kajabi wizard flow Jason documented.
// Each step individually try/caught with labelled screenshot on failure.

async function sendBroadcast(page, { subject, body, segment, scheduleAt, dryRun = true }) {

  // ── Step 1: Navigate to Email Campaigns list ──────────────────────────────
  try {
    await nav(page, `${KAJABI_SITE}/email_campaigns`);
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step1-nav');
    return { ok: false, error: `Step 1 (navigate to email campaigns): ${e.message}`, screenshot };
  }

  // ── Step 2: Click '+New Email Campaign' button ────────────────────────────
  try {
    // Give React time to fully render after navigation
    await page.waitForTimeout(2000);

    let clicked = false;

    // Try 1: data attribute selector via JS click (bypasses visibility requirements)
    try {
      const found = await page.evaluate(() => {
        const el = document.querySelector('[data-create-save-as-template]');
        if (el) { el.click(); return true; }
        return false;
      });
      if (found) clicked = true;
    } catch (_) {}

    // Try 2: Playwright locator by text (handles React-rendered text nodes)
    if (!clicked) {
      try {
        const loc = page.getByText('+New Email Campaign', { exact: false }).first();
        await loc.click({ timeout: 6000 });
        clicked = true;
      } catch (_) {}
    }

    // Try 3: getByText without the plus sign
    if (!clicked) {
      try {
        const loc = page.getByText('New Email Campaign', { exact: false }).first();
        await loc.click({ timeout: 6000 });
        clicked = true;
      } catch (_) {}
    }

    // Try 4: waitForSelector with CSS — last resort
    if (!clicked) {
      const newBtnSel = [
        'a:has-text("+New Email Campaign")',
        'button:has-text("+New Email Campaign")',
        'a:has-text("New Email Campaign")',
        'button:has-text("New Email Campaign")',
      ].join(', ');
      await page.waitForSelector(newBtnSel, { timeout: 8000 });
      await page.click(newBtnSel);
      clicked = true;
    }

    if (!clicked) throw new Error('Could not find +New Email Campaign button after all attempts');
    await page.waitForLoadState('networkidle');
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step2-new-campaign-btn');
    return { ok: false, error: `Step 2 (click +New Email Campaign): ${e.message}`, screenshot };
  }

  // ── Step 3: Click 'Email Broadcast' (not Email Sequence) ─────────────────
  try {
    await page.evaluate(() => {
      const el = document.querySelector('[data-js-tabs-target="email-campaign-selection-option-broadcast"]');
      if (!el) throw new Error('Email Broadcast tab not found');
      el.click();
    });
    await page.waitForTimeout(1500);
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step3-select-broadcast-type');
    return { ok: false, error: `Step 3 (click Email Broadcast type): ${e.message}`, screenshot };
  }

  // ── Step 4: Wait for Continue to be ENABLED, then click ──────────────────
  try {
    // Wait 2000ms for React to enable the button after type selection
    await page.waitForTimeout(2000);

    // Wait for Continue that is NOT disabled
    const enabledContinueSel = 'button:has-text("Continue"):not([disabled]), a:has-text("Continue"):not([disabled])';
    await page.waitForSelector(enabledContinueSel, { timeout: 8000 });
    await page.click(enabledContinueSel);
    await page.waitForLoadState('networkidle');
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step4-continue-after-type');
    return { ok: false, error: `Step 4 (Continue after type selection): ${e.message}`, screenshot };
  }

  // ── Step 5: Click 'Use Classic Editor' (skip template selection) ──────────
  try {
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button, a'));
      const el = els.find(e => e.textContent.trim().includes('Classic Editor'));
      if (!el) throw new Error('Classic Editor button not found');
      el.click();
    });
    await page.waitForTimeout(2000);
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step5-classic-editor');
    return { ok: false, error: `Step 5 (click Use Classic Editor): ${e.message}`, screenshot };
  }

  // ── Step 6: Fill broadcast title with subject, then click 'Continue' ──────
  try {
    await page.waitForSelector('#email_broadcast_title', { timeout: 10000 });
    const broadcastTitle = `${new Date().toISOString().slice(0,10)} - ${subject} - ${segment || 'All Members'}`;
    await page.fill('#email_broadcast_title', broadcastTitle);
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button, input[type="submit"]'));
      const el = els.find(e =>
        e.textContent.trim().includes('Continue') ||
        e.textContent.trim().includes('Create') ||
        e.value === 'Create' ||
        e.value === 'Continue' ||
        e.getAttribute('data-disable-with') === 'Create'
      );
      if (!el) throw new Error('Continue button not found');
      el.click();
    });
    await page.waitForTimeout(3000);
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step6-title-continue');
    return { ok: false, error: `Step 6 (fill title + Continue): ${e.message}`, screenshot };
  }

  // ── Step 7: Segment/recipient selection, then 'Save and Continue' ─────────
  try {
    // Leave segment as default (All Members) — don't try to select
    // The default Kajabi segment is already All Members
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      const pdsBtns = Array.from(document.querySelectorAll('pds-button, button, input[type="submit"]'));
      const btn = pdsBtns.find(b =>
        b.textContent.trim().includes('Save') ||
        b.textContent.trim().includes('Continue') ||
        b.value === 'Save and Continue'
      );
      if (btn) btn.click();
      else throw new Error('Save and Continue not found');
    });
    await page.waitForTimeout(3000);
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step7-segment-save');
    return { ok: false, error: `Step 7 (segment selection + Save and Continue): ${e.message}`, screenshot };
  }

  // ── Step 8: Fill subject line and body in the editor, then 'Save and Continue'
  try {
    // Subject line input
    const subjectSel = 'input[name="email_broadcast[subject]"], #email_broadcast_subject';
    await page.waitForSelector(subjectSel, { timeout: 10000 });
    await page.fill(subjectSel, subject);

    // Email body via TinyMCE API (TinyMCE replaces the textarea with an iframe editor)
    await page.waitForTimeout(3000); // wait for TinyMCE to initialize
    await page.evaluate((bodyText) => {
      // Try TinyMCE API first
      if (window.tinymce && window.tinymce.activeEditor) {
        window.tinymce.activeEditor.setContent(bodyText);
        return;
      }
      // Try by editor id
      if (window.tinymce && window.tinymce.get('email_broadcast_body')) {
        window.tinymce.get('email_broadcast_body').setContent(bodyText);
        return;
      }
      throw new Error('TinyMCE editor not found');
    }, body);

    const saveContSel = [
      'button:has-text("Save and Continue")',
      'a:has-text("Save and Continue")',
    ].join(', ');
    await page.waitForSelector(saveContSel, { timeout: 8000 });
    await page.click(saveContSel);
    await page.waitForLoadState('networkidle');
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step8-editor-save');
    return { ok: false, error: `Step 8 (fill subject + body + Save and Continue): ${e.message}`, screenshot };
  }

  // ── Dry run: on the preview page, screenshot and stop ────────────────────
  if (dryRun) {
    try {
      const screenshotPath = path.join(os.tmpdir(), 'playwright-broadcast-preview.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return { ok: true, dryRun: true, screenshot: screenshotPath };
    } catch (e) {
      return { ok: true, dryRun: true, screenshot: null, warning: `Screenshot failed: ${e.message}` };
    }
  }

  // ── Step 9 (real send): 'Save and Continue' on preview, then send/schedule
  try {
    // Advance past preview page
    const previewContSel = [
      'button:has-text("Save and Continue")',
      'a:has-text("Save and Continue")',
      'button:has-text("Continue")',
    ].join(', ');
    await page.waitForSelector(previewContSel, { timeout: 8000 });
    await page.click(previewContSel);
    await page.waitForLoadState('networkidle');

    // Send Right Now vs Schedule for Later
    if (scheduleAt) {
      const scheduleSel = [
        'button:has-text("Schedule for Later")',
        'a:has-text("Schedule for Later")',
        'label:has-text("Schedule for Later")',
      ].join(', ');
      await page.waitForSelector(scheduleSel, { timeout: 8000 });
      await page.click(scheduleSel);
      await page.waitForLoadState('networkidle');

      // Fill schedule date/time if a picker appears
      const dateSel = 'input[type="datetime-local"], input[type="date"]';
      const dateEl  = await page.$(dateSel);
      if (dateEl) await dateEl.fill(scheduleAt);
    } else {
      const sendNowSel = [
        'button:has-text("Send Right Now")',
        'a:has-text("Send Right Now")',
        'label:has-text("Send Right Now")',
      ].join(', ');
      await page.waitForSelector(sendNowSel, { timeout: 8000 });
      await page.click(sendNowSel);
      await page.waitForLoadState('networkidle');
    }

    // Final confirm button
    const confirmSel = [
      'button:has-text("Send")',
      'button:has-text("Confirm")',
      'button:has-text("Send Broadcast")',
      'button[type="submit"]',
    ].join(', ');
    await page.waitForSelector(confirmSel, { timeout: 8000 });
    await page.click(confirmSel);
    await page.waitForLoadState('networkidle');

    const broadcastId = (page.url().match(/\/(\d+)/) || [])[1] || null;
    return { ok: true, dryRun: false, broadcastId, sentAt: new Date().toISOString() };
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step9-send-confirm');
    return { ok: false, error: `Step 9 (preview → send/schedule → confirm): ${e.message}`, screenshot };
  }
}

// ─── postToCommunity ─────────────────────────────────────────────────────────

async function postToCommunity(page, { body, topic }) {
  try {
    await nav(page, `${KAJABI_BASE}/community/posts/new`);

    // Body — Kajabi community uses rich text too
    const bodySel = '.ql-editor, [contenteditable="true"], textarea[name*="body"], textarea[name*="content"]';
    await page.waitForSelector(bodySel, { timeout: 10000 });
    await fillRichText(page, bodySel, body);

    // Topic selector if provided
    if (topic) {
      try {
        const topicSel = 'select[name*="topic"], [data-testid*="topic"]';
        await page.waitForSelector(topicSel, { timeout: 5000 });
        await page.selectOption(topicSel, { label: topic });
      } catch (_) {}
    }

    // Publish
    const publishSel = 'button[type="submit"]:has-text("Publish"), button:has-text("Post"), button:has-text("Publish Post")';
    await page.waitForSelector(publishSel, { timeout: 8000 });
    await page.click(publishSel);
    await page.waitForLoadState('networkidle');

    const postUrl = page.url();
    return { ok: true, postUrl };
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'community');
    return { ok: false, error: e.message, screenshot };
  }
}

// ─── createSequence ──────────────────────────────────────────────────────────

async function createSequence(page, { name, emails }) {
  try {
    await nav(page, `${KAJABI_BASE}/marketing/email_sequences/new`);

    // Sequence name
    const nameSel = 'input[name*="name"], input[name*="title"], input[placeholder*="name" i]';
    await page.waitForSelector(nameSel, { timeout: 10000 });
    await page.fill(nameSel, name);

    // Save to get sequence created before adding emails
    const saveSel = 'button[type="submit"]:has-text("Save"), button[type="submit"]:has-text("Create"), button:has-text("Save Sequence")';
    await page.waitForSelector(saveSel, { timeout: 8000 });
    await page.click(saveSel);
    await page.waitForLoadState('networkidle');

    // Grab sequence ID from URL
    const url        = page.url();
    const match      = url.match(/\/(\d+)/);
    const sequenceId = match ? match[1] : null;

    // Add each email
    for (let i = 0; i < (emails || []).length; i++) {
      const email = emails[i];
      try {
        const addEmailSel = 'button:has-text("Add Email"), button:has-text("New Email"), a:has-text("Add Email")';
        await page.waitForSelector(addEmailSel, { timeout: 8000 });
        await page.click(addEmailSel);
        await page.waitForLoadState('networkidle');

        // Subject
        const subSel = 'input[name*="subject"], input[placeholder*="subject" i]';
        await page.waitForSelector(subSel, { timeout: 8000 });
        await page.fill(subSel, email.subject);

        // Body
        const bodySel = '.ql-editor, [contenteditable="true"], textarea[name*="body"]';
        await page.waitForSelector(bodySel, { timeout: 8000 });
        await fillRichText(page, bodySel, email.body);

        // Delay days
        if (email.delayDays !== undefined) {
          try {
            const delaySel = 'input[name*="delay"], input[name*="days"]';
            const delayEl  = await page.$(delaySel);
            if (delayEl) await delayEl.fill(String(email.delayDays));
          } catch (_) {}
        }

        // Save email
        const emailSaveSel = 'button[type="submit"]:has-text("Save"), button:has-text("Save Email")';
        await page.waitForSelector(emailSaveSel, { timeout: 8000 });
        await page.click(emailSaveSel);
        await page.waitForLoadState('networkidle');
      } catch (emailErr) {
        console.error(`[playwright/sequence] email ${i} failed:`, emailErr.message);
      }
    }

    return { ok: true, sequenceId };
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'sequence');
    return { ok: false, error: e.message, screenshot };
  }
}

// ─── createAutomation ────────────────────────────────────────────────────────

async function createAutomation(page, { name, trigger, action }) {
  try {
    await nav(page, `${KAJABI_BASE}/automations/new`);

    // Name
    const nameSel = 'input[name*="name"], input[name*="title"], input[placeholder*="name" i]';
    await page.waitForSelector(nameSel, { timeout: 10000 });
    await page.fill(nameSel, name);

    // Trigger
    if (trigger?.type === 'tag_added') {
      try {
        const triggerSel = 'select[name*="trigger"], [data-testid*="trigger"]';
        await page.waitForSelector(triggerSel, { timeout: 5000 });
        await page.selectOption(triggerSel, { label: 'Tag Added' });

        if (trigger.tag) {
          const tagSel = 'select[name*="tag"], input[name*="tag"]';
          const tagEl  = await page.$(tagSel);
          if (tagEl) {
            const tagName = await tagEl.evaluate(el => el.tagName);
            if (tagName === 'SELECT') await tagEl.selectOption({ label: trigger.tag });
            else await tagEl.fill(trigger.tag);
          }
        }
      } catch (_) {}
    }

    // Action
    if (action?.type === 'enroll_sequence' && action.sequenceId) {
      try {
        const actionSel = 'select[name*="action"], [data-testid*="action"]';
        await page.waitForSelector(actionSel, { timeout: 5000 });
        await page.selectOption(actionSel, { label: 'Enroll in Sequence' });

        const seqSel = 'select[name*="sequence"], input[name*="sequence"]';
        const seqEl  = await page.$(seqSel);
        if (seqEl) await seqEl.selectOption({ value: String(action.sequenceId) });
      } catch (_) {}
    }

    // Save
    const saveSel = 'button[type="submit"]:has-text("Save"), button:has-text("Create Automation"), button:has-text("Save Automation")';
    await page.waitForSelector(saveSel, { timeout: 8000 });
    await page.click(saveSel);
    await page.waitForLoadState('networkidle');

    const url          = page.url();
    const match        = url.match(/\/(\d+)/);
    const automationId = match ? match[1] : null;

    return { ok: true, automationId };
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'automation');
    return { ok: false, error: e.message, screenshot };
  }
}

// ─── updateLandingPage ───────────────────────────────────────────────────────

async function updateLandingPage(page, { pageId, headline, subheadline, bodyText }) {
  try {
    await nav(page, `${KAJABI_BASE}/website/landing_pages/${pageId}/edit`);

    // Headline
    if (headline) {
      const hSel = '[data-field="headline"], input[name*="headline"], [contenteditable]:first-of-type';
      try {
        await page.waitForSelector(hSel, { timeout: 8000 });
        await fillRichText(page, hSel, headline);
      } catch (_) {}
    }

    // Subheadline
    if (subheadline) {
      const shSel = '[data-field="subheadline"], input[name*="subheadline"]';
      try {
        await page.waitForSelector(shSel, { timeout: 5000 });
        await fillRichText(page, shSel, subheadline);
      } catch (_) {}
    }

    // Body text
    if (bodyText) {
      const bSel = '.ql-editor, [data-field="body"], textarea[name*="body"]';
      try {
        await page.waitForSelector(bSel, { timeout: 5000 });
        await fillRichText(page, bSel, bodyText);
      } catch (_) {}
    }

    // Save
    const saveSel = 'button[type="submit"]:has-text("Save"), button:has-text("Publish"), button:has-text("Update")';
    await page.waitForSelector(saveSel, { timeout: 8000 });
    await page.click(saveSel);
    await page.waitForLoadState('networkidle');

    return { ok: true };
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'landing-page');
    return { ok: false, error: e.message, screenshot };
  }
}

module.exports = { sendBroadcast, postToCommunity, createSequence, createAutomation, updateLandingPage };
