@echo off
cd /d "%~dp0"
start "" powershell -NoProfile -Command "$url='http://127.0.0.1:3000/work'; for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 1 | Out-Null; Start-Process $url; exit}catch{Start-Sleep -Seconds 1}}"
npm run dev
