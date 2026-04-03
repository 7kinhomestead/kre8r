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

const KAJABI_BASE = 'https://app.kajabi.com/admin';

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
// Multi-step wizard flow matching Kajabi's actual UI progression.
// Each step is individually wrapped so failures identify exactly where things broke.

async function sendBroadcast(page, { subject, body, segment, scheduleAt, dryRun = true }) {

  // ── Step 1: Navigate to Email Campaigns list ──────────────────────────────
  try {
    await nav(page, `${KAJABI_BASE}/email_campaigns`);
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step1-nav');
    return { ok: false, error: `Step 1 (navigate to email campaigns): ${e.message}`, screenshot };
  }

  // ── Step 2: Click New / Create / Broadcast button ─────────────────────────
  try {
    const newBtnSel = [
      'a:has-text("New Broadcast")',
      'a:has-text("New Email")',
      'button:has-text("New Broadcast")',
      'button:has-text("New Email")',
      'a:has-text("Create Broadcast")',
      'a:has-text("Create")',
      'button:has-text("Create")',
      'a:has-text("New")',
      'button:has-text("New")',
    ].join(', ');
    await page.waitForSelector(newBtnSel, { timeout: 10000 });
    await page.click(newBtnSel);
    await page.waitForLoadState('networkidle');
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step2-new-btn');
    return { ok: false, error: `Step 2 (click New/Create button): ${e.message}`, screenshot };
  }

  // ── Step 3: If type chooser appears, select Broadcast (not Sequence) ───────
  try {
    const typeChooserSel = [
      'button:has-text("Broadcast")',
      'a:has-text("Broadcast")',
      '[data-testid*="broadcast"]',
      'label:has-text("Broadcast")',
    ].join(', ');
    const typeEl = await page.$(typeChooserSel);
    if (typeEl) {
      await typeEl.click();
      await page.waitForLoadState('networkidle');
    }
    // If no type chooser appears, we're already on the broadcast form — continue
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step3-type-chooser');
    return { ok: false, error: `Step 3 (select Broadcast type): ${e.message}`, screenshot };
  }

  // ── Step 4: Fill broadcast name (using subject as the name) ──────────────
  try {
    const nameSel = [
      'input[name="email_campaign[name]"]',
      'input[placeholder*="name" i]',
      'input[placeholder*="broadcast name" i]',
      'input[id*="name"]',
    ].join(', ');
    await page.waitForSelector(nameSel, { timeout: 10000 });
    await page.fill(nameSel, subject);
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step4-name');
    return { ok: false, error: `Step 4 (fill broadcast name): ${e.message}`, screenshot };
  }

  // ── Step 5: Click Next / Continue to move past naming step ───────────────
  try {
    const nextSel = [
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'a:has-text("Next")',
      'a:has-text("Continue")',
      'button[type="submit"]:has-text("Next")',
      'button[type="submit"]:has-text("Continue")',
    ].join(', ');
    const nextEl = await page.$(nextSel);
    if (nextEl) {
      await nextEl.click();
      await page.waitForLoadState('networkidle');
    }
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step5-next-after-name');
    return { ok: false, error: `Step 5 (Next after name): ${e.message}`, screenshot };
  }

  // ── Step 6: Recipient / segment selection ────────────────────────────────
  try {
    if (segment) {
      const segSel = [
        `label:has-text("${segment}")`,
        `[data-testid*="segment"]`,
        `input[value="${segment}"]`,
        'select[name*="segment"]',
        'select[name*="recipient"]',
      ].join(', ');
      const segEl = await page.$(segSel);
      if (segEl) {
        const tagName = await segEl.evaluate(el => el.tagName.toLowerCase());
        if (tagName === 'select') {
          await segEl.selectOption({ label: segment });
        } else {
          await segEl.click();
        }
      }
      // No segment match — Kajabi will default to all members, continue
    }

    // Click Next / Continue past recipients step if the button exists
    const nextSel = [
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'a:has-text("Next")',
      'a:has-text("Continue")',
    ].join(', ');
    const nextEl = await page.$(nextSel);
    if (nextEl) {
      await nextEl.click();
      await page.waitForLoadState('networkidle');
    }
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step6-recipients');
    return { ok: false, error: `Step 6 (recipient/segment selection): ${e.message}`, screenshot };
  }

  // ── Step 7: Fill subject line in the email composer ──────────────────────
  try {
    const subjectSel = [
      'input[name="email_campaign[subject]"]',
      'input[placeholder*="subject" i]',
      'input[id*="subject"]',
      'input[name*="subject"]',
    ].join(', ');
    await page.waitForSelector(subjectSel, { timeout: 10000 });
    await page.fill(subjectSel, subject);
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step7-subject');
    return { ok: false, error: `Step 7 (fill subject line): ${e.message}`, screenshot };
  }

  // ── Step 8: Fill email body in the rich text editor ───────────────────────
  try {
    const bodySel = [
      '.ql-editor',
      '[contenteditable="true"]',
      'textarea[name*="body"]',
      'textarea[name*="content"]',
    ].join(', ');
    await page.waitForSelector(bodySel, { timeout: 10000 });
    await fillRichText(page, bodySel, body);
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step8-body');
    return { ok: false, error: `Step 8 (fill email body): ${e.message}`, screenshot };
  }

  // ── Dry run: screenshot the filled form and stop ──────────────────────────
  if (dryRun) {
    try {
      const screenshotPath = path.join(os.tmpdir(), 'playwright-broadcast-preview.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return { ok: true, dryRun: true, screenshot: screenshotPath };
    } catch (e) {
      return { ok: true, dryRun: true, screenshot: null, warning: `Screenshot failed: ${e.message}` };
    }
  }

  // ── Step 9: Send or Schedule ──────────────────────────────────────────────
  try {
    if (scheduleAt) {
      const scheduleBtnSel = [
        'button:has-text("Schedule")',
        '[data-testid*="schedule"]',
        'a:has-text("Schedule")',
      ].join(', ');
      const scheduleBtn = await page.$(scheduleBtnSel);
      if (scheduleBtn) {
        await scheduleBtn.click();
        await page.waitForLoadState('networkidle');
        const dateSel = 'input[type="datetime-local"], input[type="date"]';
        const dateEl  = await page.$(dateSel);
        if (dateEl) await dateEl.fill(scheduleAt);
      }
    }

    const sendSel = [
      'button[type="submit"]:has-text("Send")',
      'button:has-text("Send Now")',
      'button:has-text("Send Broadcast")',
      'button:has-text("Schedule")',
      'button:has-text("Send")',
    ].join(', ');
    await page.waitForSelector(sendSel, { timeout: 8000 });
    await page.click(sendSel);
    await page.waitForLoadState('networkidle');

    const broadcastId = (page.url().match(/\/(\d+)/) || [])[1] || null;
    return { ok: true, dryRun: false, broadcastId, sentAt: new Date().toISOString() };
  } catch (e) {
    const screenshot = await screenshotOnFail(page, 'broadcast-step9-send');
    return { ok: false, error: `Step 9 (send/schedule): ${e.message}`, screenshot };
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
