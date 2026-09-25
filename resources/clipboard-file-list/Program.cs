using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Web.Script.Serialization;
internal static class Program {
  [DllImport("user32.dll", SetLastError = true)] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
  [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint format);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern uint DragQueryFileW(IntPtr drop, uint index, StringBuilder path, uint length);
  [STAThread] static int Main(string[] args) {
    if (args.Length != 0) return 2;
    Console.OutputEncoding = new UTF8Encoding(false);
    bool opened = false;
    try {
      for (int attempt = 0; attempt < 10 && !opened; attempt++) { opened = OpenClipboard(IntPtr.Zero); if (!opened) System.Threading.Thread.Sleep(20); }
      if (!opened) return 3;
      var paths = new List<string>();
      if (IsClipboardFormatAvailable(15)) {
        IntPtr drop = GetClipboardData(15); if (drop == IntPtr.Zero) return 4;
        uint count = DragQueryFileW(drop, 0xffffffff, null, 0); if (count > 200) return 5;
        for (uint index = 0; index < count; index++) {
          uint length = DragQueryFileW(drop, index, null, 0); if (length == 0 || length > 32767) return 6;
          var path = new StringBuilder((int)length + 1);
          if (DragQueryFileW(drop, index, path, length + 1) != length) return 7;
          paths.Add(path.ToString());
        }
      }
      Console.Write(new JavaScriptSerializer().Serialize(paths)); return 0;
    } catch { return 8; }
    finally { if (opened) CloseClipboard(); }
  }
}
