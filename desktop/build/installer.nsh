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

!ifndef BUILD_UNINSTALLER
Var /GLOBAL eshopDesktopInstallerPhase
Var /GLOBAL eshopPriorUninstallHandled

; The custom include is expanded before electron-builder's installUtil.nsh, so
; its GetInQuotes helper is not available to customInit. Keep a private,
; equivalent parser here to validate the registered predecessor path without
; weakening the fail-closed identity check.
Function eshopGetQuotedPath
  Exch $R0
  Push $R1
  Push $R2
  Push $R3

  StrCpy $R2 -1
  IntOp $R2 $R2 + 1
  StrCpy $R3 $R0 1 $R2
  StrCmp $R3 "" 0 +3
  StrCpy $R0 ""
  Goto eshopGetQuotedPathDone
  StrCmp $R3 '"' 0 -5

  IntOp $R2 $R2 + 1
  StrCpy $R0 $R0 "" $R2

  StrCpy $R2 0
  IntOp $R2 $R2 + 1
  StrCpy $R3 $R0 1 $R2
  StrCmp $R3 "" 0 +3
  StrCpy $R0 ""
  Goto eshopGetQuotedPathDone
  StrCmp $R3 '"' 0 -5

  StrCpy $R0 $R0 $R2
  eshopGetQuotedPathDone:

  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

!macro eshopGetQuotedPath Var Str
  Push "${Str}"
  Call eshopGetQuotedPath
  Pop "${Var}"
!macroend

!macro eshopUninstallPriorVersion
  StrCpy $eshopPriorUninstallHandled "1"

  ; Do not execute the registered predecessor uninstaller. A predecessor built
  ; before this lifecycle fix can have an invalid embedded CRC and still be
  ; registered successfully. Use this Candidate's CRC-verified uninstaller for
  ; the same appId instead, while retaining AppData through --updated.
  ClearErrors
  ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R2 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $R1 != ""
  ${OrIf} $R2 != ""
    !insertmacro eshopGetQuotedPath $R3 "$R2"
    ${If} $R1 == ""
    ${OrIf} $R2 == ""
    ${OrIf} $R3 != "$R1\${UNINSTALL_FILENAME}"
    ${OrIfNot} ${FileExists} "$R1\${APP_EXECUTABLE_FILENAME}"
    ${OrIfNot} ${FileExists} "$R3"
      DetailPrint "The prior E-Shop Desktop installation cannot be verified. Stopping."
      SetErrorLevel 4
      Quit
    ${EndIf}

    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File /oname=eshop-current-uninstaller.exe "${UNINSTALLER_OUT_FILE}"
    SetOutPath "$TEMP"
    ExecWait '"$PLUGINSDIR\eshop-current-uninstaller.exe" /S /KEEP_APP_DATA /currentuser --keep-shortcuts --updated _?=$R1' $R0
    ${If} $R0 != 0
      DetailPrint "The verified prior-version uninstall handoff failed with exit code $R0."
      SetErrorLevel 5
      Quit
    ${EndIf}

    ReadRegStr $R4 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R4 != ""
      DetailPrint "The prior E-Shop Desktop installation remained registered. Stopping."
      SetErrorLevel 5
      Quit
    ${EndIf}
  ${EndIf}
!macroend
!endif

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

  !ifndef BUILD_UNINSTALLER
    ${If} $eshopDesktopInstallerPhase == "install"
    ${AndIf} $eshopPriorUninstallHandled != "1"
      !insertmacro eshopUninstallPriorVersion
    ${EndIf}
  !endif
!macroend

!macro customInit
  SetShellVarContext current
  StrCpy $eshopDesktopInstallerPhase "init"
  !insertmacro customCheckAppRunning
  StrCpy $eshopDesktopInstallerPhase "install"
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
