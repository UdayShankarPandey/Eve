use crate::events::types::{DesktopEvent, EventType};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Metadata for a file in a monitored directory
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileMetadataEntry {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub extension: String,
    pub directory: String,
    pub is_file: bool,
}

/// Abstract provider for scanning monitored directories (mockable for unit tests)
pub trait FilesystemScannerProvider: Send + Sync {
    fn scan_directory(&self, dir_path: &str) -> Result<Vec<FileMetadataEntry>, String>;
}

/// Real filesystem metadata scanner (never reads file contents)
pub struct LocalFilesystemScanner;

impl FilesystemScannerProvider for LocalFilesystemScanner {
    fn scan_directory(&self, dir_path: &str) -> Result<Vec<FileMetadataEntry>, String> {
        let path = Path::new(dir_path);
        if !path.exists() || !path.is_dir() {
            return Ok(Vec::new());
        }

        let mut entries = Vec::new();
        if let Ok(read_dir) = std::fs::read_dir(path) {
            for entry in read_dir.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        let filename = entry.file_name().to_string_lossy().to_string();
                        let extension = entry
                            .path()
                            .extension()
                            .map(|e| e.to_string_lossy().to_lowercase())
                            .unwrap_or_default();

                        entries.push(FileMetadataEntry {
                            path: entry.path().to_string_lossy().to_string(),
                            filename,
                            size_bytes: meta.len(),
                            extension,
                            directory: dir_path.to_string(),
                            is_file: true,
                        });
                    }
                }
            }
        }

        Ok(entries)
    }
}

/// Known temporary/in-progress file extensions to ignore
const TEMP_EXTENSIONS: &[&str] = &[
    "crdownload",
    "part",
    "tmp",
    "download",
    "opdownload",
    "partial",
    "swp",
];

/// Default polling cadence for filesystem scanning (3000ms reduces unnecessary I/O by 66% while preserving responsiveness)
pub const DEFAULT_FILESYSTEM_POLL_INTERVAL_MS: u64 = 3000;

#[derive(Debug, Clone)]
struct FileSnapshot {
    filename: String,
    size_bytes: u64,
    extension: String,
    directory: String,
}

/// Filesystem lifecycle awareness detector (Sprint 5, optimized in Sprint 11)
pub struct FilesystemDetector {
    provider: Box<dyn FilesystemScannerProvider>,
    monitored_dirs: Vec<String>,
    known_files: HashMap<String, FileSnapshot>,
    is_initial_scan: bool,
    poll_interval_ms: u64,
    last_scan_timestamp: Option<std::time::Instant>,
    scan_count: u64,
}

impl FilesystemDetector {
    pub fn new(provider: Box<dyn FilesystemScannerProvider>, monitored_dirs: Vec<String>) -> Self {
        Self::with_interval(provider, monitored_dirs, 0)
    }

    pub fn with_interval(
        provider: Box<dyn FilesystemScannerProvider>,
        monitored_dirs: Vec<String>,
        poll_interval_ms: u64,
    ) -> Self {
        Self {
            provider,
            monitored_dirs,
            known_files: HashMap::new(),
            is_initial_scan: true,
            poll_interval_ms,
            last_scan_timestamp: None,
            scan_count: 0,
        }
    }

    pub fn native(monitored_dirs: Vec<String>) -> Self {
        Self::with_interval(
            Box::new(LocalFilesystemScanner),
            monitored_dirs,
            DEFAULT_FILESYSTEM_POLL_INTERVAL_MS,
        )
    }

    pub fn set_poll_interval_ms(&mut self, interval_ms: u64) {
        self.poll_interval_ms = interval_ms;
    }

    pub fn get_poll_interval_ms(&self) -> u64 {
        self.poll_interval_ms
    }

    pub fn get_scan_count(&self) -> u64 {
        self.scan_count
    }

    pub fn set_monitored_dirs(&mut self, dirs: Vec<String>) {
        self.monitored_dirs = dirs;
        self.is_initial_scan = true;
        self.last_scan_timestamp = None;
        self.known_files.clear();
    }

    pub fn reset(&mut self) {
        self.known_files.clear();
        self.is_initial_scan = true;
        self.last_scan_timestamp = None;
    }

    /// Polls monitored directories and emits FILE_CREATED, FILE_MODIFIED, FILE_DELETED
    pub fn check_events(&mut self) -> Result<Vec<DesktopEvent>, String> {
        // Fast early-return if no directories are configured
        if self.monitored_dirs.is_empty() {
            return Ok(Vec::new());
        }

        // Dedicated cadence gating: skip scan if interval has not elapsed
        let now = std::time::Instant::now();
        if !self.is_initial_scan && self.poll_interval_ms > 0 {
            if let Some(last_scan) = self.last_scan_timestamp {
                if now.duration_since(last_scan).as_millis() < self.poll_interval_ms as u128 {
                    return Ok(Vec::new());
                }
            }
        }

        self.last_scan_timestamp = Some(now);
        self.scan_count += 1;

        let mut events = Vec::new();
        let mut current_scan_paths = HashSet::with_capacity(self.known_files.len());

        for dir in &self.monitored_dirs {
            let entries = self.provider.scan_directory(dir)?;

            for entry in entries {
                if !entry.is_file {
                    continue;
                }

                // Ignore active temporary files
                if TEMP_EXTENSIONS.contains(&entry.extension.as_str())
                    || entry.filename.starts_with('~')
                {
                    continue;
                }

                current_scan_paths.insert(entry.path.clone());

                if self.is_initial_scan {
                    // Populate initial baseline
                    self.known_files.insert(
                        entry.path.clone(),
                        FileSnapshot {
                            filename: entry.filename,
                            size_bytes: entry.size_bytes,
                            extension: entry.extension,
                            directory: entry.directory,
                        },
                    );
                } else if let Some(previous) = self.known_files.get_mut(&entry.path) {
                    // Existing file: check if modified
                    if previous.size_bytes != entry.size_bytes {
                        previous.size_bytes = entry.size_bytes;

                        let payload = json!({
                            "filename": entry.filename,
                            "path": entry.path,
                            "size_bytes": entry.size_bytes,
                            "extension": entry.extension,
                            "directory": entry.directory,
                            "change_type": "modified",
                        });

                        events.push(DesktopEvent::new(
                            EventType::FILE_MODIFIED,
                            "filesystem",
                            payload,
                        ));
                    }
                } else {
                    // New file detected: FILE_CREATED
                    self.known_files.insert(
                        entry.path.clone(),
                        FileSnapshot {
                            filename: entry.filename.clone(),
                            size_bytes: entry.size_bytes,
                            extension: entry.extension.clone(),
                            directory: entry.directory.clone(),
                        },
                    );

                    let payload = json!({
                        "filename": entry.filename,
                        "path": entry.path,
                        "size_bytes": entry.size_bytes,
                        "extension": entry.extension,
                        "directory": entry.directory,
                        "change_type": "created",
                    });

                    events.push(DesktopEvent::new(
                        EventType::FILE_CREATED,
                        "filesystem",
                        payload,
                    ));
                }
            }
        }

        // Check for deleted files (if not initial scan)
        if !self.is_initial_scan {
            let mut deleted_paths = Vec::new();
            for (path, snap) in &self.known_files {
                if !current_scan_paths.contains(path) {
                    deleted_paths.push((path.clone(), snap.clone()));
                }
            }

            for (path, snap) in deleted_paths {
                self.known_files.remove(&path);

                let payload = json!({
                    "filename": snap.filename,
                    "path": path,
                    "size_bytes": snap.size_bytes,
                    "extension": snap.extension,
                    "directory": snap.directory,
                    "change_type": "deleted",
                });

                events.push(DesktopEvent::new(
                    EventType::FILE_DELETED,
                    "filesystem",
                    payload,
                ));
            }
        }

        self.is_initial_scan = false;
        Ok(events)
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    pub struct TestFilesystemScanner {
        pub entries: Arc<Mutex<Vec<FileMetadataEntry>>>,
    }

    impl FilesystemScannerProvider for TestFilesystemScanner {
        fn scan_directory(&self, _dir_path: &str) -> Result<Vec<FileMetadataEntry>, String> {
            Ok(self.entries.lock().unwrap().clone())
        }
    }

    #[test]
    fn test_filesystem_lifecycle_events() {
        let entries = Arc::new(Mutex::new(vec![FileMetadataEntry {
            path: "C:\\Projects\\doc.txt".to_string(),
            filename: "doc.txt".to_string(),
            size_bytes: 100,
            extension: "txt".to_string(),
            directory: "C:\\Projects".to_string(),
            is_file: true,
        }]));

        let provider = Box::new(TestFilesystemScanner {
            entries: Arc::clone(&entries),
        });

        let mut detector = FilesystemDetector::new(provider, vec!["C:\\Projects".to_string()]);

        // 1. Initial scan sets baseline -> no events
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 2. Add new file -> FILE_CREATED
        entries.lock().unwrap().push(FileMetadataEntry {
            path: "C:\\Projects\\notes.md".to_string(),
            filename: "notes.md".to_string(),
            size_bytes: 50,
            extension: "md".to_string(),
            directory: "C:\\Projects".to_string(),
            is_file: true,
        });

        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::FILE_CREATED);
        assert_eq!(events[0].payload["filename"], "notes.md");
        assert_eq!(events[0].payload["change_type"], "created");

        // 3. Modify file size -> FILE_MODIFIED
        entries.lock().unwrap()[1].size_bytes = 200;
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::FILE_MODIFIED);
        assert_eq!(events[0].payload["size_bytes"], 200);
        assert_eq!(events[0].payload["change_type"], "modified");

        // 4. Delete file -> FILE_DELETED
        entries.lock().unwrap().remove(1);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::FILE_DELETED);
        assert_eq!(events[0].payload["filename"], "notes.md");
        assert_eq!(events[0].payload["change_type"], "deleted");

        // 5. Temp file is ignored
        entries.lock().unwrap().push(FileMetadataEntry {
            path: "C:\\Projects\\temp.tmp".to_string(),
            filename: "temp.tmp".to_string(),
            size_bytes: 500,
            extension: "tmp".to_string(),
            directory: "C:\\Projects".to_string(),
            is_file: true,
        });
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);
    }

    #[test]
    fn test_filesystem_deduplication_and_noise_control() {
        let entries = Arc::new(Mutex::new(vec![FileMetadataEntry {
            path: "C:\\Projects\\stable.txt".to_string(),
            filename: "stable.txt".to_string(),
            size_bytes: 1024,
            extension: "txt".to_string(),
            directory: "C:\\Projects".to_string(),
            is_file: true,
        }]));

        let provider = Box::new(TestFilesystemScanner {
            entries: Arc::clone(&entries),
        });

        let mut detector = FilesystemDetector::new(provider, vec!["C:\\Projects".to_string()]);

        // Baseline: 0 events
        assert_eq!(detector.check_events().unwrap().len(), 0);

        // Multiple scans with unchanged file size -> 0 duplicate events
        assert_eq!(detector.check_events().unwrap().len(), 0);
        assert_eq!(detector.check_events().unwrap().len(), 0);

        // Rapid change: file created
        entries.lock().unwrap().push(FileMetadataEntry {
            path: "C:\\Projects\\log.txt".to_string(),
            filename: "log.txt".to_string(),
            size_bytes: 100,
            extension: "txt".to_string(),
            directory: "C:\\Projects".to_string(),
            is_file: true,
        });
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::FILE_CREATED);

        // Immediate modification on next scan
        entries.lock().unwrap()[1].size_bytes = 250;
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::FILE_MODIFIED);

        // Subsequent check with same modified size -> duplicate suppressed (0 events)
        assert_eq!(detector.check_events().unwrap().len(), 0);

        // Immediate deletion on next scan
        entries.lock().unwrap().remove(1);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::FILE_DELETED);

        // Inaccessible/empty directory produces 0 events safely
        let mut empty_detector = FilesystemDetector::new(
            Box::new(TestFilesystemScanner {
                entries: Arc::new(Mutex::new(Vec::new())),
            }),
            vec!["C:\\NonExistentPath".to_string()],
        );
        assert_eq!(empty_detector.check_events().unwrap().len(), 0);
    }

    #[test]
    fn test_real_windows_filesystem_scanner_lifecycle() {
        let temp_dir = std::env::temp_dir().join(format!(
            "pixelpal_rt_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::create_dir_all(&temp_dir);
        let temp_path_str = temp_dir.to_string_lossy().to_string();

        let mut detector = FilesystemDetector::native(vec![temp_path_str]);
        detector.set_poll_interval_ms(0);

        // Baseline: empty dir -> 0 events
        assert_eq!(detector.check_events().unwrap().len(), 0);

        // 1. Create file on real Windows filesystem
        let file_path = temp_dir.join("live_test.txt");
        std::fs::write(&file_path, b"initial content").unwrap();

        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::FILE_CREATED);

        // 2. Duplicate suppression with unchanged file
        assert_eq!(detector.check_events().unwrap().len(), 0);

        // 3. Modify file on real Windows filesystem (change size)
        std::fs::write(&file_path, b"initial content with added bytes").unwrap();

        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::FILE_MODIFIED);

        // 4. Duplicate suppression after modification
        assert_eq!(detector.check_events().unwrap().len(), 0);

        // 5. Delete file on real Windows filesystem
        let file_path_delete = temp_dir.join("live_test.txt");
        std::fs::remove_file(&file_path_delete).unwrap();

        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::FILE_DELETED);

        // Clean up disposable directory
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_filesystem_detector_polling_cadence_skips_within_interval() {
        let entries = Arc::new(Mutex::new(vec![FileMetadataEntry {
            path: "C:\\Projects\\file.txt".to_string(),
            filename: "file.txt".to_string(),
            size_bytes: 100,
            extension: "txt".to_string(),
            directory: "C:\\Projects".to_string(),
            is_file: true,
        }]));

        let provider = Box::new(TestFilesystemScanner {
            entries: Arc::clone(&entries),
        });

        // Configure 5000ms cadence
        let mut detector = FilesystemDetector::with_interval(provider, vec!["C:\\Projects".to_string()], 5000);

        // 1. First scan executes immediately to establish baseline
        assert_eq!(detector.get_scan_count(), 0);
        let events1 = detector.check_events().unwrap();
        assert_eq!(events1.len(), 0);
        assert_eq!(detector.get_scan_count(), 1);

        // Add a file
        entries.lock().unwrap().push(FileMetadataEntry {
            path: "C:\\Projects\\new.txt".to_string(),
            filename: "new.txt".to_string(),
            size_bytes: 200,
            extension: "txt".to_string(),
            directory: "C:\\Projects".to_string(),
            is_file: true,
        });

        // 2. Calling check_events immediately within 5000ms MUST skip scanning
        let events2 = detector.check_events().unwrap();
        assert_eq!(events2.len(), 0, "Scan must be skipped when interval has not elapsed");
        assert_eq!(detector.get_scan_count(), 1, "Scan count must not increase when skipped");

        // 3. Resetting poll interval to 0ms allows immediate scan
        detector.set_poll_interval_ms(0);
        let events3 = detector.check_events().unwrap();
        assert_eq!(events3.len(), 1, "Immediate scan occurs when cadence allows");
        assert_eq!(events3[0].event_type, EventType::FILE_CREATED);
        assert_eq!(detector.get_scan_count(), 2);
    }

    #[test]
    fn test_filesystem_detector_scans_immediately_on_config_change() {
        let entries = Arc::new(Mutex::new(vec![]));
        let provider = Box::new(TestFilesystemScanner {
            entries: Arc::clone(&entries),
        });

        let mut detector = FilesystemDetector::with_interval(provider, vec!["C:\\DirA".to_string()], 10_000);

        // Initial scan
        assert_eq!(detector.check_events().unwrap().len(), 0);
        assert_eq!(detector.get_scan_count(), 1);

        // Immediate subsequent call is skipped
        assert_eq!(detector.check_events().unwrap().len(), 0);
        assert_eq!(detector.get_scan_count(), 1);

        // Changing monitored dirs resets cadence and triggers immediate scan on next check
        detector.set_monitored_dirs(vec!["C:\\DirB".to_string()]);
        assert_eq!(detector.check_events().unwrap().len(), 0);
        assert_eq!(detector.get_scan_count(), 2, "Configuration change must trigger immediate scan");
    }

    #[test]
    fn test_filesystem_detector_empty_monitored_dirs_performs_no_scans() {
        let entries = Arc::new(Mutex::new(vec![]));
        let provider = Box::new(TestFilesystemScanner {
            entries: Arc::clone(&entries),
        });

        let mut detector = FilesystemDetector::new(provider, Vec::new());
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);
        assert_eq!(detector.get_scan_count(), 0, "Zero scans when monitored_dirs is empty");
    }
}
