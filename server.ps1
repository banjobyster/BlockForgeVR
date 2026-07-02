# BlockForge VR - tiny static file server (no dependencies, raw TCP HTTP/1.1)
# Serves the folder this script lives in on http://localhost:8787
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$port = 8787

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
}

try {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
  $listener.Start()
} catch {
  # port already in use -> a server is already running, nothing to do
  exit 0
}

Write-Host "BlockForge VR serving $root at http://localhost:$port"

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 3000
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $requestLine = $reader.ReadLine()
    if (-not $requestLine) { $client.Close(); continue }
    # drain headers
    while (($line = $reader.ReadLine()) -and $line -ne '') { }

    $parts = $requestLine.Split(' ')
    $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { '/' }
    $path = $rawPath.Split('?')[0]
    if ($path -eq '/') { $path = '/index.html' }
    $path = [Uri]::UnescapeDataString($path) -replace '/', '\'
    $file = Join-Path $root $path.TrimStart('\')

    $fullRoot = [IO.Path]::GetFullPath($root)
    $fullFile = try { [IO.Path]::GetFullPath($file) } catch { $null }

    if ($fullFile -and $fullFile.StartsWith($fullRoot) -and (Test-Path $fullFile -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($fullFile)
      $ext = [IO.Path]::GetExtension($fullFile).ToLower()
      $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $header = "HTTP/1.1 200 OK`r`nContent-Type: $type`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
      $hb = [Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($hb, 0, $hb.Length)
      $stream.Write($bytes, 0, $bytes.Length)
    } else {
      $body = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
      $hb = [Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($hb, 0, $hb.Length)
      $stream.Write($body, 0, $body.Length)
    }
    $stream.Flush()
  } catch { } finally {
    $client.Close()
  }
}
