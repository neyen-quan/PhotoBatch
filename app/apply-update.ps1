param([string]$AppRoot,[string]$Stage,[string]$Exe,[int]$ParentPid,[string]$From,[string]$To,[string]$Ready)
$ErrorActionPreference = 'Stop'
$log = Join-Path $Stage 'actualizacion.log'
('Inicio del actualizador: ' + (Get-Date).ToString('s')) | Out-File -LiteralPath $log -Encoding utf8
try {
  # Signal readiness only after parsing, checking the package and validating staged bytes.
  $manifest = Get-Content -LiteralPath (Join-Path $Stage 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $oldPackage = Get-Content -LiteralPath (Join-Path $AppRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if($oldPackage.version -ne $From -or $manifest.from -ne $From -or $manifest.to -ne $To) { throw 'La version instalada no corresponde al parche.' }
  foreach($file in $manifest.files) {
    $relative = [string]$file.path
    if(($relative -ne 'package.json') -and ($relative -notmatch '^app/[a-zA-Z0-9_.-]+\.(js|css|html|png|ico|ps1)$')) { throw 'Ruta de archivo no permitida.' }
    $source = Join-Path (Join-Path $Stage 'files') $relative
    if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'El parche no supera la validacion.' }
  }
  if($Ready) { [System.IO.File]::WriteAllText($Ready, 'ready') }
  for($i=0; $i -lt 120; $i++) {
    if(-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }
  if(Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) { throw 'PhotoBatch sigue abierto. Se canceló la actualización.' }
  $manifest = Get-Content -LiteralPath (Join-Path $Stage 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $oldPackage = Get-Content -LiteralPath (Join-Path $AppRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if($oldPackage.version -ne $From -or $manifest.from -ne $From -or $manifest.to -ne $To) { throw 'La versión instalada no corresponde al parche.' }
  $backup = Join-Path $Stage 'respaldo'
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  foreach($file in $manifest.files) {
    $relative = [string]$file.path
    if(($relative -ne 'package.json') -and ($relative -notmatch '^app/[a-zA-Z0-9_.-]+\.(js|css|html|png|ico|ps1)$')) { throw 'Ruta de archivo no permitida.' }
    $source = Join-Path (Join-Path $Stage 'files') $relative
    $target = Join-Path $AppRoot $relative
    $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if($hash -ne $file.sha256) { throw "El parche cambió: $relative" }
    if(Test-Path -LiteralPath $target) {
      $dest = Join-Path $backup $relative
      New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
      Copy-Item -LiteralPath $target -Destination $dest -Force
    }
  }
  $changed = New-Object 'System.Collections.Generic.List[string]'
  try {
    foreach($file in $manifest.files) {
      $relative = [string]$file.path
      $source = Join-Path (Join-Path $Stage 'files') $relative
      $target = Join-Path $AppRoot $relative
      $changed.Add($relative)
      New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
      Copy-Item -LiteralPath $source -Destination $target -Force
    }
    $newPackage = Get-Content -LiteralPath (Join-Path $AppRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if($newPackage.version -ne $To) { throw 'La versión final no coincide.' }
    "PhotoBatch $From -> $To actualizado." | Out-File -LiteralPath $log -Encoding utf8
  } catch {
    foreach($relative in $changed) {
      $target = Join-Path $AppRoot $relative
      $backed = Join-Path $backup $relative
      if(Test-Path -LiteralPath $backed){ Copy-Item -LiteralPath $backed -Destination $target -Force }
      else { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
    }
    throw
  }
} catch {
  ('Error al actualizar: ' + $_.Exception.Message) | Out-File -LiteralPath $log -Encoding utf8
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("No se pudo actualizar PhotoBatch. Consultá el registro en: $log",'PhotoBatch') | Out-Null
}
try {
  Start-Process -FilePath $Exe -WorkingDirectory (Split-Path $Exe -Parent) -ErrorAction Stop
} catch {
  ('No se pudo reabrir PhotoBatch: ' + $_.Exception.Message) | Out-File -LiteralPath $log -Encoding utf8 -Append
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("Abri PhotoBatch manualmente. Registro: $log",'PhotoBatch') | Out-Null
}
