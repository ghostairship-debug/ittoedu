using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
internal static class Program {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool MoveFileExW(string source, string target, uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool GetVolumePathNameW(string path, StringBuilder volume, uint length);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool GetVolumeInformationW(string root, StringBuilder name, uint nameLength, out uint serial, out uint maxName, out uint flags, StringBuilder fsName, uint fsLength);
  static int Report(string status, int code) { Console.Write("{\"status\":\"" + status + "\",\"code\":" + code + "}"); return 0; }
  static int Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false);
    if (args.Length != 3) return Report("rejected", 87);
    try {
      string source=Path.GetFullPath(args[0]), target=Path.GetFullPath(args[1]);
      if (!String.Equals(Path.GetDirectoryName(source),Path.GetDirectoryName(target),StringComparison.OrdinalIgnoreCase)
        || String.Equals(source,target,StringComparison.OrdinalIgnoreCase)) return Report("rejected",87);
      if ((File.GetAttributes(source) & (FileAttributes.ReparsePoint|FileAttributes.Directory)) != 0) return Report("rejected",87);
      if (args[2] == "no-hardlinks-only") {
        var volume=new StringBuilder(32768); uint serial, maxName, flags;
        if (!GetVolumePathNameW(source,volume,(uint)volume.Capacity)) return Report("rejected",Marshal.GetLastWin32Error());
        if (!GetVolumeInformationW(volume.ToString(),null,0,out serial,out maxName,out flags,null,0)) return Report("rejected",Marshal.GetLastWin32Error());
        if ((flags & 0x00400000) != 0) return Report("hardlinks-supported",0);
      } else if (args[2] != "same-directory") return Report("rejected",87);
      // No REPLACE_EXISTING or COPY_ALLOWED: existing targets and cross-volume moves fail.
      if (MoveFileExW(source,target,8)) return Report("published",0);
      return Report("rejected",Marshal.GetLastWin32Error());
    } catch (IOException) { return Report("rejected",5); }
      catch (UnauthorizedAccessException) { return Report("rejected",5); }
      catch (ArgumentException) { return Report("rejected",87); }
      catch { return Report("unknown",0); }
  }
}
