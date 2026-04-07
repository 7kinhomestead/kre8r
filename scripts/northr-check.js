/**
 * NorthΩr Daily Check — scripts/northr-check.js
 *
 * Runs at 9am daily via PM2 cron (see ecosystem.config.js).
 * Evaluates all creator health thresholds and writes any new
 * alerts to the database. Alert badges appear in the nav on
 * next page load.
 *
 * Manual run: node scripts/northr-check.js
 */

require('dotenv').config({ override: true });

// Electron path bootstrap (same as server.js)
if (process.env.ELECTRON === 'true') {
  const _os   = require('os');
  const _path = require('path');
  const _home = _path.join(_os.homedir(), '.kre8r');
  if (!process.env.DB_PATH)             process.env.DB_PATH             = _path.join(_home, 'kre8r.db');
  if (!process.env.CREATOR_PROFILE_PATH) process.env.CREATOR_PROFILE_PATH = _path.join(_home, 'creator-profile.json');
}

const { initDb } = require('../src/db');
const { checkAllThresholds } = require('../src/utils/strategy-engine');

async function main() {
  try {
    initDb();
    const alerts = await checkAllThresholds();
    console.log(`[NorthΩr] Daily check complete — ${alerts.length} new alert${alerts.length !== 1 ? 's' : ''}.`);
    if (alerts.length) {
      alerts.forEach(a => console.log(`  [${a.severity}] ${a.title}`));
    }
    process.exit(0);
  } catch (err) {
    console.error('[NorthΩr] Check failed:', err.message);
    process.exit(1);
  }
}

main();
