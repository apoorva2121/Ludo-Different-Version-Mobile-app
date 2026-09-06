param(
    [switch]$Release,
    [string]$ServerUrl = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem -Directory 'C:\Program Files\Microsoft\jdk-17*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}
if (-not $env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = Join-Path $env:TEMP 'house-of-kiran-gradle-cache' }
$sdkRoot = $env:ANDROID_HOME
if ([string]::IsNullOrWhiteSpace($sdkRoot)) { $sdkRoot = Join-Path $repoRoot '.android-sdk' }
if (-not (Test-Path -LiteralPath $sdkRoot)) {
    throw "Android SDK not found. Set ANDROID_HOME or install it at $sdkRoot."
}

$env:ANDROID_HOME = (Resolve-Path -LiteralPath $sdkRoot).Path
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$task = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
Push-Location (Join-Path $repoRoot 'android')
try {
    $projectCache = Join-Path $env:TEMP 'house-of-kiran-project-cache'
    # Always use the wrapper so gradle-wrapper.properties stays the single source of
    # truth for the Gradle version. GRADLE_USER_HOME and the project cache both live
    # outside OneDrive, which is what avoids the cache snapshot errors.
    & '.\gradlew.bat' $task --no-daemon --project-cache-dir $projectCache "-PserverBaseUrl=$ServerUrl"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $variant = if ($Release) { 'release' } else { 'debug' }
    $apk = Get-ChildItem -File "app\build\outputs\apk\$variant\*.apk" | Select-Object -First 1
    if (-not $apk) { throw 'The build completed without an APK.' }
    Write-Output "APK: $($apk.FullName)"
    if (-not $Release) {
        $outputDir = Join-Path $repoRoot 'dist'
        New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
        $outputApk = Join-Path $outputDir 'House-of-Kiran-test.apk'
        Copy-Item -LiteralPath $apk.FullName -Destination $outputApk -Force
        Write-Output "Phone testing package: $outputApk"
    }
} finally {
    Pop-Location
}
