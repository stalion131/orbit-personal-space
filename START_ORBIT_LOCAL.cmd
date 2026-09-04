@echo off
cd /d "%~dp0"
start "" /b powershell -WindowStyle Hidden -NoProfile -Command "$orbitUrl='http://localhost:3000/work'; for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing $orbitUrl -TimeoutSec 1 | Out-Null; Start-Process $orbitUrl; exit}catch{Start-Sleep -Seconds 1}}"
npm run dev -- --hostname 127.0.0.1
