# ReadLoop 一键安装（由 setup.bat 调用）
# 步骤与 04-ENGINEERING.md §7.1 对应：检查 Node → 依赖 → 前端构建 → 托盘 → 词典 → 快捷方式 → README → 启动

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Step($n, $text) { Write-Host "`n[$n] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    注意  $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "    失败  $text" -ForegroundColor Red }

Write-Host "==============================================" -ForegroundColor DarkYellow
Write-Host " ReadLoop 安装" -ForegroundColor DarkYellow
Write-Host " 项目目录：$root" -ForegroundColor DarkYellow
Write-Host "==============================================" -ForegroundColor DarkYellow

# ---------- 1. Node ----------
Step '1/10' '检查 Node.js'
try {
    $nodeVersion = (& node -v) 2>$null
    if (-not $nodeVersion) { throw 'node not found' }
    $major = [int](($nodeVersion -replace '^v', '') -split '\.')[0]
    if ($major -lt 20) {
        Fail "Node.js 版本过低（$nodeVersion），需要 20+。https://nodejs.org/"
        exit 1
    }
    Ok "Node $nodeVersion"
} catch {
    Fail '未找到 Node.js 20+，请先安装：https://nodejs.org/'
    exit 1
}

# ---------- 2. npm ----------
Step '2/10' '检查 npm'
try {
    $npmVersion = (& npm -v) 2>$null
    if (-not $npmVersion) { throw 'npm not found' }
    Ok "npm $npmVersion"
} catch {
    Fail 'npm 不可用，请重装 Node.js。'
    exit 1
}

# ---------- 3. 依赖 ----------
Step '3/10' '安装依赖'
if (Test-Path (Join-Path $root 'package-lock.json')) {
    & npm ci --no-audit --no-fund
} else {
    & npm install --no-audit --no-fund
}
if ($LASTEXITCODE -ne 0) { Fail 'npm 安装失败，见上方输出。'; exit 1 }
Ok '依赖已安装'

# ---------- 4. 前端构建 ----------
Step '4/10' '构建前端（Vite → server/public）'
& npm run build
if ($LASTEXITCODE -ne 0) { Fail '前端构建失败。'; exit 1 }
Ok '前端已构建'

# ---------- 5. 托盘 ----------
Step '5/10' '编译托盘程序（.NET Framework / csc）'
& cmd /c "tray\build-tray.bat"
if ($LASTEXITCODE -ne 0) { Fail '托盘编译失败（不影响服务本体，可稍后重试）。' } else { Ok 'ReadLoopTray.exe 已生成' }

# ---------- 6. 词典 ----------
Step '6/10' '准备词典（ECDICT / stardict.db）'
$dataDir = Join-Path $env:APPDATA 'readloop'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$dictTarget = Join-Path $dataDir 'stardict.db'

function Test-Dict([string]$path) {
    if (-not (Test-Path $path)) { return $false }
    if ((Get-Item $path).Length -lt 10MB) { return $false }
    $out = & node tools\verify-dict.mjs $path 2>&1
    return ($LASTEXITCODE -eq 0)
}

if (Test-Dict $dictTarget) {
    Ok '目标词典已存在且校验通过'
} else {
    $candidates = @()
    if ($env:READLOOP_DICT_SOURCE) { $candidates += $env:READLOOP_DICT_SOURCE }
    $candidates += (Join-Path $env:APPDATA 'english-study\data\stardict.db')
    $candidates += 'D:\EnglishStudy\data\stardict.db'

    $source = $null
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c) -and (Get-Item $c).Length -gt 10MB) { $source = $c; break }
    }

    if (-not $source) {
        Warn '未在默认位置找到 stardict.db。'
        Write-Host '    词典下载：https://github.com/skywind3000/ECDICT（下载 stardict.db，约 850MB）' -ForegroundColor Gray
        Write-Host '    下载后放到项目根目录（' +  + '\stardict.db）重新运行 setup，或现在手动选择。' -ForegroundColor Gray
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Title = '选择 ECDICT 的 stardict.db'
        $dialog.Filter = 'SQLite 数据库 (*.db)|*.db|所有文件 (*.*)|*.*'
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            $source = $dialog.FileName
        }
    }

    if (-not $source) {
        Fail '未提供词典。可稍后手动把 stardict.db 复制到：' + $dictTarget
        Warn '没有词典时应用仍可运行，但划词查词不可用。'
    } else {
        Write-Host "    源：$source"
        $size = (Get-Item $source).Length
        Write-Host ("    复制中（{0:N0} MB），请稍候……" -f ($size / 1MB))
        $copied = $false
        for ($attempt = 1; $attempt -le 2 -and -not $copied; $attempt++) {
            try {
                Copy-Item -LiteralPath $source -Destination $dictTarget -Force
                $copied = $true
            } catch {
                Warn "第 $attempt 次复制失败：$($_.Exception.Message)"
                Start-Sleep -Seconds 1
            }
        }
        if ($copied -and (Test-Dict $dictTarget)) {
            Ok '词典复制并校验通过'
            Write-Host '    提示：词典已独立于旧项目，旧项目目录可以删除。' -ForegroundColor DarkGray
        } else {
            Fail '词典复制或校验失败。目标：' + $dictTarget
        }
    }
}

# ---------- 7. 桌面快捷方式 ----------
Step '7/10' '创建桌面快捷方式'
$trayExe = Join-Path $root 'tray\ReadLoopTray.exe'
if (Test-Path $trayExe) {
    try {
        $desktop = [Environment]::GetFolderPath('Desktop')
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut((Join-Path $desktop 'ReadLoop.lnk'))
        $shortcut.TargetPath = $trayExe
        $shortcut.WorkingDirectory = $root
        $shortcut.IconLocation = "$trayExe,0"
        $shortcut.Description = 'ReadLoop 英语精读工作台'
        $shortcut.Save()
        Ok '桌面快捷方式：ReadLoop.lnk'
    } catch {
        Warn "创建快捷方式失败：$($_.Exception.Message)"
    }
} else {
    Warn '托盘程序未生成，跳过快捷方式。'
}

# ---------- 8. README-FIRST ----------
Step '8/10' '生成 README-FIRST.txt'
$readmeFirst = Join-Path $root 'README-FIRST.txt'
$lines = @(
    'ReadLoop 使用说明',
    '================',
    '',
    '启动：双击桌面 ReadLoop（托盘）→ 托盘菜单「打开 ReadLoop」',
    '      或直接运行：tray\ReadLoopTray.exe',
    '',
    '地址：http://127.0.0.1:5178/',
    '数据：' + $dataDir,
    '端口：默认 5178，被占用时托盘自动在 5178-5200 间顺延（配置：tray.json）',
    '',
    '首次使用：打开「设置 → AI 配置」，填 OpenAI 兼容接口的地址、API Key、模型。',
    '词典：' + $dictTarget,
    '',
    '重新安装/升级：再次运行 setup.bat（数据目录不受影响）。',
    '卸载：托盘退出 → 删除项目目录与 ' + $dataDir + '（可选）。'
)
Set-Content -Path $readmeFirst -Value $lines -Encoding UTF8
Ok "已生成 $readmeFirst"

# ---------- 9. 启动 ----------
Step '9/10' '启动托盘'
if (Test-Path $trayExe) {
    $answer = Read-Host '    现在就启动 ReadLoop 托盘吗？(Y/n)'
    if ($answer -eq '' -or $answer -match '^[Yy]') {
        Start-Process -FilePath $trayExe -WorkingDirectory $root
        Ok '已启动托盘（首次启动会自动打开浏览器）'
    } else {
        Warn '已跳过启动，可双击桌面快捷方式。'
    }
} else {
    Warn '托盘不存在，跳过启动。'
}

# ---------- 10. 完成 ----------
Step '10/10' '完成'
Write-Host ''
Write-Host '安装流程结束。' -ForegroundColor Green
Write-Host '  启动：tray\ReadLoopTray.exe 或桌面 ReadLoop 快捷方式' -ForegroundColor Gray
Write-Host '  文档：README.md' -ForegroundColor Gray
Write-Host '  排查：%APPDATA%\readloop\logs\tray.log / server-console.log' -ForegroundColor Gray
Write-Host ''
Read-Host '按回车关闭窗口'

