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
  ; Release the install directory handle before builder's ordinary removal.
  SetOutPath "$TEMP"
!macroend

!macro customUnInstall
  ; Upgrades retain login-start and all history. Ordinary uninstall removes
  ; only this product's optional login-start entry, never its durable state.
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "EShopNetworkPrintAddon"
  ${EndIf}
!macroend
