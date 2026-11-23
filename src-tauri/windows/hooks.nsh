; NSIS hooks for the Tauri installer (bundle > windows > nsis > installerHooks).

!macro NSIS_HOOK_POSTUNINSTALL
  ; "Beim Anmelden an Windows starten" (src-tauri/src/autostart.rs).
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Aar"
!macroend
