; Loaded by customHeader after assistedInstaller defines initMultiUser, and
; before the installer/uninstaller expands that macro. No machine fallback.
!macro setInstallModePerAllUsers
  DetailPrint "Machine installation is unsupported by this current-user package. Stopping."
  SetErrorLevel 44
  Quit
!macroend
