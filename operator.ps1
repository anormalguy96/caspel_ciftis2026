<#
.SYNOPSIS
    Operator CLI helper for CASPEL CIFTIS 2026.
.DESCRIPTION
    Runs operator administrative tasks directly against the live backend container.
.EXAMPLE
    .\operator.ps1 summary
    .\operator.ps1 leads
    .\operator.ps1 leads -Csv > leads.csv
    .\operator.ps1 chat
    .\operator.ps1 analytics
#>

param(
    [Parameter(Position=0)]
    [ValidateSet("summary", "leads", "chat", "analytics", "help")]
    [string]$Command = "summary",

    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$ExtraArgs
)

if ($Command -eq "help") {
    Write-Host "CASPEL CIFTIS 2026 Operator Tool" -ForegroundColor Cyan
    Write-Host "Commands:"
    Write-Host "  .\operator.ps1 summary       - Show overall exhibition metrics dashboard"
    Write-Host "  .\operator.ps1 leads         - View registered leads in tabular format"
    Write-Host "  .\operator.ps1 leads -Csv    - Export registered leads as CSV"
    Write-Host "  .\operator.ps1 chat          - View recent visitor questions & AI answers"
    Write-Host "  .\operator.ps1 analytics     - View telemetry breakdown & download counts"
    exit 0
}

$dockerCmd = "docker exec caspel_backend python -m scripts.operator $Command $ExtraArgs"
Invoke-Expression $dockerCmd
