# 合并系统 PATH，确保 pnpm 等命令可用
$path1 = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$path2 = [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$path1;$path2"

# 确保在项目目录下运行
Set-Location "d:\BOOK\Mizuki"

# 检查 Node.js
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Host "❌ 未找到 Node.js，请确认已安装" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Node $nodeVersion" -ForegroundColor Green

# 确保 content 目录存在（避免 sync-content 警告）
if (-not (Test-Path "content")) {
    Write-Host "📁 创建 content 目录..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path "content" -Force | Out-Null
}

Write-Host "🚀 正在启动开发服务器..." -ForegroundColor Cyan
Write-Host "📍 博客访问: http://127.0.0.1:3000" -ForegroundColor Cyan
Write-Host "📸 相册上传: http://localhost:3456" -ForegroundColor Cyan
Write-Host ""

# 后台启动相册上传工具
$uploadJob = Start-Job -ScriptBlock {
    Set-Location "d:\BOOK\Mizuki"
    $path1 = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $path2 = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$path1;$path2"
    node scripts/upload-server.js
}

pnpm dev

# 关闭博客时同时关闭上传工具
Stop-Job $uploadJob -ErrorAction SilentlyContinue
Remove-Job $uploadJob -ErrorAction SilentlyContinue
