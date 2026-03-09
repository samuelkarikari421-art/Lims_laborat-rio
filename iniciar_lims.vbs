Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\KKEstoque02\OneDrive - KariKari Alimentos\Área de Trabalho\lims-kari-kari"
WshShell.Run "cmd.exe /c node backend/server.js", 0, False