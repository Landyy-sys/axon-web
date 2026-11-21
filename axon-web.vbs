' AXON web - silent background starter
' ASCII only: VBScript reads files in the ANSI codepage, so no UTF-8 here.
Option Explicit

Dim sh, fso, here, node, script, portFile, port, i, distIdx

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here      = fso.GetParentFolderName(WScript.ScriptFullName)
script    = here & "\server.mjs"
portFile  = here & "\server.port"
distIdx   = here & "\dist\index.html"

' Prefer the managed node runtime; fall back to whatever is on PATH.
node = "C:\Users\40414\.workbuddy\binaries\node\versions\22.22.2\node.exe"
If Not fso.FileExists(node) Then node = "node.exe"

If Not fso.FileExists(script) Then
  MsgBox "server.mjs not found: " & script, 16, "AXON"
  WScript.Quit 1
End If

If Not fso.FileExists(distIdx) Then
  MsgBox "dist\index.html is missing. Run 'npm run build' first.", 16, "AXON"
  WScript.Quit 1
End If

sh.CurrentDirectory = here
' window style 0 = hidden, bWaitOnReturn = False
sh.Run """" & node & """ """ & script & """ 4173", 0, False

' Poll for the port file written by the server.
port = ""
For i = 1 To 40
  WScript.Sleep 250
  If fso.FileExists(portFile) Then
    On Error Resume Next
    port = Trim(fso.OpenTextFile(portFile, 1).ReadAll)
    On Error GoTo 0
    If Len(port) > 0 Then Exit For
  End If
Next

If Len(port) = 0 Then port = "4173"

If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "open" Then
    sh.Run "http://localhost:" & port & "/", 1, False
  End If
End If
