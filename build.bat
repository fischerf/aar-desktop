@echo off
rem Baut Aar Desktop neu: mitgelieferte aar-Laufzeit (aus B:\Github_my\aar) + App + Installer.
rem Gebaut wird in der WSL-VM Ubuntu-aarui (scripts\wsl\build.sh); Ergebnis in dist\.
rem
rem   build.bat            aar-Laufzeit + Setup neu bauen
rem   build.bat --fast     nur App + Setup (aar-Laufzeit vom letzten Mal wiederverwenden)
rem   build.bat --debug    Debug-Build (mit Konsole); weitere Optionen gehen an build.sh
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set WSL_UTF8=1
set DISTRO=Ubuntu-aarui

rem ARGS beginnt mit einem Leerzeichen: build.sh!ARGS!
set "ARGS= --python"
for %%X in (%*) do (
  if /i "%%~X"=="--fast" (set "ARGS=!ARGS: --python=!") else (set "ARGS=!ARGS! %%~X")
)

rem Laufende App oder Installer sperren die Dateien in dist\ - dann wuerde nichts ueberschrieben.
tasklist /fi "imagename eq aar-desktop.exe" | find /i "aar-desktop.exe" >nul && (
  echo [FEHLER] Aar Desktop laeuft noch. Bitte beenden ^(Tray-Symbol - Beenden^) und erneut starten.
  goto :fail
)
tasklist | find /i "_x64-setup.exe" >nul && (
  echo [FEHLER] Ein Aar-Installer laeuft noch. Bitte erst beenden.
  goto :fail
)

wsl -l -q | find "%DISTRO%" >nul || (
  echo [FEHLER] WSL-VM %DISTRO% nicht gefunden. Einmalig einrichten:
  echo     wsl -d %DISTRO% -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/setup-dev.sh
  goto :fail
)

echo ==^> Baue in WSL ^(%DISTRO%^): build.sh!ARGS!
echo     Quelle aar: B:\Github_my\aar  -  mit --python etwa 5-10 Minuten
echo.
wsl -d %DISTRO% -u root -- bash /mnt/b/Github_my/aar_ui/scripts/wsl/build.sh!ARGS!
if errorlevel 1 goto :fail

echo.
echo ==^> Fertig:
dir /o-d dist\aar-desktop.exe dist\Aar_*_x64-setup.exe 2>nul | findstr /i "\.exe"
echo.
echo Installer: dist\Aar_^<version^>_x64-setup.exe   ^(still: /S^)
echo Testen in der Windows Sandbox: powershell -ExecutionPolicy Bypass -File scripts\sandbox\run.ps1
endlocal
exit /b 0

:fail
echo.
echo Build fehlgeschlagen oder abgebrochen.
endlocal
pause
exit /b 1
