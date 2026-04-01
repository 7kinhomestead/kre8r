# Dev Notes

## Database

Kre8Ωr uses sql.js (SQLite in memory, persisted to disk via persist()).
NEVER modify the DB with direct sqlite3 CLI commands or node -e scripts.
All DB writes MUST go through the live PM2 server's API endpoints.
Direct writes go to an isolated in-memory copy and are lost on next server read.
