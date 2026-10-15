@echo off
chcp 65001 >nul
setlocal
REM ============================================================
REM  发布 CS2 addon 前运行本脚本：把 addon 需要的目录加入 VPK 打包白名单
REM
REM  原因：gameinfo.gi 的 AddonConfig -> VpkDirectories 是 addon 打包白名单
REM        （由 cs2_workshop_manager.dll 的 VPK 打包路径解析），
REM        默认没有 weapons / characters / agents，导致这些目录不会被打进
REM        addon VPK（表现为发布出来的 item 只有 26 MiB，而不是 ~1.4 GB）。
REM        本脚本会幂等地补齐 weapons、characters、agents 三个条目。
REM
REM  注意：游戏更新 / Steam 校验文件会还原 gameinfo.gi，届时重跑本脚本即可。
REM        运行前请先【完全关闭 CS2 创意工坊工具】，否则文件被占用无法写入。
REM ============================================================

set "GI=D:\Program Files\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\gameinfo.gi"

if not exist "%GI%" (
  echo [错误] 找不到 gameinfo.gi:
  echo        %GI%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-gameinfo-weapons.ps1"

echo.
pause
