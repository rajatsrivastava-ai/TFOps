@echo off
REM Copy this file to  passwords.cmd  and put real values in it.
REM start-dashboard.cmd picks it up automatically. Do not commit passwords.cmd.

REM The team — can edit everything.
set TFOPS_PASSWORD=change-me-to-something-long

REM Leadership — sees everything, can change nothing. Leave blank to skip.
set TFOPS_VIEW_PASSWORD=change-me-too

REM Set this to 1 only when the board is served over HTTPS (tunnel or host),
REM so session cookies are marked Secure.
REM set TRUST_PROXY=1
