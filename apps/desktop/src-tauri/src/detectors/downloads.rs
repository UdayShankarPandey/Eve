use crate::events::types::{DesktopEvent, EventType};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Metadata for a candidate file in the Downloads directory
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileMetadataEntry {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub extension: String,
    pub is_file: bool,
}

/// Abstract provider for scanning directory entries metadata (enables deterministic testing)
pub trait DownloadsScannerProvider: Send + Sync {
    fn scan_downloads_dir(&self, dir_path: &str) -> Result<Vec<FileMetadataEntry>, String>;
}

/// Real filesystem metadata scanner (never reads file contents)
pub struct LocalDownloadsScanner;

impl DownloadsScannerProvider for LocalDownloadsScanner {
    fn scan_downloads_dir(&self, dir_path: &str) -> Result<Vec<FileMetadataEntry>, String> {
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
                            is_file: true,
                        });
                    }
                }
            }
        }

        Ok(entries)
    }
}

/// Helper to get default Windows Downloads folder path
pub fn get_default_downloads_path() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            format!("{}\\Downloads", profile)
        } else {
            "C:\\Users\\Default\\Downloads".to_string()
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            format!("{}/Downloads", home)
        } else {
            "/tmp/downloads".to_string()
        }
    }
}

/// Known temporary/in-progress download extensions to ignore until completed
const TEMP_EXTENSIONS: &[&str] = &[
    "crdownload",
    "part",
    "tmp",
    "download",
    "opdownload",
    "partial",
];

/// Download & Filesystem Activity Detector
pub struct DownloadDetector {
    provider: Box<dyn DownloadsScannerProvider>,
    monitored_dir: String,
    known_candidates: HashMap<String, u64>, // path -> last seen size_bytes
    completed_files: HashSet<String>,       // paths that have already emitted DOWNLOAD_COMPLETED
    is_initial_scan: bool,
}

impl DownloadDetector {
    pub fn new(provider: Box<dyn DownloadsScannerProvider>, monitored_dir: String) -> Self {
        Self {
            provider,
            monitored_dir,
            known_candidates: HashMap::new(),
            completed_files: HashSet::new(),
            is_initial_scan: true,
        }
    }

    /// Creates a detector monitoring the default user Downloads directory
    pub fn native() -> Self {
        let dir = get_default_downloads_path();
        Self::new(Box::new(LocalDownloadsScanner), dir)
    }

    /// Updates the monitored directory path
    pub fn set_monitored_dir(&mut self, dir: String) {
        self.monitored_dir = dir;
        self.reset();
    }

    /// Scans Downloads and emits DOWNLOAD_COMPLETED events when new files stabilize
    pub fn check_events(&mut self) -> Result<Vec<DesktopEvent>, String> {
        let entries = self.provider.scan_downloads_dir(&self.monitored_dir)?;
        let mut events = Vec::new();

        let mut current_paths = HashSet::new();

        for file in entries {
            current_paths.insert(file.path.clone());

            // 1. Skip temporary / in-progress browser download extensions
            if TEMP_EXTENSIONS.contains(&file.extension.as_str()) {
                self.known_candidates
                    .insert(file.path.clone(), file.size_bytes);
                continue;
            }

            // 2. On initial baseline scan, record all existing files as already known
            if self.is_initial_scan {
                self.completed_files.insert(file.path.clone());
                self.known_candidates.insert(file.path, file.size_bytes);
                continue;
            }

            // 3. Skip already completed files (deduplication)
            if self.completed_files.contains(&file.path) {
                continue;
            }

            // 4. Stabilization heuristic:
            // Check if file was previously observed with the same non-zero size
            if let Some(&last_size) = self.known_candidates.get(&file.path) {
                if file.size_bytes > 0 && file.size_bytes == last_size {
                    // Size has stabilized across checks -> Download is completed!
                    self.completed_files.insert(file.path.clone());

                    events.push(DesktopEvent::new(
                        EventType::DOWNLOAD_COMPLETED,
                        "filesystem",
                        json!({
                            "filename": file.filename,
                            "size_bytes": file.size_bytes,
                            "extension": file.extension,
                            "download_dir": self.monitored_dir,
                        }),
                    ));
                } else {
                    // Size is still changing (active download), update last size
                    self.known_candidates.insert(file.path, file.size_bytes);
                }
            } else {
                // First time seeing this new file name, record initial size
                self.known_candidates.insert(file.path, file.size_bytes);
            }
        }

        self.is_initial_scan = false;

        // Clean up candidates that were deleted / moved
        self.known_candidates
            .retain(|path, _| current_paths.contains(path));

        Ok(events)
    }

    /// Resets tracking state
    pub fn reset(&mut self) {
        self.known_candidates.clear();
        self.completed_files.clear();
        self.is_initial_scan = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::Mutex;

    struct MockScanner {
        entries: Arc<Mutex<Vec<FileMetadataEntry>>>,
    }

    impl DownloadsScannerProvider for MockScanner {
        fn scan_downloads_dir(&self, _dir: &str) -> Result<Vec<FileMetadataEntry>, String> {
            Ok(self.entries.lock().unwrap().clone())
        }
    }

    #[test]
    fn test_download_completion_heuristic_and_temp_file_handling() {
        let files = Arc::new(Mutex::new(Vec::new()));
        let provider = MockScanner {
            entries: Arc::clone(&files),
        };

        let mut detector =
            DownloadDetector::new(Box::new(provider), "C:\\Users\\Test\\Downloads".to_string());

        // 1. Initial scan: directory is empty
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 2. Active download starts: report temporary file .crdownload (size = 1000) -> no event
        *files.lock().unwrap() = vec![FileMetadataEntry {
            path: "C:\\Users\\Test\\Downloads\\archive.zip.crdownload".to_string(),
            filename: "archive.zip.crdownload".to_string(),
            size_bytes: 1000,
            extension: "crdownload".to_string(),
            is_file: true,
        }];

        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 3. Download finishes and renames to archive.zip (size = 5000) -> First candidate check, records size
        *files.lock().unwrap() = vec![FileMetadataEntry {
            path: "C:\\Users\\Test\\Downloads\\archive.zip".to_string(),
            filename: "archive.zip".to_string(),
            size_bytes: 5000,
            extension: "zip".to_string(),
            is_file: true,
        }];

        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0); // Not stabilized yet

        // 4. Next scan: archive.zip size is stable at 5000 bytes -> DOWNLOAD_COMPLETED emitted!
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::DOWNLOAD_COMPLETED);
        assert_eq!(events[0].payload["filename"], "archive.zip");
        assert_eq!(events[0].payload["size_bytes"], 5000);
        assert_eq!(events[0].payload["extension"], "zip");

        // 5. Subsequent check with the same file -> duplicate suppressed
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);
    }
}
