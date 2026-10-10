@chcp 65001 >nul
@echo off
rem 桌機上啟動打包檔伺服器（手機按「更新」來這裡抓）。雙擊就好；關掉視窗就停。
cd /d "%~dp0.."
node tools\serve-packs.mjs
pause
