use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;
use thiserror::Error;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const MAX_PACKAGE_FILES: usize = 32;
pub const MAX_PACKAGE_UNCOMPRESSED_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum ProjectStoreError {
    #[error("package-invalid: {0}")]
    PackageInvalid(String),
    #[error("io-error: {0}")]
    Io(#[from] std::io::Error),
}

pub fn validate_zip_entry_path(entry: &str) -> Result<(), ProjectStoreError> {
    if entry.is_empty() || entry.contains('\\') || entry.starts_with('/') {
        return Err(ProjectStoreError::PackageInvalid(format!(
            "Illegal zip entry path: {entry}"
        )));
    }
    if entry.len() >= 2 && entry.as_bytes()[1] == b':' {
        return Err(ProjectStoreError::PackageInvalid(format!(
            "Drive prefix forbidden in zip entry: {entry}"
        )));
    }
    let path = Path::new(entry);
    for comp in path.components() {
        if matches!(
            comp,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) {
            return Err(ProjectStoreError::PackageInvalid(format!(
                "Path traversal in zip entry: {entry}"
            )));
        }
    }
    if entry == "manifest.json" || entry == "sticker.webp" || entry == "sound.ogg" {
        return Ok(());
    }
    let parts: Vec<&str> = entry.split('/').collect();
    if parts.len() == 2
        && parts[0] == "assets"
        && !parts[1].is_empty()
        && parts[1]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Ok(());
    }
    Err(ProjectStoreError::PackageInvalid(format!(
        "Disallowed zip entry: {entry}"
    )))
}

pub fn write_zip_bytes(entries: &[(&str, &[u8])]) -> Result<Vec<u8>, ProjectStoreError> {
    if entries.len() > MAX_PACKAGE_FILES {
        return Err(ProjectStoreError::PackageInvalid(
            "Too many zip entries".to_string(),
        ));
    }
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for &(path, bytes) in entries {
            validate_zip_entry_path(path)?;
            writer
                .start_file(path, options)
                .map_err(|e| ProjectStoreError::PackageInvalid(format!("Zip start_file: {e}")))?;
            writer.write_all(bytes)?;
        }
        writer
            .finish()
            .map_err(|e| ProjectStoreError::PackageInvalid(format!("Zip finish: {e}")))?;
    }
    Ok(cursor.into_inner())
}

pub fn read_zip_package(zip_bytes: &[u8]) -> Result<HashMap<String, Vec<u8>>, ProjectStoreError> {
    let mut archive = ZipArchive::new(Cursor::new(zip_bytes))
        .map_err(|e| ProjectStoreError::PackageInvalid(format!("Invalid zip archive: {e}")))?;

    if archive.len() > MAX_PACKAGE_FILES {
        return Err(ProjectStoreError::PackageInvalid(
            "Package exceeds 32 entry limit".to_string(),
        ));
    }

    let mut total_uncompressed: u64 = 0;
    let mut out = HashMap::new();

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| ProjectStoreError::PackageInvalid(format!("Zip read entry: {e}")))?;
        let name = file.name().to_string();
        validate_zip_entry_path(&name)?;

        let mut buf = Vec::new();
        let mut limited = (&mut file).take(MAX_PACKAGE_UNCOMPRESSED_BYTES + 1);
        limited.read_to_end(&mut buf)?;
        total_uncompressed = total_uncompressed.saturating_add(buf.len() as u64);
        if total_uncompressed > MAX_PACKAGE_UNCOMPRESSED_BYTES {
            return Err(ProjectStoreError::PackageInvalid(
                "Package exceeds 100 MB uncompressed limit".to_string(),
            ));
        }
        out.insert(name, buf);
    }

    let manifest_bytes = out
        .get("manifest.json")
        .ok_or_else(|| ProjectStoreError::PackageInvalid("Missing manifest.json".to_string()))?;
    let manifest: Value = serde_json::from_slice(manifest_bytes)
        .map_err(|_| ProjectStoreError::PackageInvalid("Invalid manifest JSON".to_string()))?;
    if manifest.get("schema_version").and_then(Value::as_str) != Some("1.0") {
        return Err(ProjectStoreError::PackageInvalid(
            "Unsupported or missing schema_version".to_string(),
        ));
    }

    Ok(out)
}

const MAX_TEMP_ATTEMPTS: u32 = 32;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[cfg(windows)]
static REPLACE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Atomically publishes `bytes` to `destination`.
///
/// The artifact is written to a uniquely named sibling temporary file, flushed, synced and
/// only then swapped into place, so a crash or failure always leaves the previous artifact
/// intact. Concurrent publications to the same destination use distinct temporary files and
/// follow last-writer-wins semantics: the destination is always one complete artifact.
pub fn atomic_publish_file(destination: &Path, bytes: &[u8]) -> Result<(), ProjectStoreError> {
    publish(destination, bytes, replace_file)
}

fn publish(
    destination: &Path,
    bytes: &[u8],
    replace: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> Result<(), ProjectStoreError> {
    let parent = destination.parent().ok_or_else(|| {
        ProjectStoreError::PackageInvalid("Destination has no parent".to_string())
    })?;
    fs::create_dir_all(parent)?;
    let file_name = destination
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| {
            ProjectStoreError::PackageInvalid("Invalid destination file name".to_string())
        })?;
    let (tmp_path, mut tmp) = create_temp_file(parent, file_name)?;

    let written = tmp.write_all(bytes).and_then(|()| tmp.sync_all());
    drop(tmp);
    if let Err(err) = written {
        let _ = fs::remove_file(&tmp_path);
        return Err(err.into());
    }

    #[cfg(unix)]
    let permissions = fs::metadata(destination)
        .ok()
        .map(|meta| meta.permissions());
    #[cfg(unix)]
    let prepared = match permissions {
        Some(perms) => fs::set_permissions(&tmp_path, perms),
        None => Ok(()),
    };
    #[cfg(not(unix))]
    let prepared: io::Result<()> = Ok(());

    let published = prepared.and_then(|()| replace(&tmp_path, destination));
    if let Err(err) = published {
        let _ = fs::remove_file(&tmp_path);
        return Err(err.into());
    }
    Ok(())
}

fn create_temp_file(parent: &Path, file_name: &str) -> io::Result<(PathBuf, File)> {
    for _ in 0..MAX_TEMP_ATTEMPTS {
        let attempt = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(".{file_name}.{}.{attempt}.tmp", std::process::id()));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => return Ok((path, file)),
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        format!("Could not create a unique temporary file for {file_name}"),
    ))
}

#[cfg(not(windows))]
fn replace_file(tmp: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(tmp, destination)
}

#[cfg(windows)]
fn replace_file(tmp: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const REPLACEFILE_IGNORE_MERGE_ERRORS: u32 = 0x0000_0002;
    const REPLACE_ATTEMPTS: u32 = 32;
    const ERROR_FILE_NOT_FOUND: i32 = 2;
    const ERROR_PATH_NOT_FOUND: i32 = 3;
    const ERROR_SHARING_VIOLATION: i32 = 32;
    const ERROR_UNABLE_TO_REMOVE_REPLACED: i32 = 1175;
    const ERROR_UNABLE_TO_MOVE_REPLACEMENT: i32 = 1176;

    #[link(name = "kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced: *const u16,
            replacement: *const u16,
            backup: *const u16,
            flags: u32,
            exclude: *mut core::ffi::c_void,
            reserved: *mut core::ffi::c_void,
        ) -> i32;
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let replaced = wide(destination);
    let replacement = wide(tmp);

    // ReplaceFileW is not safe to call concurrently on the same destination: parallel
    // replacements can fail with ERROR_UNABLE_TO_REMOVE_REPLACED, so serialize them.
    let _guard = REPLACE_LOCK
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());

    for attempt in 0..REPLACE_ATTEMPTS {
        let replaced_ok = unsafe {
            ReplaceFileW(
                replaced.as_ptr(),
                replacement.as_ptr(),
                std::ptr::null(),
                REPLACEFILE_IGNORE_MERGE_ERRORS,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if replaced_ok != 0 {
            return Ok(());
        }

        let err = io::Error::last_os_error();
        match err.raw_os_error() {
            Some(ERROR_FILE_NOT_FOUND) | Some(ERROR_PATH_NOT_FOUND) => {
                return fs::rename(tmp, destination)
            }
            Some(ERROR_UNABLE_TO_REMOVE_REPLACED)
            | Some(ERROR_UNABLE_TO_MOVE_REPLACEMENT)
            | Some(ERROR_SHARING_VIOLATION)
                if attempt + 1 < REPLACE_ATTEMPTS =>
            {
                std::thread::yield_now();
            }
            _ => return Err(err),
        }
    }

    Err(io::Error::last_os_error())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize};
    use std::sync::Arc;

    static TEST_DIR_COUNTER: AtomicUsize = AtomicUsize::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "stiksound_store_{tag}_{}_{}",
                std::process::id(),
                TEST_DIR_COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_entries(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect()
    }

    #[test]
    fn sec006_sec007_rejects_zip_slip_entries() {
        assert!(validate_zip_entry_path("../outside.txt").is_err());
        assert!(validate_zip_entry_path("assets/../../secret").is_err());
        assert!(validate_zip_entry_path("/etc/passwd").is_err());
        assert!(validate_zip_entry_path("C:\\evil.txt").is_err());

        // Craft raw zip containing "../outside.txt"
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut w = ZipWriter::new(&mut cursor);
            w.start_file("../outside.txt", SimpleFileOptions::default())
                .unwrap();
            w.write_all(b"pwn").unwrap();
            w.finish().unwrap();
        }
        let err = read_zip_package(&cursor.into_inner()).unwrap_err();
        assert!(matches!(err, ProjectStoreError::PackageInvalid(_)));
    }

    #[test]
    fn round_trips_package_and_atomic_publish() {
        let manifest = br#"{"schema_version":"1.0","project":{"id":"prj_1234"}}"#;
        let sticker = b"pngbytes";
        let zip =
            write_zip_bytes(&[("manifest.json", manifest), ("assets/stk_1.png", sticker)]).unwrap();
        let read_back = read_zip_package(&zip).unwrap();
        assert_eq!(read_back.get("assets/stk_1.png").unwrap(), sticker);

        let dir = TestDir::new("round_trip");
        let dest = dir.path().join("project.stiksound.zip");
        atomic_publish_file(&dest, &zip).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), zip);
        assert!(temp_entries(dir.path()).is_empty());
    }

    #[test]
    fn accepts_exact_sound_bundle_root_names() {
        assert!(validate_zip_entry_path("manifest.json").is_ok());
        assert!(validate_zip_entry_path("sticker.webp").is_ok());
        assert!(validate_zip_entry_path("sound.ogg").is_ok());
        assert!(validate_zip_entry_path("assets/stk_1.png").is_ok());
        assert!(validate_zip_entry_path("assets/sticker.webp").is_ok());

        assert!(validate_zip_entry_path("").is_err());
        assert!(validate_zip_entry_path("../sticker.webp").is_err());
        assert!(validate_zip_entry_path("assets/../../secret").is_err());
        assert!(validate_zip_entry_path("/sticker.webp").is_err());
        assert!(validate_zip_entry_path("C:\\evil.txt").is_err());
        assert!(validate_zip_entry_path("sticker.webp/evil").is_err());
        assert!(validate_zip_entry_path("sound.ogg/../x").is_err());
        assert!(validate_zip_entry_path("STICKER.WEBP").is_err());
        assert!(validate_zip_entry_path("sound.OGG").is_err());
        assert!(validate_zip_entry_path("sticker.webp.bak").is_err());
        assert!(validate_zip_entry_path("other.txt").is_err());

        let manifest = br#"{"schema_version":"1.0","project":{"id":"prj_1234"}}"#;
        let zip = write_zip_bytes(&[
            ("manifest.json", manifest),
            ("sticker.webp", b"RIFF"),
            ("sound.ogg", b"OggS"),
        ])
        .unwrap();
        let read_back = read_zip_package(&zip).unwrap();
        assert_eq!(read_back.get("sticker.webp").unwrap(), b"RIFF");
        assert_eq!(read_back.get("sound.ogg").unwrap(), b"OggS");

        assert!(write_zip_bytes(&[("../sticker.webp", b"no")]).is_err());
    }

    #[test]
    fn publishes_new_artifact_with_complete_contents() {
        let dir = TestDir::new("publish_new");
        let dest = dir.path().join("project.stiksound.zip");
        let payload = vec![7u8; 256 * 1024];

        atomic_publish_file(&dest, &payload).unwrap();

        assert_eq!(fs::read(&dest).unwrap(), payload);
        assert!(temp_entries(dir.path()).is_empty());
    }

    #[test]
    fn replaces_existing_artifact_with_complete_contents() {
        let dir = TestDir::new("replace_existing");
        let dest = dir.path().join("artifact.bin");
        atomic_publish_file(&dest, b"old").unwrap();

        atomic_publish_file(&dest, b"new").unwrap();

        assert_eq!(fs::read(&dest).unwrap(), b"new");
        assert!(temp_entries(dir.path()).is_empty());
    }

    #[test]
    fn failed_replacement_preserves_previous_artifact_and_cleans_up() {
        let dir = TestDir::new("failed_replacement");
        let dest = dir.path().join("artifact.bin");
        atomic_publish_file(&dest, b"old").unwrap();

        let err = publish(&dest, b"new", |_tmp, _dest| {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "injected replacement failure",
            ))
        })
        .unwrap_err();

        assert!(matches!(err, ProjectStoreError::Io(_)));
        assert_eq!(fs::read(&dest).unwrap(), b"old");
        assert!(temp_entries(dir.path()).is_empty());
    }

    #[test]
    fn failed_replacement_into_directory_cleans_up() {
        let dir = TestDir::new("replace_directory");
        let dest = dir.path().join("artifact.bin");
        fs::create_dir(&dest).unwrap();

        let err = atomic_publish_file(&dest, b"payload").unwrap_err();

        assert!(matches!(err, ProjectStoreError::Io(_)));
        assert!(dest.is_dir());
        assert!(temp_entries(dir.path()).is_empty());
    }

    #[test]
    fn concurrent_writers_never_expose_partial_artifacts() {
        let dir = TestDir::new("concurrent");
        let dest = dir.path().join("artifact.bin");
        let payloads: Vec<Vec<u8>> = (0..8u8).map(|index| vec![index + 1; 128 * 1024]).collect();
        let allowed = payloads.clone();

        let running = Arc::new(AtomicBool::new(true));
        let reader_dest = dest.clone();
        let reader_allowed = allowed.clone();
        let reader_running = Arc::clone(&running);
        let reader = std::thread::spawn(move || {
            let mut observations = 0usize;
            while reader_running.load(Ordering::Relaxed) {
                if let Ok(bytes) = fs::read(&reader_dest) {
                    assert!(
                        reader_allowed.contains(&bytes),
                        "observed a partial or corrupt artifact of {} bytes",
                        bytes.len()
                    );
                    observations += 1;
                }
            }
            observations
        });

        let writers: Vec<_> = payloads
            .into_iter()
            .map(|payload| {
                let dest = dest.clone();
                std::thread::spawn(move || {
                    for _ in 0..5 {
                        atomic_publish_file(&dest, &payload).unwrap();
                    }
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap();
        }
        running.store(false, Ordering::Relaxed);
        reader.join().unwrap();

        let final_bytes = fs::read(&dest).unwrap();
        assert!(allowed.contains(&final_bytes), "final artifact is corrupt");
        assert!(temp_entries(dir.path()).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn replacement_preserves_existing_unix_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TestDir::new("unix_permissions");
        let dest = dir.path().join("artifact.bin");
        atomic_publish_file(&dest, b"old").unwrap();
        fs::set_permissions(&dest, fs::Permissions::from_mode(0o640)).unwrap();

        atomic_publish_file(&dest, b"new").unwrap();

        let mode = fs::metadata(&dest).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o640);
    }

    #[cfg(windows)]
    #[test]
    fn windows_replacement_preserves_destination_metadata() {
        let dir = TestDir::new("windows_metadata");
        let dest = dir.path().join("artifact.bin");
        atomic_publish_file(&dest, b"old").unwrap();
        let created = fs::metadata(&dest).unwrap().created().unwrap();

        atomic_publish_file(&dest, b"new").unwrap();

        assert_eq!(fs::read(&dest).unwrap(), b"new");
        assert_eq!(fs::metadata(&dest).unwrap().created().unwrap(), created);
    }
}
