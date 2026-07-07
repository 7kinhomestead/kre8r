# ===========================================================================
#  OFFLOAD - one-click card ingest for the 7 Kin media library
#  Built by Fable, July 2026.
#
#  What it does, every time, the same way:
#   1. Finds the memory card (or asks which drive)
#   2. Figures out WHAT it is by its folder signature (drone / Osmo / security
#      cam / Blackmagic / generic)
#   3. Copies everything to D:\media-library\YYYY\YYYY-MM-DD__source\
#   4. VERIFIES every file and byte landed
#   5. Logs every file to D:\media-library\_catalog.csv  (the "where is that
#      clip?" answer - one searchable file, forever)
#   6. Tells you plainly: SAFE TO FORMAT or DO NOT FORMAT
#
#  It NEVER deletes anything. Formatting stays a human decision, in-device.
#  To AI-tag a shoot in Vault?r afterward: copy that folder into D:\kre8r\intake
# ===========================================================================
param([string]$Drive = "", [switch]$DryRun)

$Library = "D:\media-library"
$Catalog = Join-Path $Library "_catalog.csv"
New-Item -ItemType Directory -Force $Library | Out-Null

function Classify($root) {
  if (Test-Path (Join-Path $root "Mp4Record"))            { return "security-cam" }
  if (Test-Path (Join-Path $root "HBSMEDIA"))             { return "drone-holystone" }
  if (Test-Path (Join-Path $root "DCIM\DJI_001"))         { return "drone-dji" }
  if ((Test-Path (Join-Path $root "DCIM")) -and (Get-ChildItem (Join-Path $root "DCIM") -Directory -ErrorAction SilentlyContinue | Where-Object Name -match "OSMO|DJI")) { return "osmo" }
  if (Get-ChildItem $root -Recurse -Filter *.braw -ErrorAction SilentlyContinue | Select-Object -First 1) { return "blackmagic" }
  if (Test-Path (Join-Path $root "DCIM"))                 { return "camera" }
  return "card"
}

# ?? 1. Find the card ????????????????????????????????????????????????????????
if (-not $Drive) {
  $candidates = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 -and $_.Size -gt 0 }
  if (-not $candidates) { Write-Host "`n  No removable drives found. Plug the card in and run again." -ForegroundColor Yellow; exit 1 }
  if ($candidates.Count -gt 1) {
    Write-Host "`n  Removable drives:" -ForegroundColor Cyan
    $candidates | ForEach-Object { "   {0}  {1:N1} GB used" -f $_.DeviceID, (($_.Size - $_.FreeSpace)/1GB) } | Write-Host
    $Drive = Read-Host "  Which drive? (letter)"
  } else { $Drive = $candidates.DeviceID }
}
$Drive = ($Drive.TrimEnd(':','\')) + ":"
if (-not (Test-Path "$Drive\")) { Write-Host "  $Drive not found." -ForegroundColor Red; exit 1 }

# ?? 2. Classify + plan ??????????????????????????????????????????????????????
$source = Classify "$Drive\"
$stamp  = Get-Date -Format "yyyy-MM-dd"
$year   = Get-Date -Format "yyyy"
$dest   = Join-Path $Library "$year\${stamp}__$source"
$n = 1; while (Test-Path $dest) { $n++; $dest = Join-Path $Library "$year\${stamp}__${source}_$n" }

$srcFiles = Get-ChildItem "$Drive\" -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch "System Volume Information" }
$srcCount = ($srcFiles | Measure-Object).Count
$srcBytes = ($srcFiles | Measure-Object -Property Length -Sum).Sum

Write-Host ""
Write-Host "  === OFFLOAD PLAN ===========================" -ForegroundColor Cyan
Write-Host "     Card:   $Drive  ->  looks like: $source"
Write-Host ("     Cargo:  {0:N0} files, {1:N1} GB" -f $srcCount, ($srcBytes/1GB))
Write-Host "     Dest:   $dest"
Write-Host "  ============================================" -ForegroundColor Cyan
if ($DryRun) { Write-Host "  (dry run - nothing copied)" -ForegroundColor Yellow; exit 0 }
if ((Read-Host "  Proceed? (y/n)") -ne "y") { exit 0 }

# ?? 3. Copy ?????????????????????????????????????????????????????????????????
Write-Host "`n  Hauling... (robocopy, multithreaded)" -ForegroundColor Cyan
robocopy "$Drive\" $dest /E /MT:8 /R:2 /W:2 /NP /NFL /NDL /XD "System Volume Information" | Out-Null

# ?? 4. Verify ???????????????????????????????????????????????????????????????
$dstFiles = Get-ChildItem $dest -Recurse -File
$dstCount = ($dstFiles | Measure-Object).Count
$dstBytes = ($dstFiles | Measure-Object -Property Length -Sum).Sum

# ?? 5. Catalog ??????????????????????????????????????????????????????????????
if (-not (Test-Path $Catalog)) {
  "offloaded,source,file,size_bytes,original_date,path" | Out-File $Catalog -Encoding utf8
}
$rows = $dstFiles | ForEach-Object {
  '"{0}","{1}","{2}",{3},"{4}","{5}"' -f $stamp, $source, $_.Name, $_.Length,
    $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm"), $_.FullName
}
$rows | Out-File $Catalog -Append -Encoding utf8

# ?? 6. Verdict ??????????????????????????????????????????????????????????????
Write-Host ""
if ($dstCount -eq $srcCount -and $dstBytes -eq $srcBytes) {
  Write-Host  "  [OK] VERIFIED - $dstCount files, $([math]::Round($dstBytes/1GB,1)) GB, every byte accounted for." -ForegroundColor Green
  Write-Host  "  [OK] SAFE TO FORMAT THE CARD (format it in the camera/drone, not Windows)." -ForegroundColor Green
  Write-Host  "     Library: $dest"
  Write-Host  "     Catalog: $Catalog  (search this to find any clip, ever)"
} else {
  Write-Host  "  [STOP] MISMATCH - card has $srcCount files/$srcBytes bytes, copy has $dstCount/$dstBytes." -ForegroundColor Red
  Write-Host  "  [STOP] DO NOT FORMAT. Run me again (robocopy resumes) or ask Fable." -ForegroundColor Red
}
Write-Host ""
