# Generates the PWA icon PNGs (192, 512, maskable 512) into public/icons.
# Pure .NET System.Drawing — no npm image dependencies needed.
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\public\icons"
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-Icon {
    param([int]$Size, [string]$Path, [bool]$Maskable)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    $bg = [System.Drawing.ColorTranslator]::FromHtml("#15803d")
    $leaf = [System.Drawing.ColorTranslator]::FromHtml("#86efac")
    $g.Clear($bg)

    # Maskable icons need a full-bleed background with content in the safe
    # zone (inner 80%); standard icons just use a bit of padding.
    $scale = if ($Maskable) { 0.62 } else { 0.78 }
    $w = [int]($Size * $scale)
    $x = [int](($Size - $w) / 2)

    # Leaf body (ellipse rotated 45 degrees)
    $leafBrush = New-Object System.Drawing.SolidBrush($leaf)
    $g.TranslateTransform($Size / 2, $Size / 2)
    $g.RotateTransform(45)
    $g.FillEllipse($leafBrush, -$w / 2, -$w / 3.2, $w, [int]($w / 1.6))

    # Stem line
    $penWidth = [Math]::Max(2, [int]($Size * 0.02))
    $pen = New-Object System.Drawing.Pen($bg, $penWidth)
    $g.DrawLine($pen, -$w / 2.2, 0, $w / 2.2, 0)
    $g.ResetTransform()

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $leafBrush.Dispose(); $pen.Dispose()
    Write-Host "wrote $Path"
}

New-Icon -Size 192 -Path (Join-Path $outDir "icon-192.png") -Maskable $false
New-Icon -Size 512 -Path (Join-Path $outDir "icon-512.png") -Maskable $false
New-Icon -Size 512 -Path (Join-Path $outDir "icon-maskable-512.png") -Maskable $true
