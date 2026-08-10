!ifndef PAYLOAD_ROOT
  !error "PAYLOAD_ROOT is required"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE is required"
!endif
!ifndef SOURCE_COMMIT
  !error "SOURCE_COMMIT is required"
!endif
!ifndef CANDIDATE_VERSION
  !error "CANDIDATE_VERSION is required"
!endif

Unicode true
RequestExecutionLevel admin
Name "E-Shop V1 Setup"
OutFile "${OUTPUT_FILE}"
InstallDir "$PROGRAMDATA\E-Shop\Installer\MVP"
SetCompressor /SOLID lzma
ShowInstDetails nevershow
BrandingText "E-Shop V1 Setup"

VIProductVersion "1.0.0.0"
VIAddVersionKey /LANG=1033 "ProductName" "E-Shop V1 Setup"
VIAddVersionKey /LANG=1033 "FileDescription" "E-Shop V1 Setup MVP"
VIAddVersionKey /LANG=1033 "CompanyName" "E-Shop"
VIAddVersionKey /LANG=1033 "FileVersion" "${CANDIDATE_VERSION}"
VIAddVersionKey /LANG=1033 "SourceCommit" "${SOURCE_COMMIT}"

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to E-Shop V1 Setup"
!define MUI_WELCOMEPAGE_TEXT "Setup will prepare the E-Shop Desktop and printing runtime on this computer.$\r$\n$\r$\nClose other applications before continuing."
!define MUI_FINISHPAGE_TITLE "E-Shop V1 Setup completed"
!define MUI_FINISHPAGE_TEXT "Runtime provisioning is ready. Open E-Shop Desktop to request Merchant Binding."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "E-Shop V1 Runtime" SEC_RUNTIME
  SetShellVarContext all
  SetDetailsPrint none
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD_ROOT}/*.*"

  IfFileExists "$EXEDIR\Drivers\Rongta\*.exe" CopyRongtaDriver SkipRongtaDriver
  CopyRongtaDriver:
    CreateDirectory "$INSTDIR\Drivers\Rongta"
    CopyFiles /SILENT "$EXEDIR\Drivers\Rongta\*.exe" "$INSTDIR\Drivers\Rongta"
  SkipRongtaDriver:

  IfFileExists "$EXEDIR\Drivers\Xprinter\*.exe" CopyXprinterDriver SkipXprinterDriver
  CopyXprinterDriver:
    CreateDirectory "$INSTDIR\Drivers\Xprinter"
    CopyFiles /SILENT "$EXEDIR\Drivers\Xprinter\*.exe" "$INSTDIR\Drivers\Xprinter"
  SkipXprinterDriver:

  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\E-Shop-V1-Setup.ps1"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "E-Shop Runtime setup could not complete.$\r$\n$\r$\nIf an official printer driver is required, place it in the matching Drivers folder beside E-Shop-V1-Setup.exe, then run Setup again."
    Abort
  ${EndIf}
SectionEnd
