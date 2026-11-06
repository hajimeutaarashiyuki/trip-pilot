@chcp 65001 >nul
@echo off
rem 桌機上手動啟動 Trip Pilot 伺服器（埠 18810）。雙擊就好；關掉視窗就停。平常由開機排程自己啟動，埠被占著時這支起不來。
rem 三件事：手機按「更新」來這裡抓打包檔；http://127.0.0.1:18810/app/ 供應頁面（需求單在 /app/#/brief 填）；
rem 需求單按「提交」會寫成專案 trips 資料夾裡的 .brief.md（這次不想收就在下面那行後面加 --no-briefs）。
cd /d "%~dp0.."
node tools\serve-packs.mjs
pause
