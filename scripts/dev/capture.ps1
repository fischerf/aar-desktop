# Dev helper: print the Aar window rect and capture its content via PrintWindow
# (works even when the shell has no access to the interactive desktop).
# Transparent areas show up black. Usage: powershell -File scripts/dev/capture.ps1 [-Out file.png]
param([string]$Out = "$env:TEMP\aar-capture.png")
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class AarWin {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  public static IntPtr Find(uint target) { IntPtr found = IntPtr.Zero;
    EnumWindows((h,p)=>{ uint pid; GetWindowThreadProcessId(h,out pid); var sb=new StringBuilder(64); GetWindowText(h,sb,64);
      if(pid==target && sb.ToString()=="Aar"){ found=h; return false; } return true; }, IntPtr.Zero); return found; }
}
"@
$p = Get-Process aar-desktop -ErrorAction Stop | Select-Object -First 1
$h = [AarWin]::Find([uint32]$p.Id)
$r = New-Object AarWin+RECT
[AarWin]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L; $hh = $r.B - $r.T
"visible=$([AarWin]::IsWindowVisible($h)) pos=$($r.L),$($r.T) size=${w}x${hh}"
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc(); [AarWin]::PrintWindow($h, $hdc, 2) | Out-Null; $g.ReleaseHdc($hdc); $g.Dispose()
$bmp.Save($Out); $bmp.Dispose()
$Out

