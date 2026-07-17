$apiKey = 'AIzaSyByBuHUEKrTbvlCRwlt5ev_JI26tY1ao0A'
$outputFile = 'C:\Users\18054\kre8r\scripts\gemini-results.txt'
$endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=$apiKey"

$queries = @(
    "What content allocation frameworks do successful multi-stream YouTube creators use to balance growth content vs monetization content vs community content? What percentage of videos should serve each goal for a creator with 500k-1M subscribers who has ad revenue, affiliate income, digital products, and a paid membership community?",
    "How do top creator economy strategists recommend tracking and attributing which specific YouTube videos drive each revenue stream - ad revenue, affiliate sales, course/product sales, and paid community memberships? What analytics approaches exist for creator businesses with multiple income streams?",
    "What is the typical revenue lag time between publishing different content types and seeing downstream income effects for YouTubers? For example: how long after publishing a review video do affiliate sales typically peak? How long after publishing community-focused content does membership conversion typically improve?",
    "How do successful creators with Patreon, membership communities, or paid tiers prevent the 'feast or famine' cycle where focusing on one revenue stream causes others to drop? What scheduling or content calendar frameworks help maintain all income streams simultaneously?",
    "What metrics and KPIs do creator economy experts recommend for tracking the health of a paid membership community alongside YouTube analytics? How do you quantify the value and track the conversion funnel from free YouTube viewer to paid community member - specifically for communities with tiered pricing like free/19/month/297 one-time?",
    "What are the best creator business intelligence approaches for 2025-2026? How are top creators using data to make content decisions that optimize across multiple income streams simultaneously rather than optimizing for one metric at a time? Are there any known tools, frameworks, or methodologies specifically designed for multi-stream creator revenue optimization?"
)

# Clear output file
"" | Set-Content $outputFile

function Invoke-GeminiQuery {
    param([string]$query, [int]$queryNum)

    $bodyObj = @{
        contents = @(
            @{
                role  = 'user'
                parts = @(@{ text = $query })
            }
        )
        tools             = @(@{ google_search = @{} })
        generationConfig  = @{
            temperature    = 0.3
            maxOutputTokens = 2000
        }
    }
    $bodyJson = $bodyObj | ConvertTo-Json -Depth 10

    $maxRetries = 6
    $delay = 20

    for ($i = 0; $i -lt $maxRetries; $i++) {
        try {
            $response = Invoke-RestMethod -Uri $endpoint -Method POST -Body $bodyJson -ContentType 'application/json' -ErrorAction Stop
            $text = $response.candidates[0].content.parts[0].text
            return $text
        } catch {
            $statusCode = $null
            try { $statusCode = $_.Exception.Response.StatusCode.value__ } catch {}

            if ($statusCode -eq 429) {
                Write-Output "Q$queryNum : Rate limited (attempt $($i+1)/$maxRetries), waiting ${delay}s..."
                Start-Sleep -Seconds $delay
                $delay = [int]($delay * 1.8)
            } else {
                $errMsg = $_.Exception.Message
                try {
                    $errBody = $_.ErrorDetails.Message | ConvertFrom-Json
                    $errMsg = $errBody.error.message
                } catch {}
                Write-Output "Q$queryNum : ERROR $statusCode - $errMsg"
                return "ERROR: $errMsg"
            }
        }
    }
    return "FAILED: persistent 429 after $maxRetries retries"
}

for ($q = 1; $q -le 6; $q++) {
    Write-Output "Starting query $q of 6..."
    $result = Invoke-GeminiQuery -query $queries[$q - 1] -queryNum $q

    $header = "=== QUERY $q RESPONSE ==="
    Add-Content $outputFile $header
    Add-Content $outputFile $result
    Add-Content $outputFile ""
    Add-Content $outputFile "---END Q$q---"
    Add-Content $outputFile ""

    Write-Output "Query $q done. Length: $($result.Length) chars"

    # Wait between queries to avoid rate limiting
    if ($q -lt 6) {
        Write-Output "Waiting 10s before next query..."
        Start-Sleep -Seconds 10
    }
}

Write-Output "ALL DONE. Results saved to $outputFile"
