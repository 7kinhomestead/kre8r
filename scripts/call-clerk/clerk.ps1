# THE CALL CLERK — Farmy's shift on the Rock Rich round table.
#
# Fires daily at 15:50 Pacific. Six days out of seven it finds nothing on the books
# and exits within a second; on Thursday it walks into the room at 15:58, records
# until everybody leaves, then puts ears on it and writes the notes.
#
# Two stages, deliberately in one wrapper: the recording is worthless to Jason until
# somebody has read it, and the reading must never start before the file is closed.
#
# TWO LOGS, and they must stay two. The node scripts write pino lines into
# call-clerk.log themselves. This wrapper takes their console output into a SEPARATE
# file, because a PowerShell `*>>` redirect holds an exclusive handle for the whole
# run — point it at call-clerk.log and node cannot open its own logger, which kills
# the clerk before it reaches the room. (It did exactly that the first time.)
#   call-clerk.log        the clerk's own structured record
#   call-clerk-shift.log  this wrapper's transcript of the run

$env:PYTHONIOENCODING = 'utf-8'
$repo  = 'C:\Users\18054\kre8r'
$shift = 'H:\edit-staging\CALLS\call-clerk-shift.log'

# SINGLE-INSTANCE GUARD (same pattern as evening-shift.ps1): a second clerk would
# fight the first one for OBS and for the GPU, and the loser corrupts a recording
# that can never be re-shot. Match the SCRIPT invocation only, so somebody tailing
# the log does not trip it.
$twins = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'clerk\.ps1' }
if ($twins) { exit }

function L($m) { "$(Get-Date -Format o)  [clerk.ps1] $m" | Out-File $shift -Append -Encoding utf8 }

New-Item -ItemType Directory -Force -Path 'H:\edit-staging\CALLS\clips' | Out-Null
L 'SHIFT START'

# 1) Sit in the room. Exits 0 immediately when there is no call inside 20 minutes,
#    which is what makes this safe to run every single day.
node "$repo\scripts\call-clerk\join-and-record.js" 2>&1 | Out-File $shift -Append -Encoding utf8
$rec = $LASTEXITCODE
L "join-and-record exit $rec"

# 2) Listen and write it up — only if there is actually a recording to work on.
#    post-call.js picks the newest sidecar that has no notes yet, so a run that
#    recorded nothing finds nothing and exits 0 too.
if ($rec -eq 0) {
    node "$repo\scripts\call-clerk\post-call.js" 2>&1 | Out-File $shift -Append -Encoding utf8
    L "post-call exit $LASTEXITCODE"
} else {
    L 'recording failed - skipping post-call so the failure stays visible'
}

L 'SHIFT COMPLETE'
