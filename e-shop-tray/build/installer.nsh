!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="E-Shop Tray V0.1"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="E-Shop Tray V0.1" dir=in action=allow program="$INSTDIR\E-Shop Tray.exe" enable=yes profile=private protocol=TCP localport=17631'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="E-Shop Tray V0.1"'
!macroend
