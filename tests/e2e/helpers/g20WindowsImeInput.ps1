param(
  [Parameter(Mandatory)][ValidateSet('snapshot', 'geometry', 'candidate', 'focus', 'type', 'enter', 'shift-enter', 'space', 'down', 'restore')][string]$Action,
  [long]$Window = 0,
  [int]$ProcessId = 0,
  [long]$Previous = 0,
  [string]$Text = '',
  [string]$CapturePath = ''
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class G20NativeKeyboard {
  [StructLayout(LayoutKind.Sequential)] public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO {
    public uint cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit, Size = 32)] public struct INPUTUNION {
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT {
    public uint type;
    public INPUTUNION U;
  }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool activate);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint source, uint target, bool attach);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint threadId);
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
}
'@

function Assert-Target {
  $foreground = [G20NativeKeyboard]::GetForegroundWindow()
  if ($foreground.ToInt64() -ne $Window) { throw "Foreground changed: expected $Window, got $($foreground.ToInt64()); no key was sent" }
  [uint32]$owner = 0
  [void][G20NativeKeyboard]::GetWindowThreadProcessId($foreground, [ref]$owner)
  if ($owner -ne $ProcessId) { throw "Foreground process changed: expected $ProcessId, got $owner; no key was sent" }
}
function Send-Key([uint16]$code, [bool]$release) {
  Assert-Target
  $input = New-Object G20NativeKeyboard+INPUT
  $input.type = 1
  $keyboard = New-Object G20NativeKeyboard+KEYBDINPUT
  $keyboard.wVk = $code
  $keyboard.dwFlags = if ($release) { 2 } else { 0 }
  $union = New-Object G20NativeKeyboard+INPUTUNION
  $union.ki = $keyboard
  $input.U = $union
  $sent = [G20NativeKeyboard]::SendInput(1, @($input), [Runtime.InteropServices.Marshal]::SizeOf([type][G20NativeKeyboard+INPUT]))
  if ($sent -ne 1) { throw "SendInput failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
}
function Press-Key([uint16]$code) {
  Send-Key $code $false
  Send-Key $code $true
}
function Get-PhysicalGeometry {
  # PowerShell's default DPI context can return virtualized 1560x1040 bounds
  # on a 3120x2080 monitor. Query and capture in Per Monitor V2 coordinates.
  $previousDpi = [G20NativeKeyboard]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
  if ($previousDpi -eq [IntPtr]::Zero) { throw "Cannot enter physical DPI context: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  try {
    $hwnd = [IntPtr]::new($Window)
    $windowRect = New-Object G20NativeKeyboard+RECT
    if (-not [G20NativeKeyboard]::GetWindowRect($hwnd, [ref]$windowRect)) { throw 'GetWindowRect failed' }
    $monitor = [G20NativeKeyboard]::MonitorFromWindow($hwnd, 2)
    if ($monitor -eq [IntPtr]::Zero) { throw 'MonitorFromWindow failed' }
    $monitorInfo = New-Object G20NativeKeyboard+MONITORINFO
    $monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][G20NativeKeyboard+MONITORINFO])
    if (-not [G20NativeKeyboard]::GetMonitorInfo($monitor, [ref]$monitorInfo)) { throw 'GetMonitorInfo failed' }
    if ($CapturePath) {
      Add-Type -AssemblyName System.Drawing
      $area = $monitorInfo.rcMonitor
      $bitmap = New-Object System.Drawing.Bitmap(($area.Right - $area.Left), ($area.Bottom - $area.Top))
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.CopyFromScreen($area.Left, $area.Top, 0, 0, $bitmap.Size)
        $bitmap.Save($CapturePath, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
      }
    }
    return @{ window = @{ left = $windowRect.Left; top = $windowRect.Top; right = $windowRect.Right; bottom = $windowRect.Bottom };
      monitor = @{ left = $monitorInfo.rcMonitor.Left; top = $monitorInfo.rcMonitor.Top; right = $monitorInfo.rcMonitor.Right; bottom = $monitorInfo.rcMonitor.Bottom };
      workArea = @{ left = $monitorInfo.rcWork.Left; top = $monitorInfo.rcWork.Top; right = $monitorInfo.rcWork.Right; bottom = $monitorInfo.rcWork.Bottom };
      dpi = [G20NativeKeyboard]::GetDpiForWindow($hwnd) }
  } finally {
    [void][G20NativeKeyboard]::SetThreadDpiAwarenessContext($previousDpi)
  }
}

if ($Action -eq 'snapshot') {
  $foreground = [G20NativeKeyboard]::GetForegroundWindow()
  [uint32]$owner = 0
  $thread = [G20NativeKeyboard]::GetWindowThreadProcessId($foreground, [ref]$owner)
  @{ foreground = $foreground.ToInt64(); processId = $owner; keyboardLayout = [G20NativeKeyboard]::GetKeyboardLayout($thread).ToInt64() } | ConvertTo-Json -Compress
  exit 0
}
if ($Action -eq 'restore') {
  # Never steal focus from a window that became active while the test was running.
  if ([G20NativeKeyboard]::GetForegroundWindow().ToInt64() -ne $Window) { exit 0 }
  if ($Previous -ne 0 -and [G20NativeKeyboard]::IsWindow([IntPtr]::new($Previous))) {
    [uint32]$activeOwner = 0
    $activeThread = [G20NativeKeyboard]::GetWindowThreadProcessId([IntPtr]::new($Window), [ref]$activeOwner)
    [uint32]$previousOwner = 0
    $previousThread = [G20NativeKeyboard]::GetWindowThreadProcessId([IntPtr]::new($Previous), [ref]$previousOwner)
    $helperThread = [G20NativeKeyboard]::GetCurrentThreadId()
    $attachedActive = $activeThread -ne $helperThread -and [G20NativeKeyboard]::AttachThreadInput($helperThread, $activeThread, $true)
    $attachedPrevious = $previousThread -ne $helperThread -and $previousThread -ne $activeThread -and [G20NativeKeyboard]::AttachThreadInput($helperThread, $previousThread, $true)
    try {
      [void][G20NativeKeyboard]::ShowWindow([IntPtr]::new($Previous), 9)
      [void][G20NativeKeyboard]::SetForegroundWindow([IntPtr]::new($Previous))
      if ([G20NativeKeyboard]::GetForegroundWindow().ToInt64() -ne $Previous) {
        [G20NativeKeyboard]::SwitchToThisWindow([IntPtr]::new($Previous), $true)
      }
      if ([G20NativeKeyboard]::GetForegroundWindow().ToInt64() -ne $Previous) { throw 'Original foreground window could not be restored' }
    } finally {
      if ($attachedPrevious) { [void][G20NativeKeyboard]::AttachThreadInput($helperThread, $previousThread, $false) }
      if ($attachedActive) { [void][G20NativeKeyboard]::AttachThreadInput($helperThread, $activeThread, $false) }
    }
  }
  exit 0
}
if ($Window -eq 0 -or $ProcessId -eq 0) { throw 'Target HWND and process are required' }
if ($Action -eq 'focus') {
  [uint32]$owner = 0
  $targetThread = [G20NativeKeyboard]::GetWindowThreadProcessId([IntPtr]::new($Window), [ref]$owner)
  if ($owner -ne $ProcessId) { throw "Target HWND is not owned by test process $ProcessId" }
  $foreground = [G20NativeKeyboard]::GetForegroundWindow()
  [uint32]$foregroundOwner = 0
  $foregroundThread = [G20NativeKeyboard]::GetWindowThreadProcessId($foreground, [ref]$foregroundOwner)
  $helperThread = [G20NativeKeyboard]::GetCurrentThreadId()
  $attached = $foregroundThread -ne $helperThread -and [G20NativeKeyboard]::AttachThreadInput($helperThread, $foregroundThread, $true)
  $attachedTarget = $targetThread -ne $helperThread -and $targetThread -ne $foregroundThread -and [G20NativeKeyboard]::AttachThreadInput($helperThread, $targetThread, $true)
  try {
    [void][G20NativeKeyboard]::ShowWindow([IntPtr]::new($Window), 9)
    [void][G20NativeKeyboard]::SetForegroundWindow([IntPtr]::new($Window))
    if ([G20NativeKeyboard]::GetForegroundWindow().ToInt64() -ne $Window) {
      [G20NativeKeyboard]::SwitchToThisWindow([IntPtr]::new($Window), $true)
    }
  } finally {
    if ($attachedTarget) { [void][G20NativeKeyboard]::AttachThreadInput($helperThread, $targetThread, $false) }
    if ($attached) { [void][G20NativeKeyboard]::AttachThreadInput($helperThread, $foregroundThread, $false) }
  }
  Assert-Target
  exit 0
}
Assert-Target
if ($Action -eq 'geometry') {
  Get-PhysicalGeometry | ConvertTo-Json -Depth 5 -Compress
  exit 0
}
if ($Action -eq 'candidate') {
  if ($CapturePath) {
    # Page screenshots omit the system-owned IME popup.
    [void](Get-PhysicalGeometry)
  }
  # Windows exposes the live IME conversion list through UI Automation. A
  # compositionstart event alone also occurs in English mode, so it cannot
  # establish that a Chinese candidate was offered to the user.
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $condition = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty), 'IME_Candidate_Window'
  $matches = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  $visible = @()
  foreach ($item in $matches) {
    try {
      if (-not $item.Current.IsOffscreen) {
        $names = @($item.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) |
          ForEach-Object { $_.Current.Name } | Where-Object { $_ })
        $visible += @{ automationId = $item.Current.AutomationId; name = $item.Current.Name; candidates = $names }
      }
    } catch [System.Windows.Automation.ElementNotAvailableException] {
      # The candidate list can close while UI Automation is reading it.
    }
  }
  @{ visible = $visible.Count -gt 0; lists = $visible } | ConvertTo-Json -Depth 5 -Compress
  exit 0
}
if ($Action -eq 'type') {
  if ($Text -notmatch '^[a-zA-Z]+$') { throw 'Native IME probe only accepts unshifted Latin letters' }
  foreach ($letter in $Text.ToUpperInvariant().ToCharArray()) {
    Press-Key ([uint16][char]$letter)
    Start-Sleep -Milliseconds 35
  }
} elseif ($Action -eq 'enter') {
  Press-Key 13
} elseif ($Action -eq 'shift-enter') {
  Send-Key 16 $false
  try { Press-Key 13 } finally { Send-Key 16 $true }
} elseif ($Action -eq 'space') {
  Press-Key 32
} elseif ($Action -eq 'down') {
  Press-Key 40
}
