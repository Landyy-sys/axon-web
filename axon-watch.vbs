' axon-watch.vbs - hide the crash-guard window completely
' ASCII only (VBScript reads files in the ANSI codepage).
Option Explicit
Dim sh, fso, here, bat
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here    = fso.GetParentFolderName(WScript.ScriptFullName)
bat     = here & "\watch-server.bat"
If Not fso.FileExists(bat) Then
  MsgBox "watch-server.bat not found: " & bat, 16, "AXON"
  WScript.Quit 1
End If
' window style 0 = hidden, bWaitOnReturn = False -> survives terminal close
sh.Run "cmd.exe /c """ & bat & """", 0, False
