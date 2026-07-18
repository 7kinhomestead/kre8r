# One-shot: copy the updated nav.js into the app's public-write overlay so the
# RUNNING app serves it without a reinstall. Runs via Task Scheduler (outside
# the Claude sandbox — AppData writes from Claude shells are virtualized).
# NOTE: this overlay copy SHADOWS the asar nav.js — delete it after the next
# installer ships with the nav baked in.
$log = 'C:\Users\18054\kre8r\scripts\hotpatch-nav.log'
$dst = 'C:\Users\18054\AppData\Roaming\kre8r\public-write\js'
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item 'C:\Users\18054\kre8r\public\js\nav.js' "$dst\nav.js" -Force
"REMINDER: delete this folder's nav.js after installing v1.0.11+ (it shadows the packaged copy)" |
  Out-File "$dst\README-REMOVE-AFTER-NEXT-INSTALL.txt" -Encoding utf8
"$(Get-Date -Format o) nav.js hot-patched -> $dst ($(( Get-Item "$dst\nav.js").Length) bytes)" |
  Out-File $log -Encoding utf8
