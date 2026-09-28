use process_wrap::tokio::{CommandWrap, KillOnDrop};
use std::ffi::OsStr;

pub(crate) fn background_command(program: impl AsRef<OsStr>) -> CommandWrap {
    let mut command = CommandWrap::with_new(program, |_| {});
    command.wrap(KillOnDrop);
    #[cfg(windows)]
    {
        use process_wrap::tokio::{CreationFlags, JobObject};
        use windows::Win32::System::Threading::CREATE_NO_WINDOW;
        // Assign before resuming the process. Closing our non-inheritable job handle
        // stops every descendant, including when the app exits during retrieval.
        command
            .wrap(CreationFlags(CREATE_NO_WINDOW))
            .wrap(JobObject);
    }
    command
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::process::Stdio;
    use std::time::Duration;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

    pub(crate) const DESCENDANT_FIXTURE: &str = "process::tests::descendant_fixture";

    // Run the test binary as a controlled subprocess; these helpers are not normal tests.
    #[test]
    #[ignore = "subprocess fixture"]
    fn pipe_holder_fixture() {
        if std::env::args().any(|arg| arg == "process::tests::pipe_holder_fixture") {
            std::thread::sleep(Duration::from_secs(20));
        }
    }

    #[test]
    #[ignore = "subprocess fixture"]
    #[allow(clippy::zombie_processes)] // This fixture deliberately exits before its descendant.
    fn descendant_fixture() {
        if !std::env::args().any(|arg| arg == DESCENDANT_FIXTURE) {
            return;
        }
        use std::os::windows::process::CommandExt;
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "process::tests::pipe_holder_fixture",
                "--nocapture",
            ])
            .creation_flags(0x08000000)
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        println!("limitview-descendant:{}", child.id());
        // Intentionally leave a descendant holding stdout after this parent exits.
    }

    #[test]
    fn dropping_job_stops_descendant_after_parent_exits() {
        tauri::async_runtime::block_on(async {
            let mut command = background_command(std::env::current_exe().unwrap());
            command
                .command_mut()
                .args(["--ignored", "--exact", DESCENDANT_FIXTURE, "--nocapture"])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            let mut child = command.spawn().unwrap();
            let stdout = child.stdout().take().unwrap();
            let mut reader = BufReader::new(stdout);
            tokio::time::timeout(Duration::from_secs(3), async {
                loop {
                    let mut line = String::new();
                    assert_ne!(reader.read_line(&mut line).await.unwrap(), 0);
                    if line.contains("limitview-descendant:") {
                        break;
                    }
                }
                while child.try_wait().unwrap().is_none() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("fixture parent must exit while descendant holds stdout");
            drop(child);
            let mut remaining = Vec::new();
            tokio::time::timeout(Duration::from_secs(2), reader.read_to_end(&mut remaining))
                .await
                .expect("job drop must close descendant's pipe")
                .unwrap();
        });
    }

    #[test]
    fn child_has_no_console_and_can_return_output() {
        tauri::async_runtime::block_on(async {
            let mut command = background_command("powershell.exe");
            command.command_mut().args([
                "-NoProfile",
                "-Command",
                "Add-Type 'using System; using System.Runtime.InteropServices; public class WinConsole { [DllImport(\"kernel32.dll\")] public static extern IntPtr GetConsoleWindow(); }'; [WinConsole]::GetConsoleWindow().ToInt64()",
            ]).stdout(std::process::Stdio::piped());
            let output = Box::into_pin(
                command
                    .spawn()
                    .expect("start hidden child")
                    .wait_with_output(),
            )
            .await
            .expect("start hidden child");
            assert!(output.status.success());
            assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "0");
        });
    }
}
