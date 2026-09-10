; Independent current-user installation. Runtime state lives outside $INSTDIR:
; $APPDATA\E-Shop-Network-Print-Addon\state. Never remove or migrate that state.
; Manual installer updates only; the operator must first exit the Add-on safely.

!define /ifndef MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define /ifndef MUI_UNICON "${MUI_ICON}"
!if "${MUI_ICON}" != "${MUI_UNICON}"
  !error "Network Add-on requires matching installer/uninstaller icons"
!endif

!macro customCheckAppRunning
  ; Also called by un.onInit, including silent upgrade/uninstall. Only 603 is
  ; verified absence; enumeration failure must never trigger file replacement.
  nsProcess::_FindProcess /NOUNLOAD "E-Shop-Network-Print-Addon.exe"
  Pop $R0
  ${If} $R0 == 0
    DetailPrint "Exit E-Shop Network Print Add-on safely before continuing."
    IfSilent +2 0
      MessageBox MB_OK|MB_ICONSTOP "Exit E-Shop Network Print Add-on safely, then retry."
    SetErrorLevel 2
    Quit
  ${ElseIf} $R0 != 603
    DetailPrint "Unable to verify whether the Add-on is running. Stopping."
    SetErrorLevel 3
    Quit
  ${EndIf}
!macroend

!macro addonCheckArguments
  ${If} ${isForAllUsers}
    SetErrorLevel 4
    Quit
  ${EndIf}
  ${If} ${isForceRun}
    SetErrorLevel 4
    Quit
  ${EndIf}
  ; Also reject the builder's explicit data-deletion override on uninstall.
  ${If} ${isDeleteAppData}
    SetErrorLevel 4
    Quit
  ${EndIf}
  ${StdUtils.GetParameter} $R0 "D" ""
  ${If} $R0 != ""
    SetErrorLevel 4
    Quit
  ${EndIf}
!macroend

!macro customInit
  !insertmacro addonCheckArguments
  SetShellVarContext current
  ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 != ""
    SetErrorLevel 4
    Quit
  ${EndIf}
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 != ""
  ${AndIf} $R0 != "$LOCALAPPDATA\Programs\E-Shop-Network-Print-Addon"
    SetErrorLevel 4
    Quit
  ${EndIf}
  ; A legacy uninstaller must receive --keep-shortcuts before it runs. Do not
  ; invent missing registration or delete a same-name user link to repair it.
  ReadRegStr $R1 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $R0 != ""
  ${OrIf} $R1 != ""
    ReadRegStr $R2 HKCU "${INSTALL_REGISTRY_KEY}" KeepShortcuts
    ${If} $R0 != "$LOCALAPPDATA\Programs\E-Shop-Network-Print-Addon"
    ${OrIf} $R1 == ""
    ${OrIf} $R2 != "true"
      DetailPrint "Existing shortcut ownership cannot be preserved. Installation stopped."
      IfSilent +2 0
        MessageBox MB_OK|MB_ICONSTOP "Existing shortcut ownership cannot be preserved. Installation stopped; keep all existing files and contact support."
      SetErrorLevel 5
      Quit
    ${EndIf}
    IfFileExists "$R0\E-Shop-Network-Print-Addon.exe" +6 0
      DetailPrint "Existing Network program is missing. Installation stopped."
      IfSilent +2 0
        MessageBox MB_OK|MB_ICONSTOP "Existing Network program is missing. Installation stopped to preserve shortcuts and history."
      SetErrorLevel 5
      Quit
  ${EndIf}
  StrCpy $installMode CurrentUser
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\E-Shop-Network-Print-Addon"
  !insertmacro customCheckAppRunning
!macroend

!macro customUnInit
  !insertmacro addonCheckArguments
  SetShellVarContext current
  ${If} $INSTDIR != "$LOCALAPPDATA\Programs\E-Shop-Network-Print-Addon"
    SetErrorLevel 4
    Quit
  ${EndIf}
  StrCpy $installMode CurrentUser
  !insertmacro customCheckAppRunning
  ; Run before builder removes $INSTDIR. This mode never initializes binding,
  ; a printing profile, journal, renderer or polling. Upgrades retain links.
  ${IfNot} ${isUpdated}
    ClearErrors
    ExecWait '"$INSTDIR\E-Shop-Network-Print-Addon.exe" --uninstall-shortcuts' $R0
    ${If} ${Errors}
    ${OrIf} $R0 != 0
      DetailPrint "Shortcut restore could not be verified. Uninstall stopped."
      IfSilent +2 0
        MessageBox MB_OK|MB_ICONSTOP "Shortcut restore could not be verified. Uninstall stopped; no print history was removed."
      SetErrorLevel 6
      Quit
    ${EndIf}
  ${EndIf}
  ; Release the install directory handle before builder's ordinary removal.
  SetOutPath "$TEMP"
!macroend

!macro customInstall
  ; Owned entry creation and per-object explicit legacy ownership confirmation.
  ; Silent installs retain unconfirmed files. No printing Agent starts here.
  ClearErrors
  ${If} ${Silent}
    ExecWait '"$INSTDIR\E-Shop-Network-Print-Addon.exe" --install-shortcuts --silent-shortcuts' $R0
  ${Else}
    ExecWait '"$INSTDIR\E-Shop-Network-Print-Addon.exe" --install-shortcuts' $R0
  ${EndIf}
  ${If} ${Errors}
  ${OrIf} $R0 != 0
    DetailPrint "Network Print installed; shortcut setup incomplete. Open Management and Maintenance to review preserved files."
    IfSilent +2 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Network Print is installed, but entry setup is incomplete. Open Network Print management from the Start Menu, then Desktop entry setup. Existing files and history were preserved."
    SetErrorLevel 7
    ; builder's following quitSuccess resets the result to zero. Stop here so
    ; an incomplete shortcut setup cannot be reported as a successful install.
    Quit
  ${EndIf}
!macroend

!macro customUnInstall
  ; Upgrades retain login-start and all history. Ordinary uninstall removes
  ; only this product's optional login-start entry, never its durable state.
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "EShopNetworkPrintAddon"
  ${EndIf}
!macroend
