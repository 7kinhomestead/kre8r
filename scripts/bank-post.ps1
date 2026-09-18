# THE BANK POSTER — Farmy's daily TT-BANK shift.
#
# Two scheduled tasks call this file:
#   RockRich Bank Post FB   12:00 PT daily   -Platform fb
#   RockRich Bank Post IG   15:00 PT daily   -Platform ig
#
# Both are the slots law 7 sets: FB natives 12:00 PT, the same file to IG at
# 15:00 PT. The runner finds today's clip by Pacific date, so a task that fires
# on a day with nothing scheduled exits in about a second having done nothing.
#
# TWO LOGS, AND THEY MUST STAY TWO. bank-post.js opens bank-post.log with pino
# itself. A PowerShell `*>>` redirect holds an EXCLUSIVE handle on its target for
# the whole run — point this wrapper at bank-post.log and node cannot open its
# own logger, which kills the run before it posts anything. (That is exactly how
# the Call Clerk died the first time; see clerk.ps1.) So:
#   bank-post.log         the runner's own structured record  <- the real log
#   bank-post-shift.log   this wrapper's transcript of the run
#
# ON BATTERY: Farmy is a desktop on an off-grid battery bank. Both tasks are
# registered with DisallowStartIfOnBatteries = FALSE and StopIfGoingOnBatteries
# = FALSE. If those ever revert to the Windows default, the noon slot silently
# stops firing on every cloudy day — which is the same failure mode as Rella's
# dark posts, arriving by a different road.

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('fb', 'ig')]
    [string]$Platform,

    [string]$Date,          # YYYY-MM-DD, Pacific. Omit for today.
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
# node writes UTF-8. Without this, PowerShell decodes its output as ANSI and
# every em-dash in the shift log arrives as mojibake.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo  = 'C:\Users\18054\kre8r'
$shift = 'H:\edit-staging\TT-BANK\logs\bank-post-shift.log'

New-Item -ItemType Directory -Force -Path 'H:\edit-staging\TT-BANK\logs' | Out-Null
function L($m) { "$(Get-Date -Format o)  [bank-post.ps1 $Platform] $m" | Out-File $shift -Append -Encoding utf8 }

# SINGLE-INSTANCE GUARD (same pattern as clerk.ps1 / evening-shift.ps1), per
# platform. bank-post.js holds its own cross-process lock file as well — this is
# the cheap outer gate so a duplicate trigger never even starts node. Match the
# script invocation AND the platform, so the FB and IG shifts never block each
# other if a run ever overlaps.
$twins = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'bank-post\.ps1' -and $_.CommandLine -match "-Platform\s+$Platform" }
if ($twins) {
    # ASCII only inside strings in this file. It has no BOM (repo convention), so
    # Windows PowerShell 5.1 reads it as ANSI: a UTF-8 em-dash lands as bytes that
    # include a closing quote in CP1252 and the whole script fails to parse.
    # Non-ASCII in a comment is only cosmetic; in a string it is fatal.
    L "ALREADY RUNNING (pids: $($twins.ProcessId -join ', ')) - exiting"
    exit 0
}

L 'SHIFT START'

$argv = @("$repo\scripts\bank-post.js", '--platform', $Platform)
if ($Date)   { $argv += @('--date', $Date) }
if ($DryRun) { $argv += '--dry-run' }

# node's stdout/stderr goes to the SHIFT log only. Its structured record is
# written by pino straight into bank-post.log — do not redirect there.
& node $argv 2>&1 | Out-File $shift -Append -Encoding utf8
$code = $LASTEXITCODE

L "bank-post.js exit $code"
L 'SHIFT COMPLETE'
exit $code
