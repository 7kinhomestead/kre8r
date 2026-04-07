/**
 * Kre8Ωr — PM2 Ecosystem Config
 *
 * Start all:    pm2 start ecosystem.config.js
 * Deploy:       pm2 restart kre8r
 * Logs:         pm2 logs kre8r
 * Backup now:   pm2 trigger kre8r-backup restart
 */

module.exports = {
  apps: [
    // ─── Main server ─────────────────────────────────────────
    {
      name:         'kre8r',
      script:       'server.js',
      cwd:          __dirname,
      instances:    1,
      autorestart:  true,
      watch:        false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT:     3000
      },
      // Structured log output
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file:  'logs/error.log',
      out_file:    'logs/out.log',
      merge_logs:  true
    },

    // ─── Daily DB backup at 3am ───────────────────────────────
    {
      name:          'kre8r-backup',
      script:        'scripts/backup.js',
      cwd:           __dirname,
      cron_restart:  '0 3 * * *',   // 3:00am daily
      autorestart:   false,
      watch:         false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file:    'logs/backup-error.log',
      out_file:      'logs/backup-out.log',
      merge_logs:    true
    },

    // ─── NorthΩr daily alert check at 9am ────────────────────
    {
      name:          'northr-daily',
      script:        'scripts/northr-check.js',
      cwd:           __dirname,
      cron_restart:  '0 9 * * *',   // 9:00am daily
      autorestart:   false,
      watch:         false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file:    'logs/northr-error.log',
      out_file:      'logs/northr-out.log',
      merge_logs:    true
    }
  ]
};
