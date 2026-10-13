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
!define ESHOP_NETWORK_ADDON_INSTALLER "$INSTDIR\resources\network-print-addon\E-Shop-Network-Print-Addon-TEST-0.1.0-commercial-rc.10-x64.exe"
!define ESHOP_NETWORK_ADDON_ROOT "$LOCALAPPDATA\Programs\E-Shop-Network-Print-Addon"
!define ESHOP_NETWORK_ADDON_UNINSTALLER "${ESHOP_NETWORK_ADDON_ROOT}\Uninstall-E-Shop-Network-Print-Addon-TEST-0.1.0-commercial-rc.10-x64.exe"
!define ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY "Software\3b0d00d3-14c9-55d6-bef2-f6474bb2de71"
!define ESHOP_NETWORK_ADDON_UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\3b0d00d3-14c9-55d6-bef2-f6474bb2de71"
!define ESHOP_NETWORK_ADDON_MARKER_KEY "Software\E-Shop\Desktop\NetworkPrintAddon"
!define ESHOP_NETWORK_ADDON_VERSION "0.1.0-commercial-rc.10"

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

!macro eshopCheckNetworkAddonProcess
  ; Run before any Desktop predecessor handoff or Desktop file removal. The
  ; Add-on installer itself refuses a running process; this preflight keeps a
  ; failed Add-on lifecycle from becoming a partial Desktop lifecycle.
  nsProcess::_FindProcess /NOUNLOAD "E-Shop-Network-Print-Addon.exe"
  Pop $R0
  ${If} $R0 == 0
    DetailPrint "Exit E-Shop Network Print Add-on safely before continuing."
    IfSilent +2 0
      MessageBox MB_OK|MB_ICONSTOP "Exit E-Shop Network Print Add-on safely, then retry the installer."
    SetErrorLevel 26
    Quit
  ${ElseIf} $R0 != 603
    DetailPrint "Unable to verify whether E-Shop Network Print Add-on is running. Stopping."
    SetErrorLevel 27
    Quit
  ${EndIf}
!macroend

!macro eshopCheckNetworkAddonInstallState
  !insertmacro eshopCheckNetworkAddonProcess
  ; Mirror the Add-on installer's fail-closed identity checks before the
  ; Desktop predecessor can be removed. An unrelated machine-wide install or
  ; malformed current-user install must never be silently replaced.
  ReadRegStr $R4 HKLM "${ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R4 != ""
    DetailPrint "A machine-wide Network Print Add-on installation is incompatible. Stopping."
    SetErrorLevel 28
    Quit
  ${EndIf}
  ReadRegStr $R4 HKCU "${ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R5 HKCU "${ESHOP_NETWORK_ADDON_UNINSTALL_REGISTRY_KEY}" UninstallString
  ReadRegStr $R6 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" Managed
  ${If} $R4 != ""
  ${OrIf} $R5 != ""
    ${If} $R6 != "true"
      ; A separately installed Add-on is never silently adopted by Desktop.
      ; The merchant must remove that legacy surface before retrying the
      ; single-installer package; this preserves explicit lifecycle ownership.
      DetailPrint "An independently installed Network Print Add-on cannot be adopted. Stopping."
      SetErrorLevel 32
      Quit
    ${EndIf}
    ${If} $R4 != "${ESHOP_NETWORK_ADDON_ROOT}"
    ${OrIf} $R5 == ""
      DetailPrint "The existing Network Print Add-on installation cannot be verified. Stopping."
      SetErrorLevel 29
      Quit
    ${EndIf}
    ReadRegStr $R6 HKCU "${ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY}" KeepShortcuts
    ${If} $R6 != "true"
      DetailPrint "Existing Network Print Add-on shortcut ownership cannot be preserved. Stopping."
      SetErrorLevel 30
      Quit
    ${EndIf}
    IfFileExists "${ESHOP_NETWORK_ADDON_ROOT}\E-Shop-Network-Print-Addon.exe" 0 eshopNetworkAddonProgramMissing
  ${ElseIf} $R6 == "true"
    DetailPrint "The Desktop Add-on ownership marker has no matching installation. Stopping."
    SetErrorLevel 33
    Quit
  ${EndIf}
  Goto eshopNetworkAddonStateChecked
  eshopNetworkAddonProgramMissing:
    DetailPrint "The existing Network Print Add-on program is missing. Stopping."
    SetErrorLevel 31
    Quit
  eshopNetworkAddonStateChecked:
!macroend

!macro eshopPrepareManagedAddonUninstall
  ReadRegStr $R0 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" Managed
  ${If} $R0 == "true"
    ReadRegStr $R1 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" Version
    ${If} $R1 != "${ESHOP_NETWORK_ADDON_VERSION}"
      DetailPrint "The managed Network Print Add-on version is not compatible. Stopping."
      SetErrorLevel 25
      Quit
    ${EndIf}
    !insertmacro eshopCheckNetworkAddonProcess
    IfFileExists "${ESHOP_NETWORK_ADDON_UNINSTALLER}" 0 eshopNetworkAddonUninstallerMissingPreflight
    ClearErrors
    ExecWait '"${ESHOP_NETWORK_ADDON_UNINSTALLER}" /S' $R2
    ${If} ${Errors}
    ${OrIf} $R2 != 0
      DetailPrint "The managed Network Print Add-on uninstall failed with exit code $R2. Stopping."
      SetErrorLevel 22
      Quit
    ${EndIf}
    DeleteRegKey HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}"
    Goto eshopNetworkAddonUninstallPrepared
    eshopNetworkAddonUninstallerMissingPreflight:
      DetailPrint "The managed Network Print Add-on uninstaller is missing. Stopping."
      SetErrorLevel 23
      Quit
  ${EndIf}
  eshopNetworkAddonUninstallPrepared:
!macroend

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
  !insertmacro eshopCheckNetworkAddonInstallState
  StrCpy $eshopDesktopInstallerPhase "install"
!macroend

!macro customUnInit
  SetShellVarContext current
  !insertmacro customCheckAppRunning
  ; Desktop predecessor handoff must not uninstall the Add-on during upgrade;
  ; the new Desktop installer upgrades it in place and preserves its state.
  ${IfNot} ${isUpdated}
    !insertmacro eshopPrepareManagedAddonUninstall
  ${EndIf}
  ; The prior-version uninstaller is copied to the installer's temporary
  ; plugin directory. Release $INSTDIR as the working directory before the
  ; ordinary electron-builder uninstall/removal path runs.
  SetOutPath "$TEMP"
!macroend

!macro customInstall
  ; The merchant-facing package owns the Add-on install. The Add-on remains a
  ; separate runtime process and retains its own state/lifecycle implementation.
  ReadRegStr $R1 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" "Managed"
  ReadRegStr $R2 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" "Version"
  ${If} $R1 == "true"
  ${AndIf} $R2 != "${ESHOP_NETWORK_ADDON_VERSION}"
    DetailPrint "The installed Network Print Add-on version is not compatible. Stopping."
    SetErrorLevel 24
    Quit
  ${EndIf}
  IfFileExists "${ESHOP_NETWORK_ADDON_INSTALLER}" 0 eshopNetworkAddonInstallerMissing
  ClearErrors
  ExecWait '"${ESHOP_NETWORK_ADDON_INSTALLER}" /S' $R0
  ${If} ${Errors}
  ${OrIf} $R0 != 0
    DetailPrint "The bundled Network Print Add-on installer failed with exit code $R0. Stopping."
    SetErrorLevel 20
    Quit
  ${EndIf}
  WriteRegStr HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" "Managed" "true"
  WriteRegStr HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" "Version" "${ESHOP_NETWORK_ADDON_VERSION}"
  WriteRegStr HKCU "${ESHOP_DESKTOP_AUTOSTART_KEY}" "${ESHOP_DESKTOP_AUTOSTART_VALUE}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  Goto eshopNetworkAddonInstallDone
  eshopNetworkAddonInstallerMissing:
    DetailPrint "The bundled Network Print Add-on payload is missing. Stopping."
    SetErrorLevel 21
    Quit
  eshopNetworkAddonInstallDone:
!macroend

!macro customUnInstall
  ; Managed Add-on removal has already completed in customUnInit, before
  ; Desktop files and registration are removed. Independent Add-ons are
  ; intentionally preserved because this marker is absent.
  ${IfNot} ${isUpdated}
    DeleteRegKey HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}"
  ${EndIf}
  DeleteRegValue HKCU "${ESHOP_DESKTOP_AUTOSTART_KEY}" "${ESHOP_DESKTOP_AUTOSTART_VALUE}"
!macroend
