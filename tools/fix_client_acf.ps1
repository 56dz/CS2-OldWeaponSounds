# 把客户端 appworkshop_730.acf 里指定工坊物品的安装登记更新到最新 manifest
# 用法: pwsh -File fix_client_acf.ps1 -Acf <acf路径> -Id 3819498100 -Size 59527285 -TimeUpdated 1792228344 -Manifest 2897890033680368654
param(
    [Parameter(Mandatory=$true)][string]$Acf,
    [Parameter(Mandatory=$true)][string]$Id,
    [Parameter(Mandatory=$true)][string]$Size,
    [Parameter(Mandatory=$true)][string]$TimeUpdated,
    [Parameter(Mandatory=$true)][string]$Manifest
)

$raw = Get-Content $Acf -Raw

function Patch-Section([string]$text, [string]$sectionName, [string]$id, [hashtable]$fields) {
    $secIdx = $text.IndexOf('"' + $sectionName + '"')
    if ($secIdx -lt 0) { throw "找不到段 $sectionName" }
    $idIdx = $text.IndexOf('"' + $id + '"', $secIdx)
    if ($idIdx -lt 0) { throw "在 $sectionName 中找不到物品 $id" }
    # 找该条目块结束（下一个顶层 "数字ID" 或 段结束）
    $braceOpen = $text.IndexOf('{', $idIdx)
    $depth = 0; $end = -1
    for ($i = $braceOpen; $i -lt $text.Length; $i++) {
        $ch = $text[$i]
        if ($ch -eq '{') { $depth++ }
        elseif ($ch -eq '}') { $depth--; if ($depth -eq 0) { $end = $i; break } }
    }
    if ($end -lt 0) { throw "条目块括号不平衡: $id" }
    $block = $text.Substring($idIdx, $end - $idIdx + 1)
    $newBlock = $block
    foreach ($k in $fields.Keys) {
        $v = $fields[$k]
        if ($newBlock -match ('"' + [regex]::Escape($k) + '"\s+"[^"]*"')) {
            $newBlock = $newBlock -replace ('("' + [regex]::Escape($k) + '"\s+)"[^"]*"'), ('$1"' + $v + '"')
        }
    }
    # size 只存在于 Installed 段，若不存在则跳过
    return $text.Substring(0, $idIdx) + $newBlock + $text.Substring($end + 1)
}

$raw = Patch-Section $raw 'WorkshopItemsInstalled' $Id @{
    'size' = $Size
    'timeupdated' = $TimeUpdated
    'manifest' = $Manifest
}

$raw = Patch-Section $raw 'WorkshopItemDetails' $Id @{
    'manifest' = $Manifest
    'timeupdated' = $TimeUpdated
    'latest_timeupdated' = $TimeUpdated
    'latest_manifest' = $Manifest
}

Set-Content -Path $Acf -Value $raw -NoNewline -Encoding utf8
Write-Output "[ok] 已更新 $Id -> manifest $Manifest (size $Size, timeupdated $TimeUpdated)"
