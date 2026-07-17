$f = "C:\Users\18054\kre8r\.claude\worktrees\kind-jang-6c6d54\public\mission-control.html"
Write-Output "Reading file..."
$c = [System.IO.File]::ReadAllText($f)
Write-Output "Length: $($c.Length)"
