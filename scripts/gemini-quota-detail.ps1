# API key from kre8r/.env (never hardcode — Aug 10 2026 leak lesson)
$envLine = Select-String -Path "$PSScriptRoot...env" -Pattern "^GOOGLE_AI_API_KEY=(.*)$"
$GKEY = $envLine.Matches[0].Groups[1].Value.Trim()
$apiKey = '$GKEY'
$endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=$apiKey"
$bodyJson = '{"contents":[{"role":"user","parts":[{"text":"Hi"}]}],"generationConfig":{"maxOutputTokens":5}}'

try {
    $resp = Invoke-WebRequest -Uri $endpoint -Method POST -Body $bodyJson -ContentType 'application/json' -UseBasicParsing -ErrorAction Stop
    Write-Output "SUCCESS: $($resp.StatusCode)"
    Write-Output $resp.Content
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        Write-Output "Status: $([int]$resp.StatusCode)"
        Write-Output "Headers:"
        $resp.Headers.GetEnumerator() | ForEach-Object { Write-Output "  $($_.Key): $($_.Value)" }
        try {
            $stream = $resp.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $body = $reader.ReadToEnd()
            Write-Output "Body: $body"
        } catch {
            Write-Output "Could not read body: $($_.Exception.Message)"
        }
    } else {
        Write-Output "No response object: $($_.Exception.Message)"
    }
}
