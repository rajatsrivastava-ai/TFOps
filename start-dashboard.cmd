@echo off
title TFOps dashboard
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed, or not on PATH.
  echo Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "data\store.json" (
  echo First run - building the board from PodLoadBoard.html...
  node lib\seed.js
)

REM Passwords. Leave these blank to run open on your own machine or a trusted
REM LAN; fill them in before the board is reachable from outside the office.
REM   TFOPS_PASSWORD       - the team, can edit
REM   TFOPS_VIEW_PASSWORD  - leadership, read-only
if exist "passwords.cmd" call passwords.cmd

echo.
echo Starting TFOps. Leave this window open; close it to stop the board.
echo.
start "" http://localhost:8848
node server.js
pause
