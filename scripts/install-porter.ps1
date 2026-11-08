<#
.SYNOPSIS
  在内网机器上安装 dsh-plugin-porter（插件搬运助手），不需要 npm / pnpm / 网络。

.DESCRIPTION
  把本脚本旁边的 porter\ 目录复制到 DSH profile 的 node_modules，
  更新 profile/package.json 的 dependencies 与 dsh.profile.bundles，
  并把旧文件备份到 <profile>\.dsh-plugin-porter\backups\install-<时间戳>\。

  安装完成后必须完全退出并重新启动 DSH。

.PARAMETER ProfileDir
  DSH profile 目录。默认依次使用 $env:DSH_PROFILE_DIR、
  %USERPROFILE%\.dsh\profiles\desktop，或唯一的 profiles\* 目录。

.PARAMETER PorterSource
  搬运助手包目录。默认自动查找脚本旁边的 porter\ 或脚本上一级目录。

.PARAMETER DryRun
  只打印将要执行的操作，不写文件。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\install-porter.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\install-porter.ps1 -ProfileDir "D:\dsh\profiles\desktop"
#>
[CmdletBinding()]
param(
  [string]$ProfileDir = '',
  [string]$PorterSource = '',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
  Write-Host "  $Message"
}

function Write-Ok([string]$Message) {
  Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
  Write-Host "  [!] $Message" -ForegroundColor Yellow
}

function Fail([string]$Message) {
  throw $Message
}

function Resolve-FullPath([string]$PathValue) {
  return [System.IO.Path]::GetFullPath($PathValue)
}

function Resolve-ProfileDir {
  param([string]$Candidate)

  if (-not [string]::IsNullOrWhiteSpace($Candidate)) {
    $full = Resolve-FullPath $Candidate
    if (-not (Test-Path -LiteralPath (Join-Path $full 'package.json') -PathType Leaf)) {
      Fail "指定的 profile 目录里没有 package.json：$full"
    }
    return $full
  }

  if (-not [string]::IsNullOrWhiteSpace($env:DSH_PROFILE_DIR)) {
    $full = Resolve-FullPath $env:DSH_PROFILE_DIR
    if (Test-Path -LiteralPath (Join-Path $full 'package.json') -PathType Leaf) {
      return $full
    }
    Write-Warn "DSH_PROFILE_DIR 指向的目录没有 package.json，继续查找：$full"
  }

  $dshHome = $env:DSH_HOME
  if ([string]::IsNullOrWhiteSpace($dshHome)) {
    $dshHome = Join-Path $env:USERPROFILE '.dsh'
  }
  $profilesDir = Join-Path $dshHome 'profiles'

  $desktop = Join-Path $profilesDir 'desktop'
  if (Test-Path -LiteralPath (Join-Path $desktop 'package.json') -PathType Leaf) {
    return (Resolve-FullPath $desktop)
  }

  $candidates = @()
  if (Test-Path -LiteralPath $profilesDir) {
    $candidates = @(Get-ChildItem -LiteralPath $profilesDir -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'package.json') -PathType Leaf })
  }
  if ($candidates.Count -eq 1) {
    return (Resolve-FullPath $candidates[0].FullName)
  }
  if ($candidates.Count -gt 1) {
    $names = ($candidates | ForEach-Object { $_.Name }) -join ', '
    Fail "找到多个 DSH profile（$names），请用 -ProfileDir 指定其中一个。"
  }
  Fail "找不到 DSH profile。请先安装并启动一次 DSH，或用 -ProfileDir 指定 profile 目录。"
}

function Find-PorterSource {
  param([string]$Candidate)

  $probe = @()
  if (-not [string]::IsNullOrWhiteSpace($Candidate)) {
    $probe += (Resolve-FullPath $Candidate)
  }
  if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $probe += (Join-Path $PSScriptRoot 'porter')
    $probe += (Resolve-FullPath (Join-Path $PSScriptRoot '..'))
  }

  foreach ($pathValue in $probe) {
    $packageFile = Join-Path $pathValue 'package.json'
    if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) { continue }
    try {
      $pkg = Get-Content -LiteralPath $packageFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($pkg.name -eq 'dsh-plugin-porter') {
        return (Resolve-FullPath $pathValue)
      }
    } catch {
      continue
    }
  }
  Fail "找不到 porter 包目录（package.json 中 name 应为 dsh-plugin-porter）。请把本脚本与 porter\ 放在同一目录，或用 -PorterSource 指定。"
}

function Get-PackageJson([string]$PathValue) {
  return (Get-Content -LiteralPath $PathValue -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Ensure-ChildObject($Parent, [string]$Name) {
  $property = $Parent.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) {
    $Parent | Add-Member -NotePropertyName $Name -NotePropertyValue (New-Object psobject) -Force
  }
  return $Parent.$Name
}

function Copy-PorterFiles([string]$Source, [string]$Destination) {
  $robocopy = Get-Command robocopy.exe -ErrorAction SilentlyContinue
  if ($null -ne $robocopy) {
    & $robocopy.Source $Source $Destination /E /COPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    $code = $LASTEXITCODE
    if ($code -ge 8) {
      Fail "复制文件失败（robocopy 退出码 $code）。"
    }
    return
  }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force
}

function Restore-Previous {
  param(
    [string]$Target,
    [string]$OldTarget,
    [string]$PackageJsonBackup,
    [string]$PackageJsonPath
  )
  if (Test-Path -LiteralPath $Target) {
    Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (-not [string]::IsNullOrWhiteSpace($OldTarget) -and (Test-Path -LiteralPath $OldTarget)) {
    Move-Item -LiteralPath $OldTarget -Destination $Target -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $PackageJsonBackup) {
    Copy-Item -LiteralPath $PackageJsonBackup -Destination $PackageJsonPath -Force -ErrorAction SilentlyContinue
  }
}

try {
  Write-Host ''
  Write-Host 'DSH Plugin Porter — 内网安装' -ForegroundColor Cyan
  Write-Host '================================'

  $source = Find-PorterSource $PorterSource
  $porterPkg = Get-PackageJson (Join-Path $source 'package.json')
  $porterName = [string]$porterPkg.name
  $porterVersion = [string]$porterPkg.version
  Write-Step "包: $porterName@$porterVersion"
  Write-Step "来源: $source"

  $profile = Resolve-ProfileDir $ProfileDir
  Write-Step "profile: $profile"
  $packageJsonPath = Join-Path $profile 'package.json'
  $modulesDir = Join-Path $profile 'node_modules'
  $target = Join-Path $modulesDir $porterName

  $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*DeepSeek*' })
  if ($running.Count -gt 0) {
    Write-Warn '检测到 DeepSeek Harness 正在运行。建议先完全退出 DSH（托盘图标 → 退出）再安装；'
    Write-Warn '如果文件被占用导致安装失败，请退出后重新运行本脚本。'
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupRoot = Join-Path $profile ".dsh-plugin-porter\backups\install-$stamp"
  $packageJsonBackup = Join-Path $backupRoot 'package.json'
  $oldTarget = $null

  Write-Step "备份: $backupRoot"
  if (-not $DryRun) {
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    Copy-Item -LiteralPath $packageJsonPath -Destination $packageJsonBackup -Force
    New-Item -ItemType Directory -Force -Path $modulesDir | Out-Null
  }

  if (Test-Path -LiteralPath $target) {
    $oldTarget = Join-Path $modulesDir ".$porterName-old-$stamp"
    Write-Step "旧版本已存在，将移动到: $oldTarget"
    if (-not $DryRun) {
      try {
        Move-Item -LiteralPath $target -Destination $oldTarget -Force -ErrorAction Stop
      } catch {
        Write-Warn '旧目录无法重命名（可能被 DSH 占用），将直接覆盖安装。'
        $oldTarget = $null
      }
    }
  }

  Write-Step "复制到: $target"
  if (-not $DryRun) {
    Copy-PorterFiles $source $target
    $copiedPkg = Get-PackageJson (Join-Path $target 'package.json')
    if ($copiedPkg.name -ne $porterName -or $copiedPkg.version -ne $porterVersion) {
      Fail "复制后的 package.json 不匹配（期望 $porterName@$porterVersion）。"
    }
  }

  Write-Step '更新 profile/package.json（dependencies + dsh.profile.bundles）'
  if (-not $DryRun) {
    $json = Get-PackageJson $packageJsonPath
    $dependencies = Ensure-ChildObject $json 'dependencies'
    $dependencies | Add-Member -NotePropertyName $porterName -NotePropertyValue $porterVersion -Force

    $dsh = Ensure-ChildObject $json 'dsh'
    $dshProfile = Ensure-ChildObject $dsh 'profile'
    $bundles = @()
    if ($null -ne $dshProfile.PSObject.Properties['bundles'] -and $null -ne $dshProfile.bundles) {
      $bundles = @($dshProfile.bundles)
    }
    if ($bundles -notcontains $porterName) {
      $bundles += $porterName
    }
    $dshProfile | Add-Member -NotePropertyName 'bundles' -NotePropertyValue @($bundles) -Force

    $jsonText = $json | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText($packageJsonPath, $jsonText + "`n", (New-Object System.Text.UTF8Encoding -ArgumentList $false))

    $check = Get-PackageJson $packageJsonPath
    $dep = $check.dependencies.PSObject.Properties[$porterName]
    if ($null -eq $dep -or $dep.Value -ne $porterVersion) {
      Fail '写入后校验失败：dependencies 中没有正确的搬运助手版本。'
    }
    if (@($check.dsh.profile.bundles) -notcontains $porterName) {
      Fail '写入后校验失败：dsh.profile.bundles 中没有搬运助手。'
    }
  }

  if ($DryRun) {
    Write-Host ''
    Write-Ok 'Dry run 完成，未写入任何文件。'
    exit 0
  }

  Write-Host ''
  Write-Ok "已安装 $porterName@$porterVersion"
  Write-Host ''
  Write-Host '下一步：' -ForegroundColor Cyan
  Write-Host '  1. 完全退出 DSH（托盘图标 → 退出），然后重新启动。'
  Write-Host '  2. 打开 设置 → 插件搬运，进入“导入”页扫描搬运目录。'
  Write-Host "  3. 旧版本备份在: $backupRoot"
  Write-Host ''
  exit 0
} catch {
  Write-Host ''
  Write-Host "安装失败: $($_.Exception.Message)" -ForegroundColor Red
  if ($null -ne $backupRoot -and $null -ne $packageJsonPath) {
    Restore-Previous -Target $target -OldTarget $oldTarget -PackageJsonBackup $packageJsonBackup -PackageJsonPath $packageJsonPath
  }
  exit 1
}
