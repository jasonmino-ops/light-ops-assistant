; E-Shop Desktop is a current-user installation. Upgrades must never replace
; files while the exact Desktop executable is running, and must never force
; terminate the application. The operator exits through the normal tray path.

; electron-builder 25 writes the embedded uninstaller and then patches its
; icon. Keep both icons byte-compatible so that patching cannot invalidate the
; embedded uninstaller's NSIS CRC.
!define /ifndef MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define /ifndef MUI_UNICON "${MUI_ICON}"
!if "${MUI_ICON}" != "${MUI_UNICON}"
  !error "E-Shop Desktop requires matching installer/uninstaller icons"
!endif

!define ESHOP_DESKTOP_AUTOSTART_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define ESHOP_DESKTOP_AUTOSTART_VALUE "E-Shop Desktop"

!macro customCheckAppRunning
  ; This macro replaces electron-builder's tasklist/find + taskkill fallback.
  ; nsProcess result 0 means running and 603 means verified absence. Any other
  ; result fails closed rather than risking an in-use upgrade.
  nsProcess::_FindProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
  Pop $R0
  ${If} $R0 == 0
    DetailPrint "Exit E-Shop Desktop safely before continuing."
    IfSilent +2 0
      MessageBox MB_OK|MB_ICONSTOP "Exit E-Shop Desktop from its tray menu, then retry the installer."
    SetErrorLevel 2
    Quit
  ${ElseIf} $R0 != 603
    DetailPrint "Unable to verify whether E-Shop Desktop is running. Stopping."
    SetErrorLevel 3
    Quit
  ${EndIf}
!macroend

!macro customInit
  SetShellVarContext current
  !insertmacro customCheckAppRunning
!macroend

!macro customUnInit
  SetShellVarContext current
  !insertmacro customCheckAppRunning
  ; The prior-version uninstaller is copied to the installer's temporary
  ; plugin directory. Release $INSTDIR as the working directory before the
  ; ordinary electron-builder uninstall/removal path runs.
  SetOutPath "$TEMP"
!macroend

!macro customInstall
  WriteRegStr HKCU "${ESHOP_DESKTOP_AUTOSTART_KEY}" "${ESHOP_DESKTOP_AUTOSTART_VALUE}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "${ESHOP_DESKTOP_AUTOSTART_KEY}" "${ESHOP_DESKTOP_AUTOSTART_VALUE}"
!macroend
