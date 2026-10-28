$ErrorActionPreference = 'Stop'
try {
  Write-Host 'PhotoBatch - Reparacion V2 con prueba real'
  $paths = @(Get-Process -Name PhotoBatch -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Path } catch {} } | Where-Object { $_ } | Select-Object -Unique)
  if($paths.Count -ne 1) { throw 'Deja abierta una sola copia de PhotoBatch y ejecuta nuevamente esta reparacion.' }
  $exe = $paths[0]
  $root = Join-Path (Split-Path -Parent $exe) 'resources\app'
  $script = Join-Path $PSScriptRoot 'Reparacion\repair-node.js'
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $exe
  $info.Arguments = '"' + $script + '" "' + $root + '"'
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $info
  [void]$p.Start()
  $stdout = $p.StandardOutput.ReadToEndAsync()
  $stderr = $p.StandardError.ReadToEndAsync()
  if(-not $p.WaitForExit(40000)) { try { $p.Kill() } catch {}; throw 'La prueba no termino. No uses el parche hasta revisar el diagnostico.' }
  $output = $stdout.Result + $stderr.Result
  Write-Host $output
  $log = Join-Path $PSScriptRoot 'Resultado-reparacion.txt'
  [System.IO.File]::WriteAllText($log, $output, (New-Object System.Text.UTF8Encoding($true)))
  if($p.ExitCode -ne 0) { throw ('La reparacion fallo. Adjunta Resultado-reparacion.txt. Codigo: ' + $p.ExitCode) }
  if(-not $output.Contains('REPARACION V2 COMPLETADA')) { throw 'No se recibio confirmacion. Adjunta Resultado-reparacion.txt.' }
} catch {
  Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
