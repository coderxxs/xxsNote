$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$version = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot "VERSION")).Trim()

if ($version -notmatch '^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$') {
    throw "VERSION 文件不是有效的语义化版本号：$version"
}

$releaseRoot = Join-Path $projectRoot "release"
$packageName = "xxsNote-v$version-win-x64"
$stagingRoot = Join-Path $releaseRoot ".staging"
$packageRoot = Join-Path $stagingRoot $packageName
$archivePath = Join-Path $releaseRoot "$packageName.zip"
$checksumPath = Join-Path $releaseRoot "checksums.sha256"

if (Test-Path -LiteralPath $stagingRoot) {
    $resolvedStaging = (Resolve-Path -LiteralPath $stagingRoot).Path
    if (-not $resolvedStaging.StartsWith($releaseRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝清理意外路径：$resolvedStaging"
    }
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
}

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}

New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageRoot "data") -Force | Out-Null

$files = @(
    "README.md",
    "VERSION",
    "server.py",
    "启动xxsNote.cmd"
)

foreach ($file in $files) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $packageRoot $file)
}

# cmd.exe requires CRLF line endings for reliable batch parsing.
$launcherPath = Join-Path $packageRoot "启动xxsNote.cmd"
$launcherContent = (Get-Content -Raw -LiteralPath $launcherPath) -replace "`r?`n", "`r`n"
[IO.File]::WriteAllText($launcherPath, $launcherContent, [Text.UTF8Encoding]::new($false))

Copy-Item -LiteralPath (Join-Path $projectRoot "dist") -Destination $packageRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "runtime") -Destination $packageRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "data\index.json") -Destination (Join-Path $packageRoot "data\index.json")

Compress-Archive -LiteralPath $packageRoot -DestinationPath $archivePath -CompressionLevel Optimal

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
"$hash  $packageName.zip" | Set-Content -LiteralPath $checksumPath -Encoding ascii

Remove-Item -LiteralPath $stagingRoot -Recurse -Force

Write-Host "发布包已生成：$archivePath"
Write-Host "SHA-256：$hash"
