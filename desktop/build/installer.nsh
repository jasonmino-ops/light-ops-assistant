!define ESHOP_DESKTOP_AUTOSTART_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define ESHOP_DESKTOP_AUTOSTART_VALUE "E-Shop Desktop"

!macro customInstall
  WriteRegStr HKCU "${ESHOP_DESKTOP_AUTOSTART_KEY}" "${ESHOP_DESKTOP_AUTOSTART_VALUE}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "${ESHOP_DESKTOP_AUTOSTART_KEY}" "${ESHOP_DESKTOP_AUTOSTART_VALUE}"
!macroend
