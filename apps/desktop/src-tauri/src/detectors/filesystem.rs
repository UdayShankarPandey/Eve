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

#[derive(Debug, Clone)]
struct FileSnapshot {
    filename: String,
    size_bytes: u64,
    extension: String,
    directory: String,
}

/// Filesystem lifecycle awareness detector (Sprint 5)
pub struct FilesystemDetector {
    provider: Box<dyn FilesystemScannerProvider>,
    monitored_dirs: Vec<String>,
    known_files: HashMap<String, FileSnapshot>,
    is_initial_scan: bool,
}

impl FilesystemDetector {
    pub fn new(provider: Box<dyn FilesystemScannerProvider>, monitored_dirs: Vec<String>) -> Self {
        Self {
            provider,
            monitored_dirs,
            known_files: HashMap::new(),
            is_initial_scan: true,
        }
    }

    pub fn native(monitored_dirs: Vec<String>) -> Self {
        Self::new(Box::new(LocalFilesystemScanner), monitored_dirs)
    }

    pub fn set_monitored_dirs(&mut self, dirs: Vec<String>) {
        self.monitored_dirs = dirs;
        self.is_initial_scan = true;
        self.known_files.clear();
    }

    pub fn reset(&mut self) {
        self.known_files.clear();
        self.is_initial_scan = true;
    }

    /// Polls monitored directories and emits FILE_CREATED, FILE_MODIFIED, FILE_DELETED
    pub fn check_events(&mut self) -> Result<Vec<DesktopEvent>, String> {
        let mut events = Vec::new();
        let mut current_scan_paths = HashSet::new();

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
}
