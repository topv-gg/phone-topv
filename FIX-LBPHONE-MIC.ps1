# =====================================================================
#  FIX-LBPHONE-MIC.ps1
#
#  RUN THIS AFTER EVERY lb-phone UPDATE.
#
#  WHY
#  The TopV interface is loaded by lb-phone inside an iframe, served from
#  https://topv.gg/phone/ - a DIFFERENT origin from lb-phone itself.
#  Chromium denies microphone access to a cross-origin iframe unless that
#  iframe carries allow="microphone". lb-phone sets none.
#
#  The result: getUserMedia fails with NotAllowedError and the phone screen
#  reads "Microphone denied by the phone".
#
#  This script adds the attribute. It is a no-op where it is already set,
#  and keeps a copy of each original file (.before-topv-mic).
#
#  KEEP THIS FILE PURE ASCII.
#  Windows PowerShell 5.1 reads a BOM-less .ps1 using the ANSI code page: an
#  em dash or an accented letter becomes several bytes there, and the first
#  string it meets ends up unterminated. An earlier version therefore did NOT
#  run at all - it died on a parse error, while the phone screen was telling
#  the owner to run it.
#
#  AND EVERY IFRAME MUST BE TREATED, NOT JUST ONE.
#  The first version only targeted the `iframe`,{ref: pattern. The bundle
#  holds five, and the APPLICATIONS one does not have that shape (it starts
#  with {style:{backfaceVisibility:). The microphone stayed denied while the
#  script reported success.
# =====================================================================

# WHERE IS lb-phone? Found by walking up from this script, so the file works
# on any server, any drive, any layout. NEVER a hard-coded path: it would only
# ever match the one machine it was written on.
$base = $null
$dir = $PSScriptRoot
for ($i = 0; $i -lt 6 -and $dir; $i++) {
    $try = Join-Path $dir "lb-phone\ui\dist\assets"
    if (Test-Path -LiteralPath $try) { $base = $try; break }
    $dir = Split-Path -Parent $dir
}

if (-not $base) {
    Write-Host "  x lb-phone not found above $PSScriptRoot" -ForegroundColor Red
    Write-Host "    Expected: <resources>\lb-phone\ui\dist\assets" -ForegroundColor Red
    exit 1
}
Write-Host "  lb-phone found: $base" -ForegroundColor DarkGray

# The permission to add. `*` = whatever origin the iframe ends up loading.
$permission = 'allow:`microphone *; camera *; autoplay *; clipboard-write *`,'

# Matched BY CONTENT, never by file name: lb-phone's bundle names carry a
# build hash and change on every release.
$pattern = '`iframe`,{'

$patched = 0
$added = 0

Get-ChildItem -LiteralPath $base -Filter *.js | ForEach-Object {
    $t = [IO.File]::ReadAllText($_.FullName)
    if (-not $t.Contains($pattern)) { return }

    # How many iframes, and how many already carry the permission?
    $total = ([regex]::Matches($t, [regex]::Escape($pattern))).Count
    $already = ([regex]::Matches($t, [regex]::Escape($pattern + 'allow:'))).Count
    if ($total -eq $already) {
        Write-Host "  = already complete: $($_.Name) ($total iframe(s))" -ForegroundColor DarkGray
        return
    }

    $bak = "$($_.FullName).before-topv-mic"
    if (-not (Test-Path -LiteralPath $bak)) { Copy-Item -LiteralPath $_.FullName -Destination $bak }

    # Add the permission to EVERY iframe that lacks it.
    $new = $t.Replace($pattern, $pattern + $permission)
    # ...without doubling it where it was already there (the replace inserted
    # ours in front of the existing one, so drop the duplicate).
    $new = $new.Replace($permission + $permission, $permission)

    [IO.File]::WriteAllText($_.FullName, $new)

    $n = $total - $already
    Write-Host "  v $($_.Name): $n iframe(s) patched out of $total" -ForegroundColor Green
    $script:patched++
    $script:added += $n
}

if ($patched -eq 0) {
    Write-Host ""
    Write-Host "  Nothing to do: every iframe already carries the permission." -ForegroundColor Cyan
    exit 0
}

Write-Host ""
Write-Host "  Done: $added iframe(s) across $patched file(s)." -ForegroundColor Cyan
Write-Host "  Restart the game, or in the server console: restart lb-phone" -ForegroundColor Cyan
