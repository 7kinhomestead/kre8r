/**
 * PostΩr — TikTok Platform Module (Stub)
 *
 * TikTok Content Posting API requires:
 *   1. Developer account + app created at developers.tiktok.com
 *   2. "Content Posting API" product added to your app
 *   3. App review and approval (4-6 weeks)
 *   4. UX compliance UI (creator info, privacy controls, commercial disclosure)
 *      before submission is accepted
 *
 * Coming Soon. This stub returns the reason so the UI can display it clearly.
 */

'use strict';

module.exports = {
  isAvailable: () => false,
  COMING_SOON_REASON: [
    "TikTok's Content Posting API requires a 4-6 week approval process.",
    'Your app must also build TikTok-mandated UX elements (creator info display,',
    'privacy dropdown, commercial use disclosure) before submission.',
    'This integration is on the roadmap and will be available once approved.',
  ].join(' '),
};
