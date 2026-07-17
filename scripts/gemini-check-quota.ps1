$apiKey = 'AIzaSyByBuHUEKrTbvlCRwlt5ev_JI26tY1ao0A'
$endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=$apiKey"

$bodyObj = @{
    contents = @(@{ role = 'user'; parts = @(@{ text = 'Hello' }) })
    generationConfig = @{ maxOutputTokens = 10 }
}
$bodyJson = $bodyObj | ConvertTo-Json -Depth 10

try {
    $response = Invoke-RestMethod -Uri $endpoint -Method POST -Body $bodyJson -ContentType 'application/json' -ErrorAction Stop
    Write-Output "SUCCESS: $($response.candidates[0].content.parts[0].text)"
} catch {
    $statusCode = $null
    try { $statusCode = $_.Exception.Response.StatusCode.value__ } catch {}
    Write-Output "HTTP Status: $statusCode"
    Write-Output "Exception: $($_.Exception.Message)"
    try {
        $errBody = $_.ErrorDetails.Message | ConvertFrom-Json
        Write-Output "API Error Code: $($errBody.error.code)"
        Write-Output "API Error Message: $($errBody.error.message)"
        Write-Output "API Error Status: $($errBody.error.status)"
        if ($errBody.error.details) {
            $errBody.error.details | ForEach-Object {
                Write-Output "Detail: $($_ | ConvertTo-Json -Compress)"
            }
        }
    } catch {
        Write-Output "Raw error body: $($_.ErrorDetails.Message)"
    }
}
