@echo off
REM Registers the VACSO PM2 fleet from the clean ecosystem config and persists it.
REM Run this HIDDEN (via pm2-windows-startup's invisible.vbs) after `pm2 kill`, so the
REM daemon is never attached to an interactive console and children get no windows.
call pm2 start "C:\Users\oscar\Projects\vacso-ops\pm2\ecosystem.config.js"
call pm2 save --force
