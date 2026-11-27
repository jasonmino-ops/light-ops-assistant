; E-Shop Desktop preserves its detected current-user or all-users context.
; Upgrades must never replace
; files while the exact Desktop executable is running, and must never force
; terminate the application. The operator exits through the normal tray path.

; electron-builder expands this custom include before its standard NSIS
; includes. Load LogicLib here because the managed Add-on safe-exit function
; uses the fail-closed ${If}/${ElseIf} predicates during parsing.
!include LogicLib.nsh
!include x64.nsh

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
!define ESHOP_NETWORK_ADDON_INSTALLER "$INSTDIR\resources\network-print-addon\E-Shop-Network-Print-Addon-TEST-0.1.0-commercial-rc.15-x64.exe"
!define ESHOP_NETWORK_ADDON_ROOT "$LOCALAPPDATA\Programs\E-Shop-Network-Print-Addon"
!define ESHOP_NETWORK_ADDON_UNINSTALLER "${ESHOP_NETWORK_ADDON_ROOT}\Uninstall E-Shop-Network-Print-Addon.exe"
!define ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY "Software\3b0d00d3-14c9-55d6-bef2-f6474bb2de71"
!define ESHOP_NETWORK_ADDON_UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\3b0d00d3-14c9-55d6-bef2-f6474bb2de71"
!define ESHOP_NETWORK_ADDON_MARKER_KEY "Software\E-Shop\Desktop\NetworkPrintAddon"
!define ESHOP_NETWORK_ADDON_VERSION "0.1.0-commercial-rc.15"
; Separate from builder's registration: --updated removes that registration
; before replacement, but must not release ownership of the per-user effects.
!define ESHOP_DESKTOP_OWNER_KEY "Software\E-Shop\Desktop\LifecycleOwner"

Var /GLOBAL eshopInteractiveUserVerified
Var /GLOBAL eshopInteractiveUserSid
Var /GLOBAL eshopMachineKeyStatus

; Reject presence AND unreadable state, including partial/empty registrations.
; Both registry views matter even though this package itself is native x64.
!macro eshopRejectMachineKey key view
  System::Store S
  StrCpy $0 0
  StrCpy $1 -1
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000002, w "${key}", i 0, i ${view}, *p.r0) i.r1'
  StrCpy $eshopMachineKeyStatus $1
  ${If} $1 == 0
  ${AndIf} $0 != 0
    System::Call 'advapi32::RegCloseKey(p r0)'
  ${EndIf}
  System::Store L
  ${If} $eshopMachineKeyStatus != 2
  ${AndIf} $eshopMachineKeyStatus != 3
    DetailPrint "A machine-wide installation or unreadable registration is incompatible with this current-user package. Nothing was replaced."
    SetErrorLevel 46
    Quit
  ${EndIf}
!macroend

!macro eshopVerifyCurrentUserScope
  ${IfNot} ${IsNativeAMD64}
    DetailPrint "This package requires native Windows x64. Stopping."
    SetErrorLevel 45
    Quit
  ${EndIf}
  ${If} ${UAC_IsInnerInstance}
    SetErrorLevel 37
    Quit
  ${EndIf}
  !insertmacro eshopRequireUnelevatedLifecycle
  ; Use the same parameter parser as the builder's isForAllUsers predicate.
  ${StdUtils.TestParameter} $R0 "allusers"
  ${If} $R0 != "false"
    DetailPrint "This package supports current-user installation only. Stopping."
    SetErrorLevel 44
    Quit
  ${EndIf}
  !insertmacro eshopRejectMachineKey "${INSTALL_REGISTRY_KEY}" 0x20119
  !insertmacro eshopRejectMachineKey "${UNINSTALL_REGISTRY_KEY}" 0x20119
  !insertmacro eshopRejectMachineKey "${ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY}" 0x20119
  !insertmacro eshopRejectMachineKey "${ESHOP_NETWORK_ADDON_UNINSTALL_REGISTRY_KEY}" 0x20119
  !insertmacro eshopRejectMachineKey "${ESHOP_DESKTOP_OWNER_KEY}" 0x20119
  !insertmacro eshopRejectMachineKey "${INSTALL_REGISTRY_KEY}" 0x20219
  !insertmacro eshopRejectMachineKey "${UNINSTALL_REGISTRY_KEY}" 0x20219
  !insertmacro eshopRejectMachineKey "${ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY}" 0x20219
  !insertmacro eshopRejectMachineKey "${ESHOP_NETWORK_ADDON_UNINSTALL_REGISTRY_KEY}" 0x20219
  !insertmacro eshopRejectMachineKey "${ESHOP_DESKTOP_OWNER_KEY}" 0x20219
!macroend

!macro preInit
  !ifndef BUILD_UNINSTALLER
    !insertmacro eshopVerifyCurrentUserScope
  !endif
!macroend

!macro customInstallMode
  !insertmacro eshopVerifyCurrentUserScope
  StrCpy $isForceCurrentInstall "1"
!macroend

; A shell-context switch does not change HKCU or the process token. Only the
; actual interactive user's token may own the per-user Add-on and Run value.
; Refuse missing shells, another session, another account and unreadable tokens.
!macro eshopInteractiveUserFunction prefix
Function ${prefix}eshopCheckInteractiveUser
  System::Store S
  StrCpy $eshopInteractiveUserVerified "0"
  StrCpy $eshopInteractiveUserSid ""
  StrCpy $0 0
  StrCpy $1 0
  StrCpy $2 0
  StrCpy $3 0
  StrCpy $5 0
  System::Call 'user32::GetShellWindow() p.r6'
  StrCmp $6 0 eshopUserDone
  System::Call 'user32::GetWindowThreadProcessId(p r6, *i.r7) i.r8'
  StrCmp $8 0 eshopUserDone
  StrCmp $7 0 eshopUserDone
  System::Call 'kernel32::ProcessIdToSessionId(i r7, *i.r4) i.r8'
  StrCmp $8 0 eshopUserDone
  System::Call 'kernel32::GetCurrentProcessId() i.r8'
  System::Call 'kernel32::ProcessIdToSessionId(i r8, *i.r9) i.r8'
  StrCmp $8 0 eshopUserDone
  StrCmp $4 $9 0 eshopUserDone
  System::Call 'kernel32::WTSGetActiveConsoleSessionId() i.r8'
  StrCmp $8 -1 eshopUserDone
  StrCmp $4 $8 0 eshopUserDone
  System::Call 'kernel32::OpenProcess(i 0x1000, i 0, i r7) p.r0'
  StrCmp $0 0 eshopUserDone
  System::Call 'advapi32::OpenProcessToken(p r0, i 8, *p.r1) i.r8'
  StrCmp $8 0 eshopUserDone
  System::Alloc 256
  Pop $2
  StrCmp $2 0 eshopUserDone
  System::Alloc 256
  Pop $3
  StrCmp $3 0 eshopUserDone
  System::Call 'advapi32::GetTokenInformation(p r1, i 1, p r2, i 256, *i.r9) i.r8'
  StrCmp $8 0 eshopUserDone
  System::Call 'kernel32::GetCurrentProcess() p.r4'
  System::Call 'advapi32::OpenProcessToken(p r4, i 8, *p.r5) i.r8'
  StrCmp $8 0 eshopUserDone
  System::Call 'advapi32::GetTokenInformation(p r5, i 1, p r3, i 256, *i.r9) i.r8'
  StrCmp $8 0 eshopUserDone
  System::Call '*$2(p.r6)'
  System::Call '*$3(p.r7)'
  System::Call 'advapi32::IsValidSid(p r6) i.r8'
  StrCmp $8 0 eshopUserDone
  System::Call 'advapi32::IsValidSid(p r7) i.r8'
  StrCmp $8 0 eshopUserDone
  System::Call 'advapi32::EqualSid(p r6, p r7) i.r8'
  StrCmp $8 0 eshopUserDone
  StrCpy $9 0
  System::Call 'advapi32::ConvertSidToStringSidW(p r7, *p.r9) i.r8'
  StrCmp $8 0 eshopUserDone
  StrCmp $9 0 eshopUserDone
  System::Call '*$9(&w${NSIS_MAX_STRLEN}.r8)'
  StrCpy $eshopInteractiveUserSid $8
  System::Call 'kernel32::LocalFree(p r9)'
  StrCmp $eshopInteractiveUserSid "" eshopUserDone
  StrCpy $eshopInteractiveUserVerified "1"
  eshopUserDone:
  ${If} $5 != 0
    System::Call 'kernel32::CloseHandle(p r5)'
  ${EndIf}
  ${If} $1 != 0
    System::Call 'kernel32::CloseHandle(p r1)'
  ${EndIf}
  ${If} $0 != 0
    System::Call 'kernel32::CloseHandle(p r0)'
  ${EndIf}
  System::Free $2
  System::Free $3
  System::Store L
FunctionEnd
!macroend
!ifdef BUILD_UNINSTALLER
  !insertmacro eshopInteractiveUserFunction "un."
!else
  !insertmacro eshopInteractiveUserFunction ""
!endif

!macro eshopVerifyInteractiveUser
  !ifdef BUILD_UNINSTALLER
    Call un.eshopCheckInteractiveUser
  !else
    Call eshopCheckInteractiveUser
  !endif
  ${If} $eshopInteractiveUserVerified != "1"
    DetailPrint "Installer account must match the interactive Windows user. Installation stopped."
    SetErrorLevel 36
    Quit
  ${EndIf}
!macroend

!macro eshopVerifyMachineOwner
  ; No adoption of historical machine installs with unknown per-user owner.
  ; HKLM is administrator-controlled, never populated from an HKCU marker.
  ReadRegStr $R0 HKLM "${ESHOP_DESKTOP_OWNER_KEY}" OwnerSid
  ReadRegStr $R3 HKLM "${ESHOP_DESKTOP_OWNER_KEY}" DesktopPath
  ${If} $R0 != ""
  ${OrIf} $R3 != ""
    ${If} $installMode != "all"
    ${OrIf} $R0 != "$eshopInteractiveUserSid"
    ${OrIf} $R3 != "$INSTDIR"
      DetailPrint "The machine Desktop belongs to another or unverifiable Windows owner. Stopping."
      SetErrorLevel 42
      Quit
    ${EndIf}
  ${ElseIf} $installMode == "all"
    ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ReadRegStr $R3 HKLM "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${If} $R0 != ""
    ${OrIf} $R3 != ""
      DetailPrint "This legacy machine Desktop has no verified owner SID. Explicit recovery review is required."
      SetErrorLevel 42
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro eshopRequireUnelevatedLifecycle
  ; ExecWait inherits this token. Neither matching SID, Managed=true, CRC,
  ; version nor a user-writable path proves code is safe to run elevated.
  ; The existing async ExecShellAsUser helper cannot supply child exit status.
  ; Until a separately reviewed synchronous route exists, fail BEFORE effects.
  ${If} ${UAC_IsAdmin}
    DetailPrint "Elevated combined Desktop/Add-on maintenance is blocked. Run current-user maintenance without elevation."
    SetErrorLevel 43
    Quit
  ${EndIf}
!macroend

!macro eshopRestoreDesktopContext
  ${If} $installMode == "all"
    SetShellVarContext all
  ${ElseIf} $installMode == "CurrentUser"
    SetShellVarContext current
  ${Else}
    SetErrorLevel 7
    Quit
  ${EndIf}
!macroend

!macro eshopVerifyInstallContext
  !insertmacro eshopVerifyCurrentUserScope
  ${If} $installMode != "CurrentUser"
    DetailPrint "An unsupported Desktop installation context was selected. Stopping."
    SetErrorLevel 44
    Quit
  ${EndIf}
  !insertmacro eshopVerifyInteractiveUser
  ; initMultiUser owns mode selection and normal Windows elevation. Never
  ; migrate an existing installation to another hive, even via CLI switches.
  ReadRegStr $R5 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R6 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ReadRegStr $R7 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R8 HKLM "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $R5 != ""
  ${OrIf} $R6 != ""
    ${If} $R7 != ""
    ${OrIf} $R8 != ""
      DetailPrint "Conflicting E-Shop Desktop installation registrations. Stopping."
      SetErrorLevel 6
      Quit
    ${EndIf}
  ${EndIf}

  ${If} $installMode == "all"
    ${IfNot} ${UAC_IsAdmin}
      DetailPrint "Start this installer already elevated as the same interactive Windows account."
      SetErrorLevel 8
      Quit
    ${EndIf}
    SetShellVarContext all
    ${If} $R5 != ""
    ${OrIf} $R6 != ""
      DetailPrint "The registered Desktop installation is current-user. Stopping."
      SetErrorLevel 7
      Quit
    ${EndIf}
  ${ElseIf} $installMode == "CurrentUser"
    SetShellVarContext current
    ${If} $R7 != ""
    ${OrIf} $R8 != ""
      DetailPrint "The registered Desktop installation is all-users. Stopping."
      SetErrorLevel 7
      Quit
    ${EndIf}
  ${Else}
    DetailPrint "The Desktop installation context is unknown. Stopping."
    SetErrorLevel 7
    Quit
  ${EndIf}

  ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R2 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $R1 != ""
  ${OrIf} $R2 != ""
    ${If} $R1 == ""
    ${OrIf} $R2 == ""
    ${OrIf} $R1 != "$INSTDIR"
      DetailPrint "The existing Desktop context or installation path cannot be preserved. Stopping."
      SetErrorLevel 4
      Quit
    ${EndIf}
  ${ElseIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    DetailPrint "An unregistered Desktop installation already occupies this path. Stopping."
    SetErrorLevel 4
    Quit
  ${EndIf}

  ; The frozen lifecycle owns one HKCU Run value, never a second machine Run.
  ReadRegStr $R9 HKLM "${ESHOP_DESKTOP_AUTOSTART_KEY}" "${ESHOP_DESKTOP_AUTOSTART_VALUE}"
  ${If} $R9 != ""
    DetailPrint "An unexpected machine Desktop auto-start entry requires review. Stopping."
    SetErrorLevel 6
    Quit
  ${EndIf}
  !insertmacro eshopVerifyMachineOwner
  ClearErrors
!macroend

!ifndef BUILD_UNINSTALLER
Var /GLOBAL eshopDesktopInstallerPhase
Var /GLOBAL eshopPriorUninstallHandled
Var /GLOBAL eshopAddonPrepared
Var /GLOBAL eshopInstallerSha256

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
  !insertmacro eshopRequireUnelevatedLifecycle
  StrCpy $eshopPriorUninstallHandled "1"

  ; Do not execute the registered predecessor uninstaller. A predecessor built
  ; before this lifecycle fix can have an invalid embedded CRC and still be
  ; registered successfully. Use this Candidate's CRC-verified uninstaller for
  ; the same appId instead, while retaining AppData through --updated.
  ClearErrors
  ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R2 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
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

    ${If} $installMode == "all"
      ${IfNot} ${UAC_IsAdmin}
        DetailPrint "A machine Desktop upgrade requires normal administrator elevation. Stopping."
        SetErrorLevel 8
        Quit
      ${EndIf}
      StrCpy $R6 "/allusers"
    ${Else}
      StrCpy $R6 "/currentuser"
    ${EndIf}

    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File /oname=eshop-current-uninstaller.exe "${UNINSTALLER_OUT_FILE}"
    SetOutPath "$TEMP"
    ExecWait '"$PLUGINSDIR\eshop-current-uninstaller.exe" /S /KEEP_APP_DATA $R6 --keep-shortcuts --updated _?=$R1' $R0
    ${If} $R0 != 0
      DetailPrint "The verified prior-version uninstall handoff failed with exit code $R0."
      SetErrorLevel 5
      Quit
    ${EndIf}

    ReadRegStr $R4 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ReadRegStr $R5 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${If} $R4 != ""
    ${OrIf} $R5 != ""
      DetailPrint "The prior E-Shop Desktop installation remained registered. Stopping."
      SetErrorLevel 5
      Quit
    ${EndIf}
  ${EndIf}
  ; Generic builder fallback must see no competing or recreated registration.
  !insertmacro eshopVerifyInstallContext
!macroend
!endif

!macro eshopRequestManagedAddonExit id
  !insertmacro eshopRequireUnelevatedLifecycle
  !define ESHOP_MANAGED_ADDON_EXIT_ID ${id}
  ; The only permitted process replacement path is the Add-on's existing
  ; Electron safeExit/stopAndWait lifecycle. Unknown or unverifiable installs
  ; remain fail-closed and are never sent a maintenance command.
  nsProcess::_FindProcess /NOUNLOAD "E-Shop-Network-Print-Addon.exe"
  Pop $R0
  ${If} $R0 == 603
    Goto eshopNetworkAddonExitDone_${ESHOP_MANAGED_ADDON_EXIT_ID}
  ${ElseIf} $R0 != 0
    DetailPrint "Unable to verify whether E-Shop Network Print Add-on is running. Stopping."
    SetErrorLevel 27
    Quit
  ${EndIf}
  ReadRegStr $R1 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" Managed
  ${If} $R1 != "true"
    DetailPrint "A running unmanaged Network Print Add-on cannot be safely replaced. Stopping."
    IfSilent +2 0
      MessageBox MB_OK|MB_ICONSTOP "The Network Print Add-on is running but is not verified as Desktop-managed. Nothing was replaced."
    SetErrorLevel 26
    Quit
  ${EndIf}
  IfFileExists "${ESHOP_NETWORK_ADDON_ROOT}\E-Shop-Network-Print-Addon.exe" 0 eshopNetworkAddonExitMissing_${ESHOP_MANAGED_ADDON_EXIT_ID}
  ClearErrors
  ExecWait '"${ESHOP_NETWORK_ADDON_ROOT}\E-Shop-Network-Print-Addon.exe" --installer-upgrade' $R2
  ${If} ${Errors}
  ${OrIf} $R2 != 0
    DetailPrint "The managed Network Print Add-on did not accept the safe-exit request. Stopping."
    SetErrorLevel 27
    Quit
  ${EndIf}
  StrCpy $R3 0
  eshopNetworkAddonExitWait_${ESHOP_MANAGED_ADDON_EXIT_ID}:
    nsProcess::_FindProcess /NOUNLOAD "E-Shop-Network-Print-Addon.exe"
    Pop $R0
    ${If} $R0 == 603
      Goto eshopNetworkAddonExitDone_${ESHOP_MANAGED_ADDON_EXIT_ID}
    ${ElseIf} $R0 != 0
      DetailPrint "Unable to verify Network Print Add-on exit. Stopping."
      SetErrorLevel 27
      Quit
    ${EndIf}
    IntCmp $R3 120 eshopNetworkAddonExitTimeout_${ESHOP_MANAGED_ADDON_EXIT_ID} eshopNetworkAddonExitSleep_${ESHOP_MANAGED_ADDON_EXIT_ID} eshopNetworkAddonExitTimeout_${ESHOP_MANAGED_ADDON_EXIT_ID}
  eshopNetworkAddonExitSleep_${ESHOP_MANAGED_ADDON_EXIT_ID}:
    Sleep 250
    IntOp $R3 $R3 + 1
    Goto eshopNetworkAddonExitWait_${ESHOP_MANAGED_ADDON_EXIT_ID}
  eshopNetworkAddonExitTimeout_${ESHOP_MANAGED_ADDON_EXIT_ID}:
    DetailPrint "The managed Network Print Add-on did not exit safely before timeout. Stopping."
    IfSilent +2 0
      MessageBox MB_OK|MB_ICONSTOP "The Network Print Add-on could not finish safely. Nothing was replaced."
    SetErrorLevel 27
    Quit
  eshopNetworkAddonExitMissing_${ESHOP_MANAGED_ADDON_EXIT_ID}:
    DetailPrint "The managed Network Print Add-on executable is missing. Stopping."
    SetErrorLevel 31
    Quit
  eshopNetworkAddonExitDone_${ESHOP_MANAGED_ADDON_EXIT_ID}:
  !undef ESHOP_MANAGED_ADDON_EXIT_ID
!macroend

!macro eshopCheckNetworkAddonProcess id
  ; Run before any Desktop predecessor handoff or Desktop file removal. A
  ; verified managed resident is asked to drain and exit; every other process
  ; state fails closed before files or registrations can be replaced.
  !insertmacro eshopRequestManagedAddonExit ${id}
!macroend

!macro eshopCheckNetworkAddonInstallState
  ; Recovery belongs to these exact outer installer bytes, including its
  ; embedded dependency, not merely a reused version string or local marker.
  ${StdUtils.HashFile} $eshopInstallerSha256 "SHA2-256" "$EXEPATH"
  StrLen $R7 $eshopInstallerSha256
  ${If} $R7 != 64
    DetailPrint "The installer recovery identity could not be verified. Stopping."
    SetErrorLevel 41
    Quit
  ${EndIf}
  !insertmacro eshopCheckNetworkAddonProcess state
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
  ReadRegStr $R7 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" PendingVersion
  ${If} $R7 != ""
    ReadRegStr $R8 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" PendingDesktopPath
    ReadRegStr $R9 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" PendingMode
    ${If} $R7 != "${ESHOP_NETWORK_ADDON_VERSION}"
    ${OrIf} $R8 != "$INSTDIR"
    ${OrIf} $R9 != "$installMode"
      DetailPrint "A different installer recovery is pending. Nothing was replaced."
      SetErrorLevel 40
      Quit
    ${EndIf}
    ReadRegStr $R8 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" PendingInstallerSha256
    ${If} $R8 != "$eshopInstallerSha256"
      DetailPrint "Recovery requires the exact original installer file. Nothing was replaced."
      SetErrorLevel 40
      Quit
    ${EndIf}
    ; Retry only our fixed embedded installer, never an arbitrary registered
    ; command. Its own fail-closed partial-install checks remain authoritative.
    ${If} $R4 != ""
    ${AndIf} $R4 != "${ESHOP_NETWORK_ADDON_ROOT}"
      SetErrorLevel 29
      Quit
    ${EndIf}
    ${If} $R5 != ""
    ${AndIf} $R5 != '"${ESHOP_NETWORK_ADDON_UNINSTALLER}" /currentuser'
      SetErrorLevel 29
      Quit
    ${EndIf}
    Goto eshopNetworkAddonStateChecked
  ${EndIf}
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
  !insertmacro eshopRequireUnelevatedLifecycle
  ReadRegStr $R0 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" Managed
  ${If} $R0 == "true"
    ReadRegStr $R1 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" Version
    ${If} $R1 != "${ESHOP_NETWORK_ADDON_VERSION}"
      DetailPrint "The managed Network Print Add-on version is not compatible. Stopping."
      SetErrorLevel 25
      Quit
    ${EndIf}
    !insertmacro eshopCheckNetworkAddonProcess uninstall
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

!macro eshopVerifyAddonRegistration id
  ; Same exact registration/files checks apply in both distinct phases.
  ReadRegStr $R1 HKCU "${ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R2 HKCU "${ESHOP_NETWORK_ADDON_UNINSTALL_REGISTRY_KEY}" UninstallString
  ReadRegStr $R3 HKCU "${ESHOP_NETWORK_ADDON_UNINSTALL_REGISTRY_KEY}" DisplayVersion
  ReadRegStr $R4 HKCU "${ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY}" KeepShortcuts
  ReadRegStr $R5 HKCU "${ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY}" ShortcutName
  ${If} $R1 != "${ESHOP_NETWORK_ADDON_ROOT}"
  ${OrIf} $R2 != '"${ESHOP_NETWORK_ADDON_UNINSTALLER}" /currentuser'
  ${OrIf} $R3 != "${ESHOP_NETWORK_ADDON_VERSION}"
  ${OrIf} $R4 != "true"
    DetailPrint "The managed Network Print Add-on registration is incomplete. Stopping."
    SetErrorLevel 34
    Quit
  ${EndIf}
  StrCmp $R5 "E-Shop Network Print Add-on" eshopAddonRegistrationShortcutNameOk_${id}
  StrCmp $R5 "E-Shop Network Print Add-on (TEST ONLY)" eshopAddonRegistrationShortcutNameOk_${id} 0
    DetailPrint "The managed Network Print Add-on registration is not an official product entry. Stopping."
    SetErrorLevel 34
    Quit
  eshopAddonRegistrationShortcutNameOk_${id}:
  IfFileExists "${ESHOP_NETWORK_ADDON_ROOT}\E-Shop-Network-Print-Addon.exe" 0 eshopAddonRegistrationMissing_${id}
  IfFileExists "${ESHOP_NETWORK_ADDON_UNINSTALLER}" 0 eshopAddonRegistrationMissing_${id}
  Goto eshopAddonRegistrationVerified_${id}
  eshopAddonRegistrationMissing_${id}:
    DetailPrint "The installed Network Print Add-on program or uninstaller is missing. Stopping."
    SetErrorLevel 34
    Quit
  eshopAddonRegistrationVerified_${id}:
!macroend

!macro eshopVerifyAddonPrerequisite
  !insertmacro eshopVerifyAddonRegistration prepared
  IfFileExists "$SMPROGRAMS\店小二\管理与维护\Network 打印设置.lnk" 0 eshopAddonPrerequisiteMissing
  IfFileExists "$SMPROGRAMS\店小二\管理与维护\卸载 Network Print.lnk" 0 eshopAddonPrerequisiteMissing
  Goto eshopAddonPrerequisiteVerified
  eshopAddonPrerequisiteMissing:
    DetailPrint "The Add-on prerequisite management entries are incomplete. Desktop was not replaced."
    SetErrorLevel 34
    Quit
  eshopAddonPrerequisiteVerified:
!macroend

!macro eshopVerifyManagedAddonLifecycle
  ; Only after modern Desktop registration and actual EXE/ASAR validation by
  ; the helper may all four final product entries count as complete.
  !insertmacro eshopVerifyAddonRegistration complete
  IfFileExists "$DESKTOP\店小二收银.lnk" 0 eshopNetworkAddonLifecycleMissing
  IfFileExists "$SMPROGRAMS\店小二\管理与维护\Network 打印设置.lnk" 0 eshopNetworkAddonLifecycleMissing
  IfFileExists "$SMPROGRAMS\店小二\管理与维护\Desktop 门店绑定.lnk" 0 eshopNetworkAddonLifecycleMissing
  IfFileExists "$SMPROGRAMS\店小二\管理与维护\卸载 Network Print.lnk" 0 eshopNetworkAddonLifecycleMissing
  Goto eshopNetworkAddonLifecycleVerified
  eshopNetworkAddonLifecycleMissing:
    DetailPrint "The managed Network Print Add-on lifecycle artifacts are incomplete. Stopping."
    SetErrorLevel 34
    Quit
  eshopNetworkAddonLifecycleVerified:
!macroend

!macro eshopUninstallCurrentUserAddon
  SetShellVarContext current
  !insertmacro eshopPrepareManagedAddonUninstall
  !insertmacro eshopRestoreDesktopContext
!macroend

!macro customCheckAppRunning
  ; Also runs before initMultiUser in a silent uninstaller. Do not let the
  ; builder's machine-mode initialization elevate before customUnInit.
  !insertmacro eshopVerifyCurrentUserScope
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
    ; Run the Add-on preflight after the assisted installer has entered its
    ; visible install flow, but before any prior Desktop handoff or removal.
    ; Keeping this out of customInit prevents an unexpected process/plugin
    ; result from terminating the bootstrap before a window is available.
    ${If} $eshopDesktopInstallerPhase == "install"
      !insertmacro eshopVerifyInstallContext
      !insertmacro eshopRequireUnelevatedLifecycle
      SetShellVarContext current
      !insertmacro eshopCheckNetworkAddonInstallState
      ${If} $eshopAddonPrepared != "1"
        !insertmacro eshopPrepareNetworkAddon
      ${EndIf}
      !insertmacro eshopRestoreDesktopContext
    ${EndIf}
    ${If} $eshopDesktopInstallerPhase == "install"
    ${AndIf} $eshopPriorUninstallHandled != "1"
      !insertmacro eshopUninstallPriorVersion
    ${EndIf}
  !endif
!macroend

!macro customInit
  ; Builder skips the section process/predecessor check in an elevated inner
  ; instance. Do not let that path bypass our pre-removal dependency gate.
  ${If} ${UAC_IsInnerInstance}
    DetailPrint "Restart the installer already elevated as the same interactive Windows account."
    SetErrorLevel 37
    Quit
  ${EndIf}
  !insertmacro eshopVerifyInstallContext
  StrCpy $eshopDesktopInstallerPhase "init"
  !insertmacro customCheckAppRunning
  StrCpy $eshopDesktopInstallerPhase "install"
!macroend

!macro customUnInit
  !insertmacro eshopVerifyInstallContext
  ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R2 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $R1 == ""
  ${OrIf} $R2 == ""
  ${OrIf} $R1 != "$INSTDIR"
    DetailPrint "The Desktop uninstall registration cannot be verified. Stopping."
    SetErrorLevel 4
    Quit
  ${EndIf}
  !insertmacro customCheckAppRunning
  ; Read-only initialization. Assisted uninstall has not been confirmed yet.
  ; The prior-version uninstaller is copied to the installer's temporary
  ; plugin directory. Release $INSTDIR as the working directory before the
  ; ordinary electron-builder uninstall/removal path runs.
  SetOutPath "$TEMP"
!macroend

; Supported builder hook precedes its ordinary un.install section. Sections
; execute only after confirmation (or an explicit /S), unlike customUnInit.
; Do not replace builder's file-removal implementation or confirmation pages.
!macro customHeader
  ; Assisted builder initialization may elevate an HKLM uninstaller before
  ; customUnInit. Replace only its machine-mode initializer at this supported
  ; late hook; retain the existing current-user initializer and builder files.
  !ifmacrodef setInstallModePerAllUsers
    !macroundef setInstallModePerAllUsers
  !endif
  !include "${BUILD_RESOURCES_DIR}\current-user-mode.nsh"
  !ifdef BUILD_UNINSTALLER
    Section "un.-E-Shop lifecycle"
      !insertmacro eshopConfirmedUninstall
    SectionEnd
  !endif
!macroend

!macro eshopConfirmedUninstall
  !insertmacro eshopVerifyInstallContext
  !insertmacro eshopRequireUnelevatedLifecycle
  !insertmacro customCheckAppRunning
  ; The verified --updated handoff must retain dependency/configuration.
  ${IfNot} ${isUpdated}
    !insertmacro eshopUninstallCurrentUserAddon
  ${EndIf}
  SetOutPath "$TEMP"
!macroend

!macro eshopPrepareNetworkAddon
  !insertmacro eshopRequireUnelevatedLifecycle
  SetShellVarContext current
  ; Prerequisite work precedes the Desktop predecessor handoff. Final entry
  ; acceptance waits for the actual new Desktop; Pending binds either failure.
  ReadRegStr $R1 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" "Managed"
  ReadRegStr $R2 HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" "Version"
  ${If} $R1 == "true"
  ${AndIf} $R2 != "${ESHOP_NETWORK_ADDON_VERSION}"
    DetailPrint "The installed Network Print Add-on version is not compatible. Stopping."
    SetErrorLevel 24
    Quit
  ${EndIf}
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=eshop-network-addon-preflight.exe "${BUILD_RESOURCES_DIR}\network-print-addon\E-Shop-Network-Print-Addon-TEST-0.1.0-commercial-rc.15-x64.exe"
  SetOutPath "$TEMP"
  ClearErrors
  WriteRegStr HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" PendingVersion "${ESHOP_NETWORK_ADDON_VERSION}"
  WriteRegStr HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" PendingDesktopPath "$INSTDIR"
  WriteRegStr HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" PendingMode "$installMode"
  WriteRegStr HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" PendingInstallerSha256 "$eshopInstallerSha256"
  ${If} ${Errors}
    SetErrorLevel 39
    Quit
  ${EndIf}
  ClearErrors
  ExecWait '"$PLUGINSDIR\eshop-network-addon-preflight.exe" /S /desktop-prerequisite' $R0
  ${If} ${Errors}
  ${OrIf} $R0 != 0
    DetailPrint "The Add-on install failed. Desktop was not replaced. Retry this same installer to repair the dependency before using Desktop."
    SetErrorLevel 20
    Quit
  ${EndIf}
  ; Re-run the Add-on's authoritative shortcut lifecycle even when the
  ; version is unchanged. Its helper performs native ShellLink semantic
  ; validation/repair and returns non-zero when the prerequisite entries are
  ; not safely established; cashier/binding wait for the actual Desktop. File existence alone is not an ownership proof.
  ClearErrors
  ExecWait '"${ESHOP_NETWORK_ADDON_ROOT}\E-Shop-Network-Print-Addon.exe" --install-shortcuts --silent-shortcuts --desktop-install-prerequisite' $R6
  ${If} ${Errors}
  ${OrIf} $R6 != 0
    DetailPrint "The managed Network Print Add-on shortcut contract could not be verified or repaired. Stopping."
    SetErrorLevel 35
    Quit
  ${EndIf}
  ; /S must leave no resident process behind. Re-check the same managed
  ; lifecycle boundary before accepting registration and runtime artifacts.
  !insertmacro eshopCheckNetworkAddonProcess prepared
  !insertmacro eshopVerifyAddonPrerequisite
  ; No Managed/Version success publication before the final Desktop phase.
  StrCpy $eshopAddonPrepared "1"
!macroend

!macro eshopCompleteNetworkAddon
  !insertmacro eshopRequireUnelevatedLifecycle
  SetShellVarContext current
  ClearErrors
  ExecWait '"${ESHOP_NETWORK_ADDON_ROOT}\E-Shop-Network-Print-Addon.exe" --install-shortcuts --silent-shortcuts --desktop-install-complete' $R6
  ${If} ${Errors}
  ${OrIf} $R6 != 0
    DetailPrint "Desktop is installed, but final Add-on entry validation failed. Retry this exact installer; recovery was retained."
    SetErrorLevel 47
    Quit
  ${EndIf}
  !insertmacro eshopCheckNetworkAddonProcess completed
  !insertmacro eshopVerifyManagedAddonLifecycle
!macroend

!macro customInstall
  !insertmacro eshopVerifyCurrentUserScope
  !insertmacro eshopVerifyInteractiveUser
  !insertmacro eshopRequireUnelevatedLifecycle
  ${If} $eshopAddonPrepared != "1"
    DetailPrint "The pre-removal Add-on preparation was not completed. Stopping."
    SetErrorLevel 38
    Quit
  ${EndIf}
  SetShellVarContext current
  !insertmacro eshopCompleteNetworkAddon
  ClearErrors
  WriteRegStr HKCU "${ESHOP_DESKTOP_AUTOSTART_KEY}" "${ESHOP_DESKTOP_AUTOSTART_VALUE}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  ${If} ${Errors}
    ; Pending recovery is retained: an installer retry must verify the same
    ; dependency before another predecessor handoff, never a success flag.
    SetErrorLevel 39
    Quit
  ${EndIf}
  ; Publish managed completion only after final entries AND Desktop Run succeed.
  ClearErrors
  WriteRegStr HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" "Version" "${ESHOP_NETWORK_ADDON_VERSION}"
  ${If} ${Errors}
    SetErrorLevel 39
    Quit
  ${EndIf}
  WriteRegStr HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" "Managed" "true"
  ${If} ${Errors}
    SetErrorLevel 39
    Quit
  ${EndIf}
  DeleteRegValue HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" PendingVersion
  DeleteRegValue HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" PendingDesktopPath
  DeleteRegValue HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" PendingMode
  DeleteRegValue HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" PendingInstallerSha256
  !insertmacro eshopRestoreDesktopContext
!macroend

!macro customUnInstall
  !insertmacro eshopVerifyCurrentUserScope
  !insertmacro eshopVerifyInteractiveUser
  !insertmacro eshopRequireUnelevatedLifecycle
  SetShellVarContext current
  ; Managed Add-on removal has completed in the confirmed section, before
  ; Desktop files and registration are removed. Independent Add-ons are
  ; intentionally preserved because this marker is absent.
  ${IfNot} ${isUpdated}
    DeleteRegKey HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}"
  ${EndIf}
  DeleteRegValue HKCU "${ESHOP_DESKTOP_AUTOSTART_KEY}" "${ESHOP_DESKTOP_AUTOSTART_VALUE}"
  !insertmacro eshopRestoreDesktopContext
!macroend
