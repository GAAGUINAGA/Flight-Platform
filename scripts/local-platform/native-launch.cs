using System;
using System.IO;
using System.Runtime.InteropServices;

// F12c-1: lanza un proceso con CreateProcess y una lista EXPLICITA de manejadores heredables (solo los archivos de log como stdio).
// Start-Process / Process.Start dejan heredar las tuberias de la consola, y `local:up | Select-String` no terminaria mientras viva un servicio.
public static class NativeLaunch {
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr prev, IntPtr ret);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessW(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateFileW(string name, uint access, uint share, ref SECURITY_ATTRIBUTES sa, uint disposition, uint flags, IntPtr template);

  static IntPtr Open(string path, uint access, uint disposition) {
    var sa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), bInheritHandle = 1 };
    IntPtr h = CreateFileW(path, access, 3, ref sa, disposition, 0x80, IntPtr.Zero);
    if (h == new IntPtr(-1)) throw new IOException("No se pudo abrir " + path + " (" + Marshal.GetLastWin32Error() + ")");
    return h;
  }

  // commandLine completa (con comillas ya puestas); el entorno es el del proceso actual.
  public static int Start(string commandLine, string workDir, string outLog, string errLog) {
    IntPtr hIn = Open("NUL", 0x80000000, 3), hOut = Open(outLog, 0x40000000, 2), hErr = Open(errLog, 0x40000000, 2);
    IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
    IntPtr list = Marshal.AllocHGlobal(size); IntPtr handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
    try {
      if (!InitializeProcThreadAttributeList(list, 1, 0, ref size)) throw new InvalidOperationException("InitializeProcThreadAttributeList " + Marshal.GetLastWin32Error());
      Marshal.WriteIntPtr(handles, 0, hIn); Marshal.WriteIntPtr(handles, IntPtr.Size, hOut); Marshal.WriteIntPtr(handles, IntPtr.Size * 2, hErr);
      // PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x20002
      if (!UpdateProcThreadAttribute(list, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero)) throw new InvalidOperationException("UpdateProcThreadAttribute " + Marshal.GetLastWin32Error());
      var si = new STARTUPINFOEX();
      si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX)); si.StartupInfo.dwFlags = 0x100 | 0x1; si.StartupInfo.wShowWindow = 0; // USESTDHANDLES | USESHOWWINDOW (oculta)
      si.StartupInfo.hStdInput = hIn; si.StartupInfo.hStdOutput = hOut; si.StartupInfo.hStdError = hErr; si.lpAttributeList = list;
      PROCESS_INFORMATION pi;
      // EXTENDED_STARTUPINFO_PRESENT | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
      if (!CreateProcessW(null, commandLine, IntPtr.Zero, IntPtr.Zero, true, 0x80000 | 0x200 | 0x8000000, IntPtr.Zero, workDir, ref si, out pi)) throw new InvalidOperationException("CreateProcess " + Marshal.GetLastWin32Error());
      CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
      return pi.dwProcessId;
    } finally { DeleteProcThreadAttributeList(list); Marshal.FreeHGlobal(list); Marshal.FreeHGlobal(handles); CloseHandle(hIn); CloseHandle(hOut); CloseHandle(hErr); }
  }
}
