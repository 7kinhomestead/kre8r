# ===========================================================================
#  SYNC LIBRARY - rebuilds the media catalog from what's actually on disk
#  Built by Fable, July 2026.
#
#  The workflow it serves:
#   1. OFFLOAD CARD drops footage into D:\media-library\YYYY\DATE__source\
#   2. You assign clips by DRAGGING them (Explorer, multi-select, thumbnails)
#      into D:\media-library\projects\<project-name>\
#      e.g. projects\rock-rich-s2e2\   projects\a-frame-build\
#   3. Double-click SYNC LIBRARY: the catalog is rebuilt from reality -
#      every file gets its project, source, and current path recorded.
#
#  _catalog.csv answers, forever: "what's in S2E2?" / "where's that clip?"
#  The catalog is a snapshot of truth - safe to rebuild any time, never
#  precious, never stale after a sync. This tool changes NO media files.
# ===========================================================================
$Library = "D:\media-library"
$Catalog = Join-Path $Library "_catalog.csv"
$Projects = Join-Path $Library "projects"
New-Item -ItemType Directory -Force $Projects | Out-Null

Write-Host ""
Write-Host "  Scanning $Library ..." -ForegroundColor Cyan

$rows = New-Object System.Collections.Generic.List[string]
$rows.Add('project,source,offloaded,file,size_bytes,original_date,path')

$all = Get-ChildItem $Library -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\_tools\\' -and $_.Name -ne '_catalog.csv' }

$byProject = @{}
$bySource  = @{}
foreach ($f in $all) {
  $rel = $f.FullName.Substring($Library.Length + 1)
  $project = ""; $source = ""; $offloaded = ""

  if ($rel -match '^projects\\([^\\]+)\\') {
    $project = $Matches[1]
    $byProject[$project] = ($byProject[$project] + 1)
  }
  if ($rel -match '\\?(\d{4}-\d{2}-\d{2})__([^\\_]+[^\\]*)\\') {
    $offloaded = $Matches[1]; $source = $Matches[2]
    $bySource[$source] = ($bySource[$source] + 1)
  }

  $rows.Add(('"{0}","{1}","{2}","{3}",{4},"{5}","{6}"' -f `
    $project, $source, $offloaded, $f.Name, $f.Length,
    $f.LastWriteTime.ToString("yyyy-MM-dd HH:mm"), $f.FullName))
}

$rows | Out-File $Catalog -Encoding utf8

$total = $all.Count
$gb = [math]::Round(($all | Measure-Object -Property Length -Sum).Sum / 1GB, 1)
Write-Host "  [OK] Catalog rebuilt: $total files, $gb GB" -ForegroundColor Green
Write-Host ""
if ($byProject.Count) {
  Write-Host "  PROJECTS:" -ForegroundColor Cyan
  $byProject.GetEnumerator() | Sort-Object Name | ForEach-Object {
    Write-Host ("    {0,-30} {1} clips" -f $_.Key, $_.Value)
  }
} else {
  Write-Host "  (no project assignments yet - drag clips into $Projects\<name>\ and re-run)" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  To make a new project shelf: just create a folder under projects\" -ForegroundColor DarkGray
Write-Host "  To AI-tag a project in VaultOr: copy its folder into D:\kre8r\intake" -ForegroundColor DarkGray
Write-Host ""
