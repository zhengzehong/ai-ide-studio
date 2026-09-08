param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type 'public static class WizardClick { [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr SendMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l); }'
$process = Start-Process -FilePath (Resolve-Path -LiteralPath $Installer).Path -PassThru -WindowStyle Normal
try {
  $deadline = (Get-Date).AddSeconds(20)
  $names = @()
  do {
    Start-Sleep -Milliseconds 250
    $ids = @($process.Id)
    $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $process.Id }
    $ids += @($children | ForEach-Object { $_.ProcessId })
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($window in $windows) {
      if ($window.Current.ProcessId -notin $ids) { continue }
      $controls = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      $names = @($controls | ForEach-Object { $_.Current.Name })
      if (($names -join ' ') -match 'Next|\u4e0b\u4e00\u6b65') { break }
    }
  } while (!(($names -join ' ') -match 'Next|\u4e0b\u4e00\u6b65') -and (Get-Date) -lt $deadline)
  if (!(($names -join ' ') -match 'Next|\u4e0b\u4e00\u6b65')) { throw "Installer wizard not found: $($names -join ' | ')" }
  $names | ConvertTo-Json
  $next = @($controls | Where-Object { $_.Current.Name -match 'Next|\u4e0b\u4e00\u6b65' })[0]
  [WizardClick]::SendMessage([IntPtr]$next.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 400
  $controls = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $directoryPage = @($controls | ForEach-Object { $_.Current.Name })
  if (!(($directoryPage -join ' ') -match 'Browse|\u6d4f\u89c8')) { throw 'Directory selection page not found' }
  $directoryPage | ConvertTo-Json
} finally {
  # Never invoke Install; terminate only this test installer and its descendants.
  if (!$process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
}
