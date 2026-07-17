$apiKey = 'AIzaSyByBuHUEKrTbvlCRwlt5ev_JI26tY1ao0A'

# Try flash model - higher free tier limits
$endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=$apiKey"
$bodyJson = '{"contents":[{"role":"user","parts":[{"text":"Say the word OK"}]}],"generationConfig":{"maxOutputTokens":5}}'

Write-Output "Testing gemini-2.0-flash..."
try {
    $r = Invoke-RestMethod -Uri $endpoint -Method POST -Body $bodyJson -ContentType 'application/json' -ErrorAction Stop
    Write-Output "Flash SUCCESS: $($r.candidates[0].content.parts[0].text)"
} catch {
    $code = $null
    try { $code = $_.Exception.Response.StatusCode.value__ } catch {}
    Write-Output "Flash FAILED: HTTP $code - $($_.Exception.Message)"
}

# Try flash-lite
$endpoint2 = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=$apiKey"
Write-Output "Testing gemini-2.0-flash-lite..."
try {
    $r2 = Invoke-RestMethod -Uri $endpoint2 -Method POST -Body $bodyJson -ContentType 'application/json' -ErrorAction Stop
    Write-Output "Flash-Lite SUCCESS: $($r2.candidates[0].content.parts[0].text)"
} catch {
    $code2 = $null
    try { $code2 = $_.Exception.Response.StatusCode.value__ } catch {}
    Write-Output "Flash-Lite FAILED: HTTP $code2 - $($_.Exception.Message)"
}

# Try gemini-2.5-flash
$endpoint3 = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$apiKey"
Write-Output "Testing gemini-2.5-flash..."
try {
    $r3 = Invoke-RestMethod -Uri $endpoint3 -Method POST -Body $bodyJson -ContentType 'application/json' -ErrorAction Stop
    Write-Output "2.5-Flash SUCCESS: $($r3.candidates[0].content.parts[0].text)"
} catch {
    $code3 = $null
    try { $code3 = $_.Exception.Response.StatusCode.value__ } catch {}
    Write-Output "2.5-Flash FAILED: HTTP $code3 - $($_.Exception.Message)"
}
