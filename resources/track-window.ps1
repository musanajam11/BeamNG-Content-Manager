# Long-running window tracker. Polls GetWindowRect for the main top-level
# window owned by the given PID and writes JSON lines to stdout:
#   {"event":"rect","x":..,"y":..,"w":..,"h":..,"min":true|false}
#   {"event":"gone"}
#
# NOTE: parameter is named -TargetPid because $Pid is a built-in PowerShell
# automatic variable holding the current shell's own process ID. Using $Pid
# as a param name silently shadows the wrong value and breaks process lookup.

param(
  [Parameter(Mandatory=$true)][int]$TargetPid,
  [int]$IntervalMs = 200
)

$ErrorActionPreference = 'Continue'

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WT {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

function Get-MainWindowForPid([int]$wantedPid) {
  $script:found = [IntPtr]::Zero
  $script:bestArea = 0
  $cb = [WT+EnumWindowsProc]{
    param($h, $l)
    $procId = 0
    [void][WT]::GetWindowThreadProcessId($h, [ref]$procId)
    if ([int]$procId -ne $wantedPid) { return $true }
    if (-not [WT]::IsWindowVisible($h)) { return $true }
    $len = [WT]::GetWindowTextLength($h)
    if ($len -eq 0) { return $true }
    $r = New-Object WT+RECT
    [void][WT]::GetWindowRect($h, [ref]$r)
    $area = ($r.Right - $r.Left) * ($r.Bottom - $r.Top)
    if ($area -gt $script:bestArea) {
      $script:bestArea = $area
      $script:found = $h
    }
    return $true
  }
  [void][WT]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:found
}

# Steam launches BeamNG via a shim, so the supplied PID may not own the game
# window. Fall back to the largest visible top-level window owned by any
# process named like BeamNG.drive.* if the supplied PID has no window yet.
function Get-BeamNGFallback {
  try {
    $procs = Get-Process -Name 'BeamNG.drive*' -ErrorAction SilentlyContinue
    foreach ($p in $procs) {
      $h = Get-MainWindowForPid -wantedPid $p.Id
      if ($h -ne [IntPtr]::Zero) { return @{ Hwnd = $h; Pid = $p.Id } }
    }
  } catch { }
  return $null
}

function Write-Json([string]$s) {
  [Console]::Out.WriteLine($s)
  [Console]::Out.Flush()
}

$hwnd = [IntPtr]::Zero
$activePid = $TargetPid
$startMs = [Environment]::TickCount
# Give BeamNG up to 60s to create its main window.
while (([Environment]::TickCount - $startMs) -lt 60000) {
  $hwnd = Get-MainWindowForPid -wantedPid $activePid
  if ($hwnd -ne [IntPtr]::Zero) { break }
  # Steam shim PID won't own a window — try the BeamNG.drive.* process(es).
  $fb = Get-BeamNGFallback
  if ($fb -ne $null) {
    $hwnd = $fb.Hwnd
    $activePid = $fb.Pid
    break
  }
  try { Get-Process -Id $TargetPid -ErrorAction Stop | Out-Null } catch {
    # Original PID gone, but BeamNG might still be launching via Steam — keep
    # waiting on the name-based fallback for the rest of the 60s window.
  }
  Start-Sleep -Milliseconds 250
}

if ($hwnd -eq [IntPtr]::Zero) {
  Write-Json '{"event":"gone"}'
  exit 0
}

while ($true) {
  if (-not [WT]::IsWindow($hwnd)) {
    Write-Json '{"event":"gone"}'
    exit 0
  }
  try { Get-Process -Id $activePid -ErrorAction Stop | Out-Null } catch {
    Write-Json '{"event":"gone"}'
    exit 0
  }
  $r = New-Object WT+RECT
  if ([WT]::GetWindowRect($hwnd, [ref]$r)) {
    $min = [WT]::IsIconic($hwnd)
    $w = $r.Right - $r.Left
    $h = $r.Bottom - $r.Top
    $minStr = if ($min) { 'true' } else { 'false' }
    $payload = '{"event":"rect","x":' + $r.Left + ',"y":' + $r.Top + ',"w":' + $w + ',"h":' + $h + ',"min":' + $minStr + '}'
    Write-Json $payload
  }
  Start-Sleep -Milliseconds $IntervalMs
}
