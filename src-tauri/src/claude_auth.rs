use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

pub(crate) const REFRESH_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RefreshError {
    NotFound,
    Start,
    Failed,
    Timeout,
}

// Resolve only installed executables, never cwd-relative commands or shell shims.
pub(crate) fn find_claude(
    search_path: Option<&std::ffi::OsStr>,
    home: Option<&Path>,
    app_data: Option<&Path>,
) -> Option<PathBuf> {
    let mut dirs = search_path
        .map(|value| std::env::split_paths(value).collect::<Vec<_>>())
        .unwrap_or_default();
    if let Some(home) = home.filter(|path| path.is_absolute()) {
        dirs.push(home.join(".local/bin"));
    }
    if let Some(app_data) = app_data.filter(|path| path.is_absolute()) {
        dirs.push(app_data.join("npm"));
    }
    dirs.into_iter()
        .filter(|dir| dir.is_absolute())
        .find_map(|dir| {
            [
                dir.join("claude.exe"),
                dir.join("node_modules/@anthropic-ai/claude-code/bin/claude.exe"),
            ]
            .into_iter()
            .find(|path| path.is_file())
        })
}

pub(crate) async fn refresh(working_dir: &Path) -> Result<(), RefreshError> {
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let app_data = std::env::var_os("APPDATA").map(PathBuf::from);
    let path = find_claude(
        std::env::var_os("PATH").as_deref(),
        home.as_deref(),
        app_data.as_deref(),
    )
    .ok_or(RefreshError::NotFound)?;
    std::fs::create_dir_all(working_dir).map_err(|_| RefreshError::Start)?;
    refresh_from_path(&path, &[], working_dir, REFRESH_TIMEOUT).await
}

async fn refresh_from_path(
    path: &Path,
    args: &[&str],
    working_dir: &Path,
    timeout: Duration,
) -> Result<(), RefreshError> {
    tokio::time::timeout(timeout, async {
        let mut command = crate::process::background_command(path);
        command
            .command_mut()
            .args(args)
            .current_dir(working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command.spawn().map_err(|_| RefreshError::Start)?;
        let mut stdin = child.stdin().take().ok_or(RefreshError::Failed)?;
        // Match '/exit' | claude: supply the command immediately, then close input.
        stdin
            .write_all(b"/exit\r\n")
            .await
            .map_err(|_| RefreshError::Failed)?;
        stdin.shutdown().await.map_err(|_| RefreshError::Failed)?;
        drop(stdin);
        loop {
            if let Some(status) = child.try_wait().map_err(|_| RefreshError::Failed)? {
                return if status.success() {
                    Ok(())
                } else {
                    Err(RefreshError::Failed)
                };
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or(Err(RefreshError::Timeout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_supports_native_and_npm_without_shell_shims() {
        let root = tempfile::tempdir().unwrap();
        let prefix = root.path().join("npm");
        let binary = prefix.join("node_modules/@anthropic-ai/claude-code/bin/claude.exe");
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        std::fs::write(prefix.join("claude.cmd"), "fixture").unwrap();
        let path = std::env::join_paths([&prefix]).unwrap();
        assert_eq!(find_claude(Some(&path), None, None), None);
        std::fs::write(&binary, "fixture").unwrap();
        assert_eq!(find_claude(Some(&path), None, None), Some(binary));
        let native = prefix.join("claude.exe");
        std::fs::write(&native, "fixture").unwrap();
        assert_eq!(find_claude(Some(&path), None, None), Some(native));
        assert_eq!(
            find_claude(Some(std::ffi::OsStr::new(".")), None, None),
            None
        );
    }

    #[test]
    fn discovery_falls_back_to_known_install_directories() {
        let root = tempfile::tempdir().unwrap();
        let native = root.path().join(".local/bin/claude.exe");
        std::fs::create_dir_all(native.parent().unwrap()).unwrap();
        std::fs::write(&native, "fixture").unwrap();
        assert_eq!(find_claude(None, Some(root.path()), None), Some(native));
        let npm = root
            .path()
            .join("npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe");
        std::fs::create_dir_all(npm.parent().unwrap()).unwrap();
        std::fs::write(&npm, "fixture").unwrap();
        assert_eq!(find_claude(None, None, Some(root.path())), Some(npm));
    }

    #[test]
    #[ignore = "subprocess fixture"]
    fn exit_input_fixture() {
        if !std::env::args().any(|arg| arg == "claude_auth::tests::exit_input_fixture") {
            return;
        }
        use std::io::Read;
        let mut input = String::new();
        std::io::stdin().read_to_string(&mut input).unwrap();
        assert_eq!(input, "/exit\r\n");
    }

    #[test]
    #[ignore = "subprocess fixture"]
    fn slow_exit_fixture() {
        if std::env::args().any(|arg| arg == "claude_auth::tests::slow_exit_fixture") {
            std::thread::sleep(Duration::from_secs(20));
        }
    }

    #[test]
    fn refresh_sends_only_exit_and_closes_stdin() {
        tauri::async_runtime::block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let result = refresh_from_path(
                &std::env::current_exe().unwrap(),
                &[
                    "--ignored",
                    "--exact",
                    "claude_auth::tests::exit_input_fixture",
                ],
                dir.path(),
                Duration::from_secs(5),
            )
            .await;
            assert_eq!(result, Ok(()));
        });
    }

    #[test]
    fn refresh_stops_on_deadline_and_classifies_start_failure() {
        tauri::async_runtime::block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let result = refresh_from_path(
                &std::env::current_exe().unwrap(),
                &[
                    "--ignored",
                    "--exact",
                    "claude_auth::tests::slow_exit_fixture",
                ],
                dir.path(),
                Duration::from_millis(200),
            )
            .await;
            assert_eq!(result, Err(RefreshError::Timeout));
            assert_eq!(
                refresh_from_path(
                    &dir.path().join("missing.exe"),
                    &[],
                    dir.path(),
                    Duration::from_secs(1)
                )
                .await,
                Err(RefreshError::Start)
            );
        });
    }
}
