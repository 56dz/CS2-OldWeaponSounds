# 把 addon 需要的目录加入 CS2 gameinfo.gi 的 AddonConfig -> VpkDirectories 打包白名单
# 由 fix-gameinfo-weapons.cmd 调用；也可直接右键“使用 PowerShell 运行”
#
# 背景：
#   AddonConfig/VpkDirectories 是创意工坊工具的 addon 打包白名单
#   （已确认由 game/bin/win64/tools/cs2_workshop_manager.dll 的 VPK 打包路径解析）。
#   不在白名单里的目录不会被写进发布的 addon VPK —— 表现为
#   “发布出来的 item 只有 26 MiB，而不是 ~1.4 GB”。
#
#   需要白名单的目录（本 addon 实际包含、且默认不在白名单里的）：
#     weapons     -> weapons/**（89 个武器皮肤模型，占体积绝大部分）
#     characters  -> characters/**（2846 个僵尸/角色模型）
#     agents      -> agents/**（981 个 agent 模型）
#
#   脚本是幂等的：已存在的条目不会重复添加，多余内容不会改动。
#
# 注意：游戏更新 / Steam 校验文件会还原 gameinfo.gi，届时重跑本脚本即可。
#       运行前请先【完全关闭 CS2 创意工坊工具 / CS2】，否则文件被占用无法写入。
$ErrorActionPreference = 'Stop'

$gi = 'D:\Program Files\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\gameinfo.gi'
$required = @('weapons', 'characters', 'agents')

if (-not (Test-Path -LiteralPath $gi)) {
    Write-Host "[错误] 找不到文件: $gi" -ForegroundColor Red
    exit 1
}

try {
    $bytes = [IO.File]::ReadAllBytes($gi)
} catch {
    Write-Host "[错误] 无法读取（可能被创意工坊工具占用）: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "       请先完全关闭 CS2 创意工坊工具再重试。" -ForegroundColor Yellow
    exit 1
}

# 去 BOM（引擎的 kv3 解析器不保证容忍 BOM）
$hadBom = $false
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $hadBom = $true
    $bytes = $bytes[3..($bytes.Length - 1)]
}

$text  = [Text.Encoding]::UTF8.GetString($bytes)
$nl    = if ($text -match "`r`n") { "`r`n" } else { "`n" }
$lines = $text -split "`r`n|`n"

# 计算还缺哪些
$missing = @()
foreach ($d in $required) {
    if ($text -notmatch ('(?m)^\s*"include"\s+"' + [regex]::Escape($d) + '"\s*$')) {
        $missing += $d
    }
}

if ($missing.Count -eq 0) {
    Write-Host "[OK] 白名单已完整（$($required -join ', ')），无需修改。" -ForegroundColor Green
    if ($hadBom) { Write-Host "[提示] 文件带 BOM，但白名单已完整，未改动。" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "现在的 VpkDirectories：" -ForegroundColor Cyan
    (Get-Content -LiteralPath $gi) | Select-String -Pattern '"include"|"exclude"' | ForEach-Object { "  " + $_.Line.Trim() }
    exit 0
}

Write-Host "[信息] 需要补充的条目: $($missing -join ', ')" -ForegroundColor Yellow
$bomNote = if ($hadBom) { '（已去 BOM）' } else { '（UTF-8 无 BOM）' }

$out     = New-Object System.Collections.Generic.List[string]
$insert  = $false
$added   = @()
foreach ($l in $lines) {
    $out.Add($l)
    if (-not $insert -and $l -match '^\s*"include"\s+"models"\s*$') {
        # 保持与原文件一致的缩进：3 个制表符 + "include" + 7 空格 + 值
        foreach ($d in $missing) {
            $out.Add("`t`t`t`"include`"       `"$d`"")
            $added += $d
        }
        $insert = $true
    }
}

if (-not $insert) {
    Write-Host "[错误] 未找到 models 白名单行，gameinfo.gi 结构可能已变化。" -ForegroundColor Red
    Write-Host "       请手动在 VpkDirectories 块中加入：" -ForegroundColor Yellow
    foreach ($d in $missing) { Write-Host ('           "include"       "' + $d + '"') -ForegroundColor Yellow }
    exit 2
}

try {
    [IO.File]::WriteAllText($gi, ($out -join $nl), (New-Object Text.UTF8Encoding($false)))
} catch {
    Write-Host "[错误] 无法写入（可能被占用）: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "       请先完全关闭 CS2 创意工坊工具再重试。" -ForegroundColor Yellow
    exit 1
}

Write-Host "[DONE] 已写入白名单条目: $($added -join ', ')$bomNote" -ForegroundColor Green
Write-Host ""
Write-Host "现在的 VpkDirectories：" -ForegroundColor Cyan
(Get-Content -LiteralPath $gi) | Select-String -Pattern '"include"|"exclude"' | ForEach-Object { "  " + $_.Line.Trim() }
exit 0
