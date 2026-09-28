use std::ffi::OsStr;
use std::process::Command;

pub(crate) fn background_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Do not allocate a console for Codex or OpenUsage.
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn child_has_no_console_and_can_return_output() {
        let output = background_command("powershell.exe")
            .args([
                "-NoProfile",
                "-Command",
                "Add-Type 'using System; using System.Runtime.InteropServices; public class WinConsole { [DllImport(\"kernel32.dll\")] public static extern IntPtr GetConsoleWindow(); }'; [WinConsole]::GetConsoleWindow().ToInt64()",
            ])
            .output()
            .expect("start hidden child");
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "0");
    }
}
