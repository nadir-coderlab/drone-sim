<#
.SYNOPSIS
  Serves the published update (publish-update.ps1) to the TV app on the same Wi-Fi.

.DESCRIPTION
  One PowerShell loop, no install, no admin rights:
    * UDP 47800 (discovery, protocol P5): answers 'DRONESIM?1' with 'DRONESIM!1 http://<pc-ip>:<port>/', using the
      PC address on the sender's subnet.
    * HTTP on TCP 47801: GET/HEAD of the files in -Dir only (update.properties, update.properties.sig,
      content-<ver>.zip, DroneSim-<code>.apk); names [A-Za-z0-9._-] only, no sub-folders, nothing else.
  Logs which file the TV downloaded, with progress. Stops after -Minutes (0 = until Ctrl+C).

  The first time, Windows Firewall asks whether "Windows PowerShell" may accept connections: tick "Private
  networks" and press "Allow access". If the Wi-Fi is set to "Public", the TV may not reach the PC; set the
  network to Private in Windows Settings (this script only warns, it changes nothing).

  Everything the TV downloads is checked by the app (signature with its own key + SHA-256), so this server
  needs no security of its own beyond serving only this folder.

  Exit codes: 0 stopped normally, 1 error, 4 port already in use (another server window is open).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\serve-updates.ps1
.EXAMPLE
  .\serve-updates.ps1 -Bind 127.0.0.1 -Minutes 2
  Loopback only (tests; no firewall prompt).
#>
[CmdletBinding()]
param(
  [string]$Dir = $(if ($env:DS_UPDATES) { $env:DS_UPDATES } else { 'C:\tools\dronesim-updates' }),
  [string]$Bind = '0.0.0.0',
  [int]$Port = 47801,
  [int]$DiscoveryPort = 47800,
  [double]$Minutes = 20,
  [scriptblock]$OnEvent = $null,   # in-process callers (update-tv.ps1): called with a hashtable per event
  [scriptblock]$Tick = $null       # called often (also during downloads); output $false to stop
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$Magic = 'DRONESIM?1'
$ReplyMagic = 'DRONESIM!1'
$Types = @{
  '.properties' = 'text/plain; charset=utf-8'
  '.sig'        = 'text/plain; charset=us-ascii'
  '.txt'        = 'text/plain; charset=utf-8'
  '.zip'        = 'application/zip'
  '.apk'        = 'application/vnd.android.package-archive'
  '.json'       = 'application/json'
}

function Say([string]$m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Note([string]$m) { Write-Host "    $m" }
function Warn([string]$m) { Write-Host "WARNING: $m" -ForegroundColor Yellow }
function Stamp { return (Get-Date -Format 'HH:mm:ss') }

function Emit([hashtable]$Ev) {
  if ($Ev.ContainsKey('Text') -and $Ev.Text) {
    $color = if ($Ev.ContainsKey('Color')) { $Ev.Color } else { 'Gray' }
    Write-Host ("[{0}] {1}" -f (Stamp), $Ev.Text) -ForegroundColor $color
  }
  if ($script:OnEventCb) {
    try { & $script:OnEventCb $Ev } catch { Write-Host "  (window update failed: $($_.Exception.Message))" -ForegroundColor DarkGray }
  }
}

function Invoke-Tick {
  if (-not $script:TickCb) { return }
  $now = [Environment]::TickCount
  if (($now - $script:LastTick) -lt 40 -and ($now - $script:LastTick) -ge 0) { return }
  $script:LastTick = $now
  try {
    foreach ($r in @(& $script:TickCb)) { if ($r -is [bool] -and -not $r) { $script:StopReason = 'user' } }
  } catch { Write-Host "  (window tick failed: $($_.Exception.Message))" -ForegroundColor DarkGray }
}

function Format-MB([long]$b) {
  if ($b -lt 1MB) { return ('{0:N0} KB' -f [Math]::Max(1, [Math]::Ceiling($b / 1KB))) }
  return ('{0:N1} MB' -f ($b / 1MB))
}

# ------------------------------------------------------------------------------------------------ network info
# IPv4 addresses of this PC. Primary = up, not virtual, with a default gateway (the Wi-Fi/Ethernet to the router).
function Get-LocalIPv4 {
  $res = @()
  $virtualRx = 'Hyper-V|vEthernet|VirtualBox|VMware|Virtual|TAP-|WireGuard|Tailscale|ZeroTier|Npcap|Loopback|Bluetooth|WSL|Docker|OpenVPN|Wintun|Teredo|isatap|VPN|Pseudo'
  foreach ($ni in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    try {
      if ($ni.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) { continue }
      $t = $ni.NetworkInterfaceType
      if ($t -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback -or $t -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Tunnel) { continue }
      $virtual = ($ni.Description + ' ' + $ni.Name) -match $virtualRx
      $props = $ni.GetIPProperties()
      $gw = @($props.GatewayAddresses | Where-Object {
        $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $_.Address.ToString() -ne '0.0.0.0' })
      foreach ($ua in $props.UnicastAddresses) {
        if ($ua.Address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { continue }
        $ip = $ua.Address.ToString()
        if ($ip.StartsWith('169.254.') -or $ip.StartsWith('127.')) { continue }
        $mask = $null
        try { $mask = $ua.IPv4Mask } catch { $mask = $null }
        if ($null -eq $mask -or $mask.ToString() -eq '0.0.0.0') { $mask = [System.Net.IPAddress]::Parse('255.255.255.0') }
        $res += [pscustomobject]@{
          Ip = $ip; Bytes = $ua.Address.GetAddressBytes(); Mask = $mask.GetAddressBytes(); Gateway = ($gw.Count -gt 0)
          Virtual = [bool]$virtual; Name = $ni.Name; Wifi = ($t -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Wireless80211)
        }
      }
    } catch { continue }
  }
  # primary first: real adapters with a gateway, Wi-Fi before Ethernet before the rest
  return @($res | Sort-Object -Property @{ Expression = { -not ($_.Gateway -and -not $_.Virtual) } }, @{ Expression = { $_.Virtual } }, @{ Expression = { -not $_.Wifi } })
}

function Get-ReplyIp([string]$Sender) {
  if ($script:BindIp -ne '0.0.0.0') { return $script:BindIp }
  if ($Sender.StartsWith('127.')) { return '127.0.0.1' }
  $now = [Environment]::TickCount
  if (($now - $script:AddrTime) -gt 30000 -or ($now - $script:AddrTime) -lt 0) { $script:Addrs = @(Get-LocalIPv4); $script:AddrTime = $now }
  $sb = $null
  try { $sb = [System.Net.IPAddress]::Parse($Sender).GetAddressBytes() } catch { $sb = $null }
  if ($sb -and $sb.Length -eq 4) {
    foreach ($a in $script:Addrs) {
      $same = $true
      for ($i = 0; $i -lt 4; $i++) { if (($sb[$i] -band $a.Mask[$i]) -ne ($a.Bytes[$i] -band $a.Mask[$i])) { $same = $false; break } }
      if ($same) { return $a.Ip }
    }
  }
  if (@($script:Addrs).Count -gt 0) { return $script:Addrs[0].Ip }
  return $null
}

function Test-NetworkWarnings {
  $w = @{ Public = $false; Blocked = $false; Allowed = $false; Profiles = '' }
  try {
    $profiles = @(Get-NetConnectionProfile -ErrorAction Stop)
    $w.Profiles = (($profiles | ForEach-Object { "$($_.Name)=$($_.NetworkCategory)" }) -join ', ')
    if (@($profiles | Where-Object { "$($_.NetworkCategory)" -eq 'Public' }).Count -gt 0) { $w.Public = $true }
  } catch { }
  try {
    $exe = (Get-Process -Id $PID).Path
    $filters = @(Get-NetFirewallApplicationFilter -Program $exe -ErrorAction Stop)
    if ($filters.Count -gt 0) {
      $rules = @($filters | Get-NetFirewallRule -ErrorAction Stop | Where-Object { "$($_.Enabled)" -eq 'True' -and "$($_.Direction)" -eq 'Inbound' })
      if (@($rules | Where-Object { "$($_.Action)" -eq 'Block' }).Count -gt 0) { $w.Blocked = $true }
      if (@($rules | Where-Object { "$($_.Action)" -eq 'Allow' }).Count -gt 0) { $w.Allowed = $true }
    }
  } catch { }
  return $w
}

# ------------------------------------------------------------------------------------------------ UDP discovery
function Invoke-Discovery {
  if (-not $script:Udp) { return }
  for ($n = 0; $n -lt 16; $n++) {
    try {
      if ($script:Udp.Available -le 0) { return }
      $ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
      $data = $script:Udp.Receive([ref]$ep)
      if ($data.Length -gt 64) { continue }
      $msg = [System.Text.Encoding]::ASCII.GetString($data).Trim()
      if ($msg -ne $Magic) { continue }
      $from = $ep.Address.ToString()
      $ip = Get-ReplyIp $from
      if (-not $ip) { Emit @{ Kind = 'discover-fail'; Client = $from; Text = "discovery from $from, but this PC has no usable IPv4 address"; Color = 'Yellow' }; continue }
      $url = "http://${ip}:$($script:Port)/"
      $reply = [System.Text.Encoding]::ASCII.GetBytes("$ReplyMagic $url")
      [void]$script:Udp.Send($reply, $reply.Length, $ep)
      $key = "$from|$url"
      $now = [Environment]::TickCount
      # the app may ask twice (255.255.255.255 + subnet broadcast): log once per 5 s
      if ($script:LastDisc -ne $key -or ($now - $script:LastDiscTime) -gt 5000 -or ($now - $script:LastDiscTime) -lt 0) {
        Emit @{ Kind = 'discover'; Client = $from; Url = $url; Text = "TV $from is looking for updates -> told it $url"; Color = 'Green' }
      }
      $script:LastDisc = $key; $script:LastDiscTime = $now
    } catch {
      Write-Host "  (discovery error ignored: $($_.Exception.Message))" -ForegroundColor DarkGray
    }
  }
}

# ------------------------------------------------------------------------------------------------ HTTP
function Send-Text($Stream, [int]$Code, [string]$Reason, [string]$Body, [bool]$Head, [string]$Extra) {
  $b = [System.Text.Encoding]::UTF8.GetBytes($Body)
  $h = "HTTP/1.1 $Code $Reason`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($b.Length)`r`n" +
       "Cache-Control: no-store`r`nConnection: close`r`nServer: DroneSimUpdate`r`n$Extra`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($h)
  $Stream.Write($hb, 0, $hb.Length)
  if (-not $Head) { $Stream.Write($b, 0, $b.Length) }
}

# Reads the request head (until a blank line) without blocking the loop for long: 5 s / 8 KB at most.
function Read-RequestHead($Client, $Stream) {
  $buf = New-Object byte[] 8192
  $len = 0
  $start = [Environment]::TickCount
  while ($true) {
    if ($Stream.DataAvailable) {
      $n = $Stream.Read($buf, $len, $buf.Length - $len)
      if ($n -le 0) { break }
      $len += $n
      $text = [System.Text.Encoding]::ASCII.GetString($buf, 0, $len)
      if ($text.Contains("`r`n`r`n") -or $text.Contains("`n`n")) { return $text }
      if ($len -ge $buf.Length) { return '<<too-big>>' }
    } else {
      if (-not $Client.Connected) { break }
      if ($Client.Client.Poll(0, [System.Net.Sockets.SelectMode]::SelectRead) -and $Client.Available -eq 0) { break }  # closed
      $el = [Environment]::TickCount - $start
      if ($el -gt 5000 -or $el -lt 0) { return '<<timeout>>' }
      Invoke-Discovery
      Start-Sleep -Milliseconds 10
    }
  }
  if ($len -gt 0) { return [System.Text.Encoding]::ASCII.GetString($buf, 0, $len) }
  return $null
}

function Write-Status($Stream, [bool]$Head) {
  $m = @{}
  $mp = Join-Path $script:Root 'update.properties'
  if (Test-Path -LiteralPath $mp) {
    foreach ($l in [IO.File]::ReadAllLines($mp)) { $i = $l.IndexOf('='); if ($i -gt 0 -and -not $l.StartsWith('#')) { $m[$l.Substring(0, $i)] = $l.Substring($i + 1) } }
  }
  $cv = if ($m.ContainsKey('content.version')) { $m['content.version'] } else { '?' }
  $av = if ($m.ContainsKey('apk.versionCode')) { $m['apk.versionCode'] } else { '?' }
  Send-Text $Stream 200 'OK' "DroneSim update server OK`ncontent.version=$cv`napk.versionCode=$av`n" $Head ''
}

function Invoke-Http($Client) {
  $remote = '?'
  $name = ''
  try {
    $Client.NoDelay = $true
    $Client.SendTimeout = 30000
    $Client.ReceiveTimeout = 5000
    try { $remote = $Client.Client.RemoteEndPoint.Address.ToString() } catch { }
    $stream = $Client.GetStream()
    $head = Read-RequestHead $Client $stream
    if ($null -eq $head) { Emit @{ Kind = 'bad'; Client = $remote; Text = "$remote connected and closed without a request"; Color = 'DarkGray' }; return }
    if ($head -eq '<<timeout>>') { Send-Text $stream 408 'Request Timeout' "timeout`n" $false ''; Emit @{ Kind = 'bad'; Client = $remote; Text = "$remote sent no request in 5 s (408)"; Color = 'DarkGray' }; return }
    if ($head -eq '<<too-big>>') { Send-Text $stream 431 'Request Header Fields Too Large' "too big`n" $false ''; Emit @{ Kind = 'bad'; Client = $remote; Text = "$remote request too big (431)"; Color = 'DarkGray' }; return }
    $line = ($head -split "`r?`n")[0]
    $m = [regex]::Match($line, '^([A-Za-z]{1,10}) (\S{1,2048}) HTTP/1\.[01]$')
    if (-not $m.Success) { Send-Text $stream 400 'Bad Request' "bad request`n" $false ''; Emit @{ Kind = 'bad'; Client = $remote; Text = "$remote bad request (400)"; Color = 'DarkGray' }; return }
    $method = $m.Groups[1].Value.ToUpperInvariant()
    $target = $m.Groups[2].Value
    $isHead = ($method -eq 'HEAD')
    if ($method -ne 'GET' -and -not $isHead) { Send-Text $stream 405 'Method Not Allowed' "GET or HEAD only`n" $false "Allow: GET, HEAD`r`n"; Emit @{ Kind = 'bad'; Client = $remote; Text = "$remote $method refused (405)"; Color = 'DarkGray' }; return }
    $path = $target
    $q = $path.IndexOfAny([char[]]@('?', '#'))
    if ($q -ge 0) { $path = $path.Substring(0, $q) }
    if ($path -eq '/') { Write-Status $stream $isHead; Emit @{ Kind = 'status'; Client = $remote; Text = "$remote $method / (status page)" }; return }
    # only plain file names directly inside the folder: no '/', '\', '%', ':', '..' and no hidden files
    $name = if ($path.StartsWith('/')) { $path.Substring(1) } else { '' }
    $ext = ''
    $ok = $name -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' -and -not $name.Contains('..')
    if ($ok) { $ext = [IO.Path]::GetExtension($name).ToLowerInvariant(); $ok = $Types.ContainsKey($ext) }
    $full = $null
    if ($ok) {
      $full = [IO.Path]::GetFullPath((Join-Path $script:Root $name))
      $ok = ([IO.Path]::GetDirectoryName($full).TrimEnd('\') -ieq $script:Root) -and [IO.File]::Exists($full)
    }
    if (-not $ok) {
      Send-Text $stream 404 'Not Found' "not found`n" $isHead ''
      $shown = if ($target.Length -gt 80) { $target.Substring(0, 80) + '...' } else { $target }
      Emit @{ Kind = 'notfound'; Client = $remote; File = $shown; Text = "$remote $method $shown -> 404"; Color = 'DarkYellow' }
      return
    }
    $fs = New-Object System.IO.FileStream($full, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
                                          ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
    try {
      $total = $fs.Length
      $h = "HTTP/1.1 200 OK`r`nContent-Type: $($Types[$ext])`r`nContent-Length: $total`r`nCache-Control: no-store`r`n" +
           "X-Content-Type-Options: nosniff`r`nConnection: close`r`nServer: DroneSimUpdate`r`n`r`n"
      $hb = [System.Text.Encoding]::ASCII.GetBytes($h)
      $stream.Write($hb, 0, $hb.Length)
      if ($isHead) { Emit @{ Kind = 'head'; Client = $remote; File = $name; Total = $total; Text = "$remote HEAD $name ($(Format-MB $total))" }; return }
      $big = $total -ge 262144
      Emit @{ Kind = 'get'; Client = $remote; File = $name; Total = $total
              Text = $(if ($big) { "$remote downloading $name ($(Format-MB $total))..." } else { '' }) }
      $buf = New-Object byte[] 65536
      $sent = [long]0
      $lastPct = -100
      $lastQuarter = 0
      $t0 = [Environment]::TickCount
      while ($true) {
        $n = $fs.Read($buf, 0, $buf.Length)
        if ($n -le 0) { break }
        $stream.Write($buf, 0, $n)
        $sent += $n
        if ($big) {
          $pct = [int][Math]::Floor(100.0 * $sent / [Math]::Max(1, $total))
          if ($pct -ge $lastPct + 5 -or $sent -eq $total) {
            # console: one line at 25 / 50 / 75 %; the window gets every 5 %
            $quarter = [int][Math]::Floor($pct / 25)
            $line = ''
            if ($quarter -gt $lastQuarter -and $pct -lt 100) { $line = "  $name $pct%  ($(Format-MB $sent) / $(Format-MB $total))"; $lastQuarter = $quarter }
            Emit @{ Kind = 'progress'; Client = $remote; File = $name; Sent = $sent; Total = $total; Percent = $pct; Text = $line }
            $lastPct = $pct
          }
          Invoke-Discovery
          Invoke-Tick
        }
      }
      $stream.Flush()
      $secs = ([Environment]::TickCount - $t0) / 1000.0
      $txt = if ($name -eq 'update.properties') { "TV $remote checked for updates (update.properties)" }
             elseif ($name.EndsWith('.sig')) { '' }
             else { "TV {0} downloaded {1} ({2}, {3:N1} s)" -f $remote, $name, (Format-MB $sent), $secs }
      Emit @{ Kind = 'done'; Client = $remote; File = $name; Bytes = $sent; Seconds = $secs; Text = $txt; Color = 'Green' }
    } finally { $fs.Dispose() }
  } catch {
    Emit @{ Kind = 'abort'; Client = $remote; File = $name; Error = $_.Exception.Message
            Text = "$remote $(if ($name) { $name + ': ' } else { '' })connection ended early ($($_.Exception.Message))"; Color = 'Yellow' }
  } finally {
    try { $Client.Client.Shutdown([System.Net.Sockets.SocketShutdown]::Send) } catch { }
    try { $Client.Close() } catch { }
  }
}

# ------------------------------------------------------------------------------------------------ main
$script:OnEventCb = $OnEvent
$script:TickCb = $Tick
$script:LastTick = 0
$script:StopReason = ''
$script:Udp = $null
$script:LastDisc = ''
$script:LastDiscTime = 0
$script:Addrs = @()
$script:AddrTime = -100000
$script:Port = $Port
$listener = $null
$code = 0
try {
  try { $script:Root = [IO.Path]::GetFullPath($Dir).TrimEnd('\') } catch { throw "Bad -Dir: $Dir" }
  $bindAddr = $null
  if (-not [System.Net.IPAddress]::TryParse($Bind, [ref]$bindAddr) -or $bindAddr.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw "-Bind must be an IPv4 address like 0.0.0.0 or 127.0.0.1 (got '$Bind')." }
  $script:BindIp = $bindAddr.ToString()
  $loopOnly = $script:BindIp.StartsWith('127.')

  Say 'DroneSim update server'
  $man = Join-Path $script:Root 'update.properties'
  if (-not (Test-Path -LiteralPath $man) -or -not (Test-Path -LiteralPath ($man + '.sig'))) {
    throw "Nothing published in $($script:Root) yet: run publish-update.ps1 first (or double-click the desktop shortcut)."
  }
  $pub = @{}
  foreach ($l in [IO.File]::ReadAllLines($man)) { $i = $l.IndexOf('='); if ($i -gt 0 -and -not $l.StartsWith('#')) { $pub[$l.Substring(0, $i)] = $l.Substring($i + 1) } }
  foreach ($k in @('content.file', 'apk.file')) {
    if ($pub.ContainsKey($k) -and -not (Test-Path -LiteralPath (Join-Path $script:Root $pub[$k]))) { Warn "update.properties names $($pub[$k]) but the file is missing: publish again." }
  }
  $cv = if ($pub.ContainsKey('content.version')) { $pub['content.version'] } else { '?' }
  $av = if ($pub.ContainsKey('apk.versionCode')) { $pub['apk.versionCode'] } else { '?' }
  Note "Folder  : $($script:Root)  (content $cv, APK $av)"

  # ---- sockets (exclusive: a second server window must not silently share the ports)
  try {
    $listener = New-Object System.Net.Sockets.TcpListener($bindAddr, $Port)
    $listener.ExclusiveAddressUse = $true
    $listener.Start(16)
    $u = New-Object System.Net.Sockets.UdpClient   # IPv4 socket, not bound yet
    $u.ExclusiveAddressUse = $true
    $u.Client.Bind((New-Object System.Net.IPEndPoint($bindAddr, $DiscoveryPort)))
    try { [void]$u.Client.IOControl(-1744830452, [byte[]](0, 0, 0, 0), $null) } catch { }  # SIO_UDP_CONNRESET off
    $script:Udp = $u
  } catch [System.Net.Sockets.SocketException] {
    if ($_.Exception.SocketErrorCode -eq [System.Net.Sockets.SocketError]::AddressAlreadyInUse -or $_.Exception.SocketErrorCode -eq [System.Net.Sockets.SocketError]::AccessDenied) {
      $code = 4
      Emit @{ Kind = 'busy'; Text = "Port $Port or $DiscoveryPort is already in use: another update server window is probably still open. Close it and try again."; Color = 'Red' }
      throw 'port in use'
    }
    throw
  }

  $addrs = @()
  if ($loopOnly) { $urls = @("http://$($script:BindIp):$Port/") }
  elseif ($script:BindIp -ne '0.0.0.0') { $urls = @("http://$($script:BindIp):$Port/") }
  else {
    $addrs = @(Get-LocalIPv4); $script:Addrs = $addrs; $script:AddrTime = [Environment]::TickCount
    $urls = @($addrs | Where-Object { -not $_.Virtual } | ForEach-Object { "http://$($_.Ip):$Port/" })
    if ($urls.Count -eq 0) { $urls = @($addrs | ForEach-Object { "http://$($_.Ip):$Port/" }) }
  }
  foreach ($x in $urls) { Note "Address : $x" }
  Note "Discover: UDP $DiscoveryPort ('$Magic')"
  $noLan = (-not $loopOnly) -and $urls.Count -eq 0
  if ($noLan) { Warn 'This PC has no network address: connect it to the same Wi-Fi as the TV.' }

  $nw = Test-NetworkWarnings
  if (-not $loopOnly) {
    if ($nw.Public) { Warn "The network is set to 'Public' ($($nw.Profiles)). The TV may not reach this PC. Windows Settings -> Network & internet -> Wi-Fi (or Ethernet) -> your network -> Network profile type -> Private. (Nothing was changed.)" }
    if ($nw.Blocked) { Warn 'Windows Firewall has a BLOCK rule for Windows PowerShell (maybe "Cancel" was pressed once). Windows Security -> Firewall & network protection -> Allow an app through firewall -> Windows PowerShell -> tick Private.' }
    elseif (-not $nw.Allowed) { Note "First time: Windows Firewall asks about 'Windows PowerShell' -> tick 'Private networks' -> Allow access." }
  }
  $stopsText = if ($Minutes -gt 0) { "in $Minutes minutes (Ctrl+C or closing the window stops it now)" } else { 'with Ctrl+C' }
  Note "Stops   : $stopsText"
  Emit @{ Kind = 'start'; Urls = $urls; Content = $cv; Apk = $av; Public = $nw.Public; Blocked = $nw.Blocked; Allowed = $nw.Allowed
          NoLan = $noLan; Loopback = $loopOnly; Minutes = $Minutes; Text = 'Waiting for the TV... (open the app on the TV)'; Color = 'Cyan' }

  $deadline = if ($Minutes -gt 0) { [DateTime]::UtcNow.AddMinutes($Minutes) } else { [DateTime]::MaxValue }
  while ([DateTime]::UtcNow -lt $deadline -and -not $script:StopReason) {
    $busy = $false
    if ($script:Udp.Available -gt 0) { Invoke-Discovery; $busy = $true }
    if ($listener.Pending()) {
      $c = $null
      try { $c = $listener.AcceptTcpClient() } catch { $c = $null }
      if ($c) { Invoke-Http $c }
      $busy = $true
    }
    Invoke-Tick
    if (-not $busy) { Start-Sleep -Milliseconds 25 }
  }
  if (-not $script:StopReason) { $script:StopReason = 'time' }
  Emit @{ Kind = 'stop'; Reason = $script:StopReason; Text = $(if ($script:StopReason -eq 'time') { 'Time is up: update server stopped.' } else { 'Update server stopped.' }); Color = 'Cyan' }
}
catch {
  if ($code -eq 0) { $code = 1 }
  if ($_.Exception.Message -ne 'port in use') {
    Write-Host "UPDATE SERVER FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Emit @{ Kind = 'error'; Error = $_.Exception.Message }
  }
}
finally {
  if ($listener) { try { $listener.Stop() } catch { } }
  if ($script:Udp) { try { $script:Udp.Close() } catch { } }
}
exit $code
