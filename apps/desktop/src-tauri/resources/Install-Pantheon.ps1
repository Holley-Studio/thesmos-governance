# Copyright (c) 2024-2026 Holley Studio LLC. All rights reserved.
# Windows PowerShell 5.1. ASCII only - no BOM is needed and none must be added.
#
# Installs or updates Pantheon for the current Windows user. No admin rights.
#
# Two ways in:
#   First install on a PC:  -ChannelDir <release folder>   (run via "Install Pantheon.cmd")
#   Update from the app:    -Package <verified local zip> -Sha256 <hex> -Version <x.y.z> -WaitForPid <pid> -Launch
#
# Layout under %LOCALAPPDATA%\HolleyStudio\Pantheon:
#   <version>\            one folder per installed version; older ones are kept
#   current               junction to the active version; shortcuts point here
#   install.log           what this script did
#
# Business data lives elsewhere (%LOCALAPPDATA%\studio.holley.thesmos) and is
# never touched here.
[CmdletBinding()]
param(
    [string]$ChannelDir,
    [string]$Package,
    [string]$Sha256,
    [string]$Version,
    [int]$WaitForPid = 0,
    [switch]$Launch,
    # Skip desktop and Start menu shortcuts (used when testing an install).
    [switch]$NoShortcuts
)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'HolleyStudio\Pantheon'
New-Item -ItemType Directory -Path $root -Force | Out-Null
# Never work from inside "current": the app starts this script with the link as
# its working directory, and the link is removed and recreated below. A process
# whose working directory has vanished cannot start cmd.exe.
Set-Location -LiteralPath $root
[Environment]::CurrentDirectory = $root
$logPath = Join-Path $root 'install.log'
function Write-Log([string]$Message) {
    $line = '{0} {1}' -f (Get-Date).ToString('s'), $Message
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
    Write-Host $Message
}

$temp = $null
try {
    if ($ChannelDir) {
        $manifestPath = Join-Path $ChannelDir 'latest.json'
        if (-not (Test-Path -LiteralPath $manifestPath)) { throw "No release manifest in $ChannelDir. Google Drive may still be syncing." }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($manifest.schema -ne 1 -or $manifest.product -ne 'Pantheon') { throw 'The release manifest is not a Pantheon release this installer understands.' }
        $Version = [string]$manifest.version
        $Sha256 = [string]$manifest.sha256
        if ([string]$manifest.package -ne "Pantheon-$Version.zip") { throw 'The release package name is not valid.' }
        $Package = Join-Path $ChannelDir "Pantheon-$Version.zip"
    }
    if ($Version -notmatch '^\d{1,6}\.\d{1,6}\.\d{1,6}$') { throw 'A version in the form 1.2.3 is required.' }
    if ($Sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'A SHA-256 checksum is required.' }
    if (-not $Package -or -not (Test-Path -LiteralPath $Package)) { throw 'The release package was not found. Google Drive may still be syncing.' }
    Write-Log "Installing Pantheon $Version"

    if ($WaitForPid -gt 0) {
        # The running app exits after starting this script; wait so its files are free.
        try { Wait-Process -Id $WaitForPid -Timeout 60 -ErrorAction Stop } catch { }
    }
    $running = @(Get-Process -Name 'Pantheon' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) })
    if ($running.Count -gt 0) { throw 'Pantheon is still running. Close it and run the installer again.' }

    # Work from a local copy so the bytes that are checked are the bytes installed.
    $temp = Join-Path $root (".package-{0}.zip" -f [Guid]::NewGuid().ToString('N'))
    Copy-Item -LiteralPath $Package -Destination $temp
    $actual = (Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash
    if ($actual -ne $Sha256.ToUpperInvariant()) { throw 'The release package failed its checksum. Nothing was installed.' }

    $stage = Join-Path $root ".staging-$Version"
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    Expand-Archive -LiteralPath $temp -DestinationPath $stage
    foreach ($required in 'Pantheon.exe', 'resources\thesmos-runtime.exe', 'resources\Install-Pantheon.ps1') {
        if (-not (Test-Path -LiteralPath (Join-Path $stage $required))) { throw "The release package is missing $required. Nothing was installed." }
    }

    $dest = Join-Path $root $Version
    if (Test-Path -LiteralPath $dest) {
        # Reinstalling the same version: keep the old folder rather than delete it.
        $aside = '{0}.replaced-{1}' -f $Version, (Get-Date).ToString('yyyyMMdd-HHmmss')
        Rename-Item -LiteralPath $dest -NewName $aside
        Write-Log "Kept the previous $Version folder as $aside"
    }
    Rename-Item -LiteralPath $stage -NewName $Version

    # Repoint "current". rmdir without /s removes only a junction, never a real
    # folder with content, so a mistake here cannot delete an install.
    $current = Join-Path $root 'current'
    $previousTarget = $null
    if (Test-Path -LiteralPath $current) {
        $previousTarget = @((Get-Item -LiteralPath $current -Force).Target)[0]
        & cmd.exe /c rmdir "$current" | Out-Null
        if (Test-Path -LiteralPath $current) { throw "$current exists and is not a link. Move it aside and run the installer again." }
    }
    & cmd.exe /c mklink /J "$current" "$dest" | Out-Null
    if (-not (Test-Path -LiteralPath (Join-Path $current 'Pantheon.exe'))) {
        # Put the link back where it was, so a failed update leaves a working app.
        if ($previousTarget -and (Test-Path -LiteralPath (Join-Path $previousTarget 'Pantheon.exe'))) {
            if (Test-Path -LiteralPath $current) { & cmd.exe /c rmdir "$current" | Out-Null }
            & cmd.exe /c mklink /J "$current" "$previousTarget" | Out-Null
        }
        throw 'Could not point the current-version link at the new install. The previous version is still in place.'
    }

    $exe = Join-Path $current 'Pantheon.exe'
    $shell = New-Object -ComObject WScript.Shell
    $links = @(
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Pantheon.lnk'),
        (Join-Path ([Environment]::GetFolderPath('Programs')) 'Pantheon.lnk')
    )
    if ($NoShortcuts) { $links = @() }
    foreach ($link in $links) {
        $shortcut = $shell.CreateShortcut($link)
        $shortcut.TargetPath = $exe
        $shortcut.WorkingDirectory = $current
        $shortcut.Description = 'Pantheon by Holley Studio'
        $shortcut.Save()
    }

    $record = [pscustomobject]@{ version = $Version; installedAt = (Get-Date).ToString('o'); sha256 = $Sha256.ToLowerInvariant() }
    $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'installed.json') -Encoding utf8
    Write-Log "Pantheon $Version installed"
    if ($Launch) { Start-Process -FilePath $exe -WorkingDirectory $current }
}
catch {
    Write-Log ("FAILED: " + $_.Exception.Message)
    # If the app started this update, bring the previous version back up.
    if ($Launch -and $WaitForPid -gt 0) {
        $previous = Join-Path $root 'current\Pantheon.exe'
        if (Test-Path -LiteralPath $previous) { Start-Process -FilePath $previous }
    }
    exit 1
}
finally {
    if ($temp -and (Test-Path -LiteralPath $temp)) { Remove-Item -LiteralPath $temp -Force }
}
