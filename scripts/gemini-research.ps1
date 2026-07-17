param([int]$QueryNum = 1)

$apiKey = 'AIzaSyByBuHUEKrTbvlCRwlt5ev_JI26tY1ao0A'

$queries = @(
    "What content allocation frameworks do successful multi-stream YouTube creators use to balance growth content vs monetization content vs community content? What percentage of videos should serve each goal for a creator with 500k-1M subscribers who has ad revenue, affiliate income, digital products, and a paid membership community?",
    "How do top creator economy strategists recommend tracking and attributing which specific YouTube videos drive each revenue stream - ad revenue, affiliate sales, course/product sales, and paid community memberships? What analytics approaches exist for creator businesses with multiple income streams?",
    "What is the typical revenue lag time between publishing different content types and seeing downstream income effects for YouTubers? For example: how long after publishing a review video do affiliate sales typically peak? How long after publishing community-focused content does membership conversion typically improve?",
    "How do successful creators with Patreon, membership communities, or paid tiers prevent the 'feast or famine' cycle where focusing on one revenue stream causes others to drop? What scheduling or content calendar frameworks help maintain all income streams simultaneously?",
    "What metrics and KPIs do creator economy experts recommend for tracking the health of a paid membership community alongside YouTube analytics? How do you quantify the value and track the conversion funnel from free YouTube viewer to paid community member - specifically for communities with tiered pricing like free/19/month/297 one-time?",
    "What are the best creator business intelligence approaches for 2025-2026? How are top creators using data to make content decisions that optimize across multiple income streams simultaneously rather than optimizing for one metric at a time? Are there any known tools, frameworks, or methodologies specifically designed for multi-stream creator revenue optimization?"
)

$query = $queries[$QueryNum - 1]
$endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=$apiKey"

$bodyObj = @{
    contents = @(
        @{
            role = 'user'
            parts = @(@{ text = $query })
        }
    )
    tools = @(@{ google_search = @{} })
    generationConfig = @{
        temperature = 0.3
        maxOutputTokens = 2000
    }
}

$bodyJson = $bodyObj | ConvertTo-Json -Depth 10

$maxRetries = 4
$delay = 15

for ($i = 0; $i -lt $maxRetries; $i++) {
    try {
        $response = Invoke-RestMethod -Uri $endpoint -Method POST -Body $bodyJson -ContentType 'application/json' -ErrorAction Stop
        Write-Output "=== QUERY $QueryNum RESPONSE ==="
        Write-Output $response.candidates[0].content.parts[0].text
        exit 0
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 429) {
            Write-Output "Rate limited (attempt $($i+1)/$maxRetries), waiting ${delay}s..."
            Start-Sleep -Seconds $delay
            $delay = $delay * 2
        } else {
            Write-Output "ERROR $statusCode : $($_.Exception.Message)"
            try {
                $errBody = $_.ErrorDetails.Message | ConvertFrom-Json
                Write-Output "API Error: $($errBody.error.message)"
                Write-Output "Status: $($errBody.error.status)"
            } catch {}
            exit 1
        }
    }
}

Write-Output "FAILED after $maxRetries retries (persistent 429)"
