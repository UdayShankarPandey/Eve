pub mod app_activity;
pub mod battery;
pub mod downloads;
pub mod filesystem;
pub mod idle;
pub mod network;
pub mod screen_time;
pub mod session;

pub use app_activity::{AppActivityDetector, AppInfo, ForegroundAppProvider};
pub use battery::{BatteryDetector, PowerStatusProvider, RawPowerStatus};
pub use downloads::{DownloadDetector, DownloadsScannerProvider, FileMetadataEntry as DownloadMetadataEntry};
pub use filesystem::{FilesystemDetector, FilesystemScannerProvider, FileMetadataEntry};
pub use idle::{LastInputProvider, RawInputSnapshot, UserActivityDetector, UserActivityState};
pub use network::{NetworkDetector, NetworkStatusProvider};
pub use screen_time::{ScreenTimeDetector, ScreenTimeStatusProvider};
pub use session::{SessionDetector, SessionLockState, SessionStatusProvider};

use crate::events::types::DesktopEvent;

/// Configuration for enabling/disabling specific detector categories
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DetectorConfig {
    pub battery_enabled: bool,
    pub user_activity_enabled: bool,
    pub session_enabled: bool,
    pub network_enabled: bool,
    pub app_activity_enabled: bool,
    pub downloads_enabled: bool,
    pub filesystem_enabled: bool,
    pub screen_time_enabled: bool,
    pub idle_threshold_ms: u64,
    pub screen_time_threshold_ms: u64,
    pub downloads_dir: Option<String>,
    pub monitored_directories: Vec<String>,
    pub selected_applications: Vec<String>,
}

impl Default for DetectorConfig {
    fn default() -> Self {
        Self {
            battery_enabled: true,
            user_activity_enabled: true,
            session_enabled: true,
            network_enabled: true,
            app_activity_enabled: true,
            downloads_enabled: true,
            filesystem_enabled: true,
            screen_time_enabled: true,
            idle_threshold_ms: 120_000, // 2 minutes default
            screen_time_threshold_ms: 3_600_000, // 60 minutes default
            downloads_dir: None,
            monitored_directories: Vec::new(),
            selected_applications: vec!["VS Code".to_string(), "Code".to_string()],
        }
    }
}

/// Lightweight, privacy-safe diagnostic summary for native awareness detectors
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct DetectorDiagnostics {
    pub check_count: u64,
    pub total_events_emitted: u64,
    pub total_errors: u64,
    pub last_check_timestamp: u64,
    pub battery_events: u64,
    pub user_activity_events: u64,
    pub session_events: u64,
    pub network_events: u64,
    pub app_activity_events: u64,
    pub downloads_events: u64,
    pub filesystem_events: u64,
    pub screen_time_events: u64,
}

/// Central manager orchestrating all native OS detectors
pub struct DetectorManager {
    pub battery: BatteryDetector,
    pub activity: UserActivityDetector,
    pub session: SessionDetector,
    pub network: NetworkDetector,
    pub app_activity: AppActivityDetector,
    pub downloads: DownloadDetector,
    pub filesystem: FilesystemDetector,
    pub screen_time: ScreenTimeDetector,
    pub config: DetectorConfig,
    pub diagnostics: DetectorDiagnostics,
}

impl DetectorManager {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        battery: BatteryDetector,
        activity: UserActivityDetector,
        session: SessionDetector,
        network: NetworkDetector,
        app_activity: AppActivityDetector,
        downloads: DownloadDetector,
        filesystem: FilesystemDetector,
        screen_time: ScreenTimeDetector,
        config: DetectorConfig,
    ) -> Self {
        Self {
            battery,
            activity,
            session,
            network,
            app_activity,
            downloads,
            filesystem,
            screen_time,
            config,
            diagnostics: DetectorDiagnostics::default(),
        }
    }

    /// Creates a manager configured with native Windows providers
    pub fn native(config: DetectorConfig) -> Self {
        let battery = BatteryDetector::native();
        let activity = UserActivityDetector::native(config.idle_threshold_ms);
        let session = SessionDetector::native();
        let network = NetworkDetector::native();
        let app_activity = AppActivityDetector::native(config.selected_applications.clone());
        let mut downloads = DownloadDetector::native();
        let filesystem = FilesystemDetector::native(config.monitored_directories.clone());
        let screen_time = ScreenTimeDetector::native(config.screen_time_threshold_ms);

        if let Some(ref dir) = config.downloads_dir {
            downloads.set_monitored_dir(dir.clone());
        }

        Self::new(
            battery,
            activity,
            session,
            network,
            app_activity,
            downloads,
            filesystem,
            screen_time,
            config,
        )
    }

    /// Polls all enabled detectors, collecting events with strict error isolation
    pub fn check_all(&mut self) -> Vec<DesktopEvent> {
        let mut events = Vec::new();
        self.diagnostics.check_count += 1;
        self.diagnostics.last_check_timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        // 1. Battery Detector
        if self.config.battery_enabled {
            match self.battery.check_events() {
                Ok(mut bat_events) => {
                    let count = bat_events.len() as u64;
                    self.diagnostics.battery_events += count;
                    self.diagnostics.total_events_emitted += count;
                    events.append(&mut bat_events);
                }
                Err(err) => {
                    self.diagnostics.total_errors += 1;
                    eprintln!("[DetectorManager] Battery detector warning: {}", err);
                }
            }
        }

        // 2. User Activity / Idle Detector
        if self.config.user_activity_enabled {
            match self.activity.check_events() {
                Ok(mut act_events) => {
                    let count = act_events.len() as u64;
                    self.diagnostics.user_activity_events += count;
                    self.diagnostics.total_events_emitted += count;
                    events.append(&mut act_events);
                }
                Err(err) => {
                    self.diagnostics.total_errors += 1;
                    eprintln!("[DetectorManager] Activity detector warning: {}", err);
                }
            }
        }

        // 3. Session Lock / Unlock Detector
        if self.config.session_enabled {
            match self.session.check_events() {
                Ok(mut sess_events) => {
                    let count = sess_events.len() as u64;
                    self.diagnostics.session_events += count;
                    self.diagnostics.total_events_emitted += count;
                    events.append(&mut sess_events);
                }
                Err(err) => {
                    self.diagnostics.total_errors += 1;
                    eprintln!("[DetectorManager] Session detector warning: {}", err);
                }
            }
        }

        // 4. Network Detector
        if self.config.network_enabled {
            match self.network.check_events() {
                Ok(mut net_events) => {
                    let count = net_events.len() as u64;
                    self.diagnostics.network_events += count;
                    self.diagnostics.total_events_emitted += count;
                    events.append(&mut net_events);
                }
                Err(err) => {
                    self.diagnostics.total_errors += 1;
                    eprintln!("[DetectorManager] Network detector warning: {}", err);
                }
            }
        }

        // 5. Application Activity Detector
        if self.config.app_activity_enabled {
            match self.app_activity.check_events() {
                Ok(mut app_events) => {
                    let count = app_events.len() as u64;
                    self.diagnostics.app_activity_events += count;
                    self.diagnostics.total_events_emitted += count;
                    events.append(&mut app_events);
                }
                Err(err) => {
                    self.diagnostics.total_errors += 1;
                    eprintln!("[DetectorManager] App activity detector warning: {}", err);
                }
            }
        }

        // 6. Download / File Detector
        if self.config.downloads_enabled {
            match self.downloads.check_events() {
                Ok(mut dl_events) => {
                    let count = dl_events.len() as u64;
                    self.diagnostics.downloads_events += count;
                    self.diagnostics.total_events_emitted += count;
                    events.append(&mut dl_events);
                }
                Err(err) => {
                    self.diagnostics.total_errors += 1;
                    eprintln!("[DetectorManager] Download detector warning: {}", err);
                }
            }
        }

        // 7. Filesystem Lifecycle Detector (Sprint 5)
        if self.config.filesystem_enabled {
            match self.filesystem.check_events() {
                Ok(mut fs_events) => {
                    let count = fs_events.len() as u64;
                    self.diagnostics.filesystem_events += count;
                    self.diagnostics.total_events_emitted += count;
                    events.append(&mut fs_events);
                }
                Err(err) => {
                    self.diagnostics.total_errors += 1;
                    eprintln!("[DetectorManager] Filesystem detector warning: {}", err);
                }
            }
        }

        // 8. Screen Time Awareness Detector (Sprint 5)
        if self.config.screen_time_enabled {
            let is_idle = self.activity.get_state() == UserActivityState::Idle;
            let is_locked = self.session.get_state() == Some(SessionLockState::Locked);
            match self.screen_time.check_events_with_state(is_idle, is_locked) {
                Ok(mut st_events) => {
                    let count = st_events.len() as u64;
                    self.diagnostics.screen_time_events += count;
                    self.diagnostics.total_events_emitted += count;
                    events.append(&mut st_events);
                }
                Err(err) => {
                    self.diagnostics.total_errors += 1;
                    eprintln!("[DetectorManager] Screen time detector warning: {}", err);
                }
            }
        }

        events
    }

    /// Returns current privacy-safe diagnostic metrics
    pub fn get_diagnostics(&self) -> &DetectorDiagnostics {
        &self.diagnostics
    }

    /// Resets diagnostic counters
    pub fn reset_diagnostics(&mut self) {
        self.diagnostics = DetectorDiagnostics::default();
    }

    /// Updates detector configuration
    pub fn update_config(&mut self, config: DetectorConfig) {
        self.activity.set_threshold_ms(config.idle_threshold_ms);
        self.screen_time.set_threshold_ms(config.screen_time_threshold_ms);
        self.filesystem.set_monitored_dirs(config.monitored_directories.clone());
        self.app_activity.set_allow_list(config.selected_applications.clone());
        if let Some(ref dir) = config.downloads_dir {
            self.downloads.set_monitored_dir(dir.clone());
        }
        self.config = config;
    }

    /// Resets all internal detector states
    pub fn reset_all(&mut self) {
        self.battery.reset();
        self.activity.reset();
        self.session.reset();
        self.network.reset();
        self.app_activity.reset();
        self.downloads.reset();
        self.filesystem.reset();
        self.screen_time.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::types::EventType;
    use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    struct TestPowerProvider(Arc<AtomicU8>);
    impl PowerStatusProvider for TestPowerProvider {
        fn get_power_status(&self) -> Result<RawPowerStatus, String> {
            Ok(RawPowerStatus {
                ac_line_status: 0,
                battery_life_percent: self.0.load(Ordering::SeqCst),
            })
        }
    }

    struct FailingPowerProvider;
    impl PowerStatusProvider for FailingPowerProvider {
        fn get_power_status(&self) -> Result<RawPowerStatus, String> {
            Err("Simulated Win32 API failure".to_string())
        }
    }

    struct TestNetProvider(Arc<AtomicBool>);
    impl NetworkStatusProvider for TestNetProvider {
        fn is_connected(&self) -> Result<bool, String> {
            Ok(self.0.load(Ordering::SeqCst))
        }
    }

    struct DummyInputProvider;
    impl LastInputProvider for DummyInputProvider {
        fn get_input_snapshot(&self) -> Result<RawInputSnapshot, String> {
            Ok(RawInputSnapshot {
                last_input_tick: 1000,
                current_tick: 1000,
            })
        }
    }

    struct MockDynamicInputProvider {
        pub last_input_tick: Arc<AtomicU32>,
        pub current_tick: Arc<AtomicU32>,
    }
    impl LastInputProvider for MockDynamicInputProvider {
        fn get_input_snapshot(&self) -> Result<RawInputSnapshot, String> {
            Ok(RawInputSnapshot {
                last_input_tick: self.last_input_tick.load(Ordering::SeqCst),
                current_tick: self.current_tick.load(Ordering::SeqCst),
            })
        }
    }

    struct DummySessionProvider;
    impl SessionStatusProvider for DummySessionProvider {
        fn get_session_lock_state(&self) -> Result<SessionLockState, String> {
            Ok(SessionLockState::Unlocked)
        }
    }

    struct MockDynamicSessionProvider {
        pub locked: Arc<AtomicBool>,
    }
    impl SessionStatusProvider for MockDynamicSessionProvider {
        fn get_session_lock_state(&self) -> Result<SessionLockState, String> {
            if self.locked.load(Ordering::SeqCst) {
                Ok(SessionLockState::Locked)
            } else {
                Ok(SessionLockState::Unlocked)
            }
        }
    }

    struct DummyAppProvider;
    impl ForegroundAppProvider for DummyAppProvider {
        fn get_foreground_app(&self) -> Result<Option<AppInfo>, String> {
            Ok(None)
        }
    }

    struct MockDynamicAppProvider {
        pub app: Arc<Mutex<Option<AppInfo>>>,
    }
    impl ForegroundAppProvider for MockDynamicAppProvider {
        fn get_foreground_app(&self) -> Result<Option<AppInfo>, String> {
            Ok(self.app.lock().unwrap().clone())
        }
    }

    struct DummyDownloadScanner;
    impl DownloadsScannerProvider for DummyDownloadScanner {
        fn scan_downloads_dir(&self, _dir: &str) -> Result<Vec<DownloadMetadataEntry>, String> {
            Ok(Vec::new())
        }
    }

    struct DummyFilesystemScanner;
    impl FilesystemScannerProvider for DummyFilesystemScanner {
        fn scan_directory(&self, _dir: &str) -> Result<Vec<FileMetadataEntry>, String> {
            Ok(Vec::new())
        }
    }

    struct MockDynamicFilesystemScanner {
        pub entries: Arc<Mutex<Vec<FileMetadataEntry>>>,
    }
    impl FilesystemScannerProvider for MockDynamicFilesystemScanner {
        fn scan_directory(&self, _dir: &str) -> Result<Vec<FileMetadataEntry>, String> {
            Ok(self.entries.lock().unwrap().clone())
        }
    }

    struct TestScreenProvider {
        pub current_time: Arc<AtomicU64>,
    }
    impl ScreenTimeStatusProvider for TestScreenProvider {
        fn get_status(&self) -> Result<(bool, bool, u64), String> {
            Ok((false, false, self.current_time.load(Ordering::SeqCst)))
        }
    }

    #[test]
    fn test_detector_config_enable_disable_matrix() {
        let pct = Arc::new(AtomicU8::new(50));
        let bat = BatteryDetector::new(Box::new(TestPowerProvider(Arc::clone(&pct))));
        let act = UserActivityDetector::new(Box::new(DummyInputProvider), 10_000);
        let sess = SessionDetector::new(Box::new(DummySessionProvider));
        let net = NetworkDetector::new(Box::new(TestNetProvider(Arc::new(AtomicBool::new(true)))));
        let app = AppActivityDetector::new(Box::new(DummyAppProvider), 0);
        let dl = DownloadDetector::new(Box::new(DummyDownloadScanner), "C:\\Downloads".to_string());
        let fs = FilesystemDetector::new(Box::new(DummyFilesystemScanner), Vec::new());
        let st = ScreenTimeDetector::new(Box::new(TestScreenProvider { current_time: Arc::new(AtomicU64::new(1000)) }), 60_000);

        let mut config = DetectorConfig::default();
        config.battery_enabled = false; // Disable battery detector

        let mut manager = DetectorManager::new(bat, act, sess, net, app, dl, fs, st, config);

        // Initial check: baseline established
        let _ = manager.check_all();

        // Drop battery to 10% (BATTERY_LOW), but battery is disabled!
        pct.store(10, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 0); // No events because detector is disabled

        // Re-enable battery detector
        let mut new_config = manager.config.clone();
        new_config.battery_enabled = true;
        manager.update_config(new_config);

        // Check again: BATTERY_LOW emitted now that it's enabled
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::BATTERY_LOW);
    }

    #[test]
    fn test_detector_error_isolation() {
        // Battery provider fails, but network succeeds
        let net_state = Arc::new(AtomicBool::new(true));
        let bat = BatteryDetector::new(Box::new(FailingPowerProvider));
        let act = UserActivityDetector::new(Box::new(DummyInputProvider), 10_000);
        let sess = SessionDetector::new(Box::new(DummySessionProvider));
        let net = NetworkDetector::new(Box::new(TestNetProvider(Arc::clone(&net_state))));
        let app = AppActivityDetector::new(Box::new(DummyAppProvider), 0);
        let dl = DownloadDetector::new(Box::new(DummyDownloadScanner), "C:\\Downloads".to_string());
        let fs = FilesystemDetector::new(Box::new(DummyFilesystemScanner), Vec::new());
        let st = ScreenTimeDetector::new(Box::new(TestScreenProvider { current_time: Arc::new(AtomicU64::new(1000)) }), 60_000);

        let config = DetectorConfig::default();
        let mut manager = DetectorManager::new(bat, act, sess, net, app, dl, fs, st, config);

        // Initial check establishes baseline
        let _ = manager.check_all();

        // Network disconnects -> Even though battery detector fails, network event is still captured!
        net_state.store(false, Ordering::SeqCst);
        let events = manager.check_all();

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::NETWORK_DISCONNECTED);
    }

    #[test]
    fn test_cross_detector_integration_realistic_sequence() {
        // Controlled mock providers
        let power_pct = Arc::new(AtomicU8::new(80));
        let bat = BatteryDetector::new(Box::new(TestPowerProvider(Arc::clone(&power_pct))));

        let last_input = Arc::new(AtomicU32::new(1000));
        let current_tick = Arc::new(AtomicU32::new(1000));
        let act = UserActivityDetector::new(
            Box::new(MockDynamicInputProvider {
                last_input_tick: Arc::clone(&last_input),
                current_tick: Arc::clone(&current_tick),
            }),
            5_000, // 5s idle threshold
        );

        let is_locked = Arc::new(AtomicBool::new(false));
        let sess = SessionDetector::new(Box::new(MockDynamicSessionProvider {
            locked: Arc::clone(&is_locked),
        }));

        let net_connected = Arc::new(AtomicBool::new(true));
        let net = NetworkDetector::new(Box::new(TestNetProvider(Arc::clone(&net_connected))));

        let current_app = Arc::new(Mutex::new(None));
        let app = AppActivityDetector::with_allow_list(
            Box::new(MockDynamicAppProvider {
                app: Arc::clone(&current_app),
            }),
            vec!["VS Code".to_string()],
            0, // No debounce delay in test
        );

        let dl = DownloadDetector::new(Box::new(DummyDownloadScanner), "C:\\Downloads".to_string());

        let fs_entries = Arc::new(Mutex::new(Vec::new()));
        let fs = FilesystemDetector::new(
            Box::new(MockDynamicFilesystemScanner {
                entries: Arc::clone(&fs_entries),
            }),
            vec!["C:\\Workspace".to_string()],
        );

        let screen_time_now = Arc::new(AtomicU64::new(1000));
        let st = ScreenTimeDetector::new(
            Box::new(TestScreenProvider {
                current_time: Arc::clone(&screen_time_now),
            }),
            10_000, // 10s active threshold
        );

        let mut config = DetectorConfig::default();
        config.selected_applications = vec!["VS Code".to_string()];
        config.idle_threshold_ms = 5_000;
        config.screen_time_threshold_ms = 10_000;
        config.monitored_directories = vec!["C:\\Workspace".to_string()];

        let mut manager = DetectorManager::new(bat, act, sess, net, app, dl, fs, st, config);

        // Initial scan: establishes baseline for all detectors
        let events = manager.check_all();
        assert_eq!(events.len(), 0, "Initial baseline scan should emit no events");

        // 1 & 2. Selected app becomes foreground -> APP_OPENED emitted
        *current_app.lock().unwrap() = Some(AppInfo {
            app_name: "VS Code".to_string(),
            process_id: 1234,
            window_title: Some("VS Code".to_string()),
        });
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::APP_OPENED);
        assert_eq!(events[0].payload["app_name"], "VS Code");
        assert_eq!(events[0].source, "application");

        // 3 & 4. User becomes idle -> USER_IDLE emitted
        last_input.store(1000, Ordering::SeqCst);
        current_tick.store(7000, Ordering::SeqCst); // 6000ms > 5000ms idle threshold
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::USER_IDLE);
        assert_eq!(events[0].source, "user_activity");

        // 5. Screen-time session resets (verified implicitly by subsequent steps)

        // 6 & 7. User becomes active -> USER_ACTIVE emitted
        last_input.store(8000, Ordering::SeqCst);
        current_tick.store(8000, Ordering::SeqCst);
        screen_time_now.store(8000, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::USER_ACTIVE);
        assert_eq!(events[0].source, "user_activity");

        // 8 & 9. Network disconnects -> NETWORK_DISCONNECTED emitted
        net_connected.store(false, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::NETWORK_DISCONNECTED);
        assert_eq!(events[0].payload["connected"], false);
        assert_eq!(events[0].source, "network");

        // 10 & 11. Network reconnects -> NETWORK_CONNECTED emitted
        net_connected.store(true, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::NETWORK_CONNECTED);
        assert_eq!(events[0].payload["connected"], true);

        // 12 & 13. File appears -> FILE_CREATED emitted
        fs_entries.lock().unwrap().push(FileMetadataEntry {
            path: "C:\\Workspace\\test.txt".to_string(),
            filename: "test.txt".to_string(),
            size_bytes: 100,
            extension: "txt".to_string(),
            directory: "C:\\Workspace".to_string(),
            is_file: true,
        });
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::FILE_CREATED);
        assert_eq!(events[0].payload["filename"], "test.txt");
        assert_eq!(events[0].payload["change_type"], "created");
        assert_eq!(events[0].source, "filesystem");

        // 14 & 15. File changes size -> FILE_MODIFIED emitted
        fs_entries.lock().unwrap()[0].size_bytes = 500;
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::FILE_MODIFIED);
        assert_eq!(events[0].payload["size_bytes"], 500);
        assert_eq!(events[0].payload["change_type"], "modified");

        // 16 & 17. File disappears -> FILE_DELETED emitted
        fs_entries.lock().unwrap().clear();
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::FILE_DELETED);
        assert_eq!(events[0].payload["filename"], "test.txt");
        assert_eq!(events[0].payload["change_type"], "deleted");

        // 18 & 19. Continuous active session reaches threshold -> SCREEN_TIME_HIGH emitted
        // Elapsed active time: from tick 8000 to tick 19000 = 11000ms >= 10000ms threshold
        current_tick.store(19000, Ordering::SeqCst);
        last_input.store(19000, Ordering::SeqCst);
        screen_time_now.store(19000, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::SCREEN_TIME_HIGH);
        assert_eq!(events[0].payload["threshold_ms"], 10_000);
        assert_eq!(events[0].source, "session");
    }

    #[test]
    fn test_cross_detector_screen_time_reset_on_idle_and_lock() {
        let last_input = Arc::new(AtomicU32::new(1000));
        let current_tick = Arc::new(AtomicU32::new(1000));
        let act = UserActivityDetector::new(
            Box::new(MockDynamicInputProvider {
                last_input_tick: Arc::clone(&last_input),
                current_tick: Arc::clone(&current_tick),
            }),
            5_000,
        );

        let is_locked = Arc::new(AtomicBool::new(false));
        let sess = SessionDetector::new(Box::new(MockDynamicSessionProvider {
            locked: Arc::clone(&is_locked),
        }));

        let screen_time_now = Arc::new(AtomicU64::new(1000));
        let st = ScreenTimeDetector::new(
            Box::new(TestScreenProvider {
                current_time: Arc::clone(&screen_time_now),
            }),
            10_000, // 10s threshold
        );

        let bat = BatteryDetector::new(Box::new(TestPowerProvider(Arc::new(AtomicU8::new(80)))));
        let net = NetworkDetector::new(Box::new(TestNetProvider(Arc::new(AtomicBool::new(true)))));
        let app = AppActivityDetector::new(Box::new(DummyAppProvider), 0);
        let dl = DownloadDetector::new(Box::new(DummyDownloadScanner), "C:\\Downloads".to_string());
        let fs = FilesystemDetector::new(Box::new(DummyFilesystemScanner), Vec::new());

        let mut config = DetectorConfig::default();
        config.idle_threshold_ms = 5_000;
        config.screen_time_threshold_ms = 10_000;

        let mut manager = DetectorManager::new(bat, act, sess, net, app, dl, fs, st, config);

        // Baseline
        assert_eq!(manager.check_all().len(), 0);

        // Accumulate 6 seconds active
        last_input.store(7000, Ordering::SeqCst);
        current_tick.store(7000, Ordering::SeqCst);
        screen_time_now.store(7000, Ordering::SeqCst);
        assert_eq!(manager.check_all().len(), 0); // 6s < 10s threshold -> no event

        // User goes IDLE (last input was at 7000, now tick is 13000 -> 6000ms idle >= 5000ms threshold)
        current_tick.store(13000, Ordering::SeqCst);
        screen_time_now.store(13000, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::USER_IDLE);

        // User becomes ACTIVE at 14000: active screen-time restarts from 0
        last_input.store(14000, Ordering::SeqCst);
        current_tick.store(14000, Ordering::SeqCst);
        screen_time_now.store(14000, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::USER_ACTIVE);

        // Advance 5 seconds active (total 5s in new session)
        last_input.store(19000, Ordering::SeqCst);
        current_tick.store(19000, Ordering::SeqCst);
        screen_time_now.store(19000, Ordering::SeqCst);
        assert_eq!(manager.check_all().len(), 0); // 5s < 10s threshold -> no event

        // Lock session -> Screen-time resets again
        is_locked.store(true, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::PC_LOCKED);

        // Unlock session at 20000
        is_locked.store(false, Ordering::SeqCst);
        last_input.store(20000, Ordering::SeqCst);
        current_tick.store(20000, Ordering::SeqCst);
        screen_time_now.store(20000, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::PC_UNLOCKED);

        // Advance 11 seconds continuously active without interruption: 20000 -> 31000
        last_input.store(31000, Ordering::SeqCst);
        current_tick.store(31000, Ordering::SeqCst);
        screen_time_now.store(31000, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::SCREEN_TIME_HIGH);

        // Subsequent check: duplicate suppressed
        last_input.store(35000, Ordering::SeqCst);
        current_tick.store(35000, Ordering::SeqCst);
        screen_time_now.store(35000, Ordering::SeqCst);
        assert_eq!(manager.check_all().len(), 0);
    }

    #[test]
    fn test_detector_manager_enable_disable_combinations() {
        let pct = Arc::new(AtomicU8::new(80));
        let bat = BatteryDetector::new(Box::new(TestPowerProvider(Arc::clone(&pct))));
        let act = UserActivityDetector::new(Box::new(DummyInputProvider), 10_000);
        let sess = SessionDetector::new(Box::new(DummySessionProvider));
        let net_state = Arc::new(AtomicBool::new(true));
        let net = NetworkDetector::new(Box::new(TestNetProvider(Arc::clone(&net_state))));

        let current_app = Arc::new(Mutex::new(None));
        let app = AppActivityDetector::with_allow_list(
            Box::new(MockDynamicAppProvider {
                app: Arc::clone(&current_app),
            }),
            vec!["VS Code".to_string()],
            0,
        );

        let dl = DownloadDetector::new(Box::new(DummyDownloadScanner), "C:\\Downloads".to_string());
        let fs_entries = Arc::new(Mutex::new(Vec::new()));
        let fs = FilesystemDetector::new(
            Box::new(MockDynamicFilesystemScanner {
                entries: Arc::clone(&fs_entries),
            }),
            vec!["C:\\Workspace".to_string()],
        );
        let screen_time_now = Arc::new(AtomicU64::new(1000));
        let st = ScreenTimeDetector::new(
            Box::new(TestScreenProvider {
                current_time: Arc::clone(&screen_time_now),
            }),
            5_000,
        );

        let mut config = DetectorConfig::default();
        config.selected_applications = vec!["VS Code".to_string()];
        config.monitored_directories = vec!["C:\\Workspace".to_string()];

        let mut manager = DetectorManager::new(bat, act, sess, net, app, dl, fs, st, config);

        // Initial baseline
        assert_eq!(manager.check_all().len(), 0);

        // 1. Disable network: toggle network -> 0 events
        let mut cfg = manager.config.clone();
        cfg.network_enabled = false;
        manager.update_config(cfg);
        net_state.store(false, Ordering::SeqCst);
        assert_eq!(manager.check_all().len(), 0);

        // Re-enable network: now detects disconnect
        let mut cfg = manager.config.clone();
        cfg.network_enabled = true;
        manager.update_config(cfg);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::NETWORK_DISCONNECTED);

        // 2. Disable app_activity: open app -> 0 events
        let mut cfg = manager.config.clone();
        cfg.app_activity_enabled = false;
        manager.update_config(cfg);
        *current_app.lock().unwrap() = Some(AppInfo {
            app_name: "VS Code".to_string(),
            process_id: 100,
            window_title: Some("VS Code".to_string()),
        });
        assert_eq!(manager.check_all().len(), 0);

        // Re-enable app_activity: now detects app
        let mut cfg = manager.config.clone();
        cfg.app_activity_enabled = true;
        manager.update_config(cfg);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::APP_OPENED);

        // 3. Disable filesystem: add file -> 0 events
        let mut cfg = manager.config.clone();
        cfg.filesystem_enabled = false;
        manager.update_config(cfg);
        fs_entries.lock().unwrap().push(FileMetadataEntry {
            path: "C:\\Workspace\\test.csv".to_string(),
            filename: "test.csv".to_string(),
            size_bytes: 42,
            extension: "csv".to_string(),
            directory: "C:\\Workspace".to_string(),
            is_file: true,
        });
        assert_eq!(manager.check_all().len(), 0);

        // 4. Disable screen time: advance time past threshold -> 0 events
        let mut cfg = manager.config.clone();
        cfg.screen_time_enabled = false;
        manager.update_config(cfg);
        screen_time_now.store(100_000, Ordering::SeqCst);
        assert_eq!(manager.check_all().len(), 0);
    }

    #[test]
    fn test_detector_manager_lifecycle_reset() {
        let pct = Arc::new(AtomicU8::new(50));
        let bat = BatteryDetector::new(Box::new(TestPowerProvider(Arc::clone(&pct))));
        let act = UserActivityDetector::new(Box::new(DummyInputProvider), 10_000);
        let sess = SessionDetector::new(Box::new(DummySessionProvider));
        let net = NetworkDetector::new(Box::new(TestNetProvider(Arc::new(AtomicBool::new(true)))));
        let app = AppActivityDetector::new(Box::new(DummyAppProvider), 0);
        let dl = DownloadDetector::new(Box::new(DummyDownloadScanner), "C:\\Downloads".to_string());
        let fs = FilesystemDetector::new(Box::new(DummyFilesystemScanner), Vec::new());
        let st = ScreenTimeDetector::new(Box::new(TestScreenProvider { current_time: Arc::new(AtomicU64::new(1000)) }), 60_000);

        let config = DetectorConfig::default();
        let mut manager = DetectorManager::new(bat, act, sess, net, app, dl, fs, st, config);

        // Initial check
        assert_eq!(manager.check_all().len(), 0);

        // Trigger an event (BATTERY_LOW)
        pct.store(10, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::BATTERY_LOW);

        // Restore normal battery level and reset all detectors
        pct.store(80, Ordering::SeqCst);
        manager.reset_all();

        // After reset, checking again re-establishes baseline without duplicate events
        let events = manager.check_all();
        assert_eq!(events.len(), 0);

        // Subsequent drop to 10% emits BATTERY_LOW again, proving detectors restarted cleanly
        pct.store(10, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::BATTERY_LOW);
    }

    struct MockFailableAppProvider {
        pub fail: Arc<AtomicBool>,
    }
    impl ForegroundAppProvider for MockFailableAppProvider {
        fn get_foreground_app(&self) -> Result<Option<AppInfo>, String> {
            if self.fail.load(Ordering::SeqCst) {
                Err("Simulated Win32 GetForegroundWindow failure".to_string())
            } else {
                Ok(None)
            }
        }
    }

    struct MockFailableDownloadScanner {
        pub fail: Arc<AtomicBool>,
    }
    impl DownloadsScannerProvider for MockFailableDownloadScanner {
        fn scan_downloads_dir(&self, _dir: &str) -> Result<Vec<DownloadMetadataEntry>, String> {
            if self.fail.load(Ordering::SeqCst) {
                Err("Simulated downloads directory access failure".to_string())
            } else {
                Ok(Vec::new())
            }
        }
    }

    struct MockFailableFilesystemScanner {
        pub fail: Arc<AtomicBool>,
    }
    impl FilesystemScannerProvider for MockFailableFilesystemScanner {
        fn scan_directory(&self, _dir: &str) -> Result<Vec<FileMetadataEntry>, String> {
            if self.fail.load(Ordering::SeqCst) {
                Err("Simulated filesystem directory access failure".to_string())
            } else {
                Ok(Vec::new())
            }
        }
    }

    #[test]
    fn test_detector_diagnostics_tracking() {
        let pct = Arc::new(AtomicU8::new(80));
        let bat = BatteryDetector::new(Box::new(TestPowerProvider(Arc::clone(&pct))));
        let act = UserActivityDetector::new(Box::new(DummyInputProvider), 10_000);
        let sess = SessionDetector::new(Box::new(DummySessionProvider));
        let net = NetworkDetector::new(Box::new(TestNetProvider(Arc::new(AtomicBool::new(true)))));
        let app = AppActivityDetector::new(Box::new(DummyAppProvider), 0);
        let dl = DownloadDetector::new(Box::new(DummyDownloadScanner), "C:\\Downloads".to_string());
        let fs = FilesystemDetector::new(Box::new(DummyFilesystemScanner), Vec::new());
        let st = ScreenTimeDetector::new(Box::new(TestScreenProvider { current_time: Arc::new(AtomicU64::new(1000)) }), 60_000);

        let config = DetectorConfig::default();
        let mut manager = DetectorManager::new(bat, act, sess, net, app, dl, fs, st, config);

        assert_eq!(manager.get_diagnostics().check_count, 0);
        assert_eq!(manager.get_diagnostics().total_events_emitted, 0);
        assert_eq!(manager.get_diagnostics().total_errors, 0);

        // First check
        let _ = manager.check_all();
        assert_eq!(manager.get_diagnostics().check_count, 1);
        assert_eq!(manager.get_diagnostics().total_events_emitted, 0);
        assert!(manager.get_diagnostics().last_check_timestamp > 0);

        // Emit an event (BATTERY_LOW)
        pct.store(10, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(manager.get_diagnostics().check_count, 2);
        assert_eq!(manager.get_diagnostics().total_events_emitted, 1);
        assert_eq!(manager.get_diagnostics().battery_events, 1);

        // Reset diagnostics
        manager.reset_diagnostics();
        assert_eq!(manager.get_diagnostics().check_count, 0);
        assert_eq!(manager.get_diagnostics().total_events_emitted, 0);
        assert_eq!(manager.get_diagnostics().battery_events, 0);
    }

    #[test]
    fn test_all_detectors_error_recovery_matrix() {
        let net_fail = Arc::new(AtomicBool::new(true));
        let app_fail = Arc::new(AtomicBool::new(true));
        let dl_fail = Arc::new(AtomicBool::new(true));
        let fs_fail = Arc::new(AtomicBool::new(true));

        struct MockFailableNetProvider(Arc<AtomicBool>);
        impl NetworkStatusProvider for MockFailableNetProvider {
            fn is_connected(&self) -> Result<bool, String> {
                if self.0.load(Ordering::SeqCst) {
                    Err("Simulated network failure".to_string())
                } else {
                    Ok(true)
                }
            }
        }

        struct MockFailableSessionProvider(Arc<AtomicBool>);
        impl SessionStatusProvider for MockFailableSessionProvider {
            fn get_session_lock_state(&self) -> Result<SessionLockState, String> {
                if self.0.load(Ordering::SeqCst) {
                    Err("Simulated session provider failure".to_string())
                } else {
                    Ok(SessionLockState::Unlocked)
                }
            }
        }

        let sess_fail = Arc::new(AtomicBool::new(true));

        let pct = Arc::new(AtomicU8::new(80));
        let bat = BatteryDetector::new(Box::new(TestPowerProvider(Arc::clone(&pct))));
        let act = UserActivityDetector::new(Box::new(DummyInputProvider), 10_000);
        let sess = SessionDetector::new(Box::new(MockFailableSessionProvider(Arc::clone(&sess_fail))));
        let net = NetworkDetector::new(Box::new(MockFailableNetProvider(Arc::clone(&net_fail))));
        let app = AppActivityDetector::new(Box::new(MockFailableAppProvider { fail: Arc::clone(&app_fail) }), 0);
        let dl = DownloadDetector::new(Box::new(MockFailableDownloadScanner { fail: Arc::clone(&dl_fail) }), "C:\\Downloads".to_string());
        let fs = FilesystemDetector::new(Box::new(MockFailableFilesystemScanner { fail: Arc::clone(&fs_fail) }), vec!["C:\\Workspace".to_string()]);
        let st = ScreenTimeDetector::new(Box::new(TestScreenProvider { current_time: Arc::new(AtomicU64::new(1000)) }), 60_000);

        let config = DetectorConfig::default();
        let mut manager = DetectorManager::new(bat, act, sess, net, app, dl, fs, st, config);

        // 1. Check with 5 detectors failing simultaneously (net, app, dl, fs, sess):
        // Battery and activity continue normally, errors logged to diagnostics
        pct.store(10, Ordering::SeqCst);
        let events = manager.check_all();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::BATTERY_LOW);
        assert_eq!(manager.get_diagnostics().total_errors, 5);

        // 2. All 5 detectors recover from failure:
        net_fail.store(false, Ordering::SeqCst);
        app_fail.store(false, Ordering::SeqCst);
        dl_fail.store(false, Ordering::SeqCst);
        fs_fail.store(false, Ordering::SeqCst);
        sess_fail.store(false, Ordering::SeqCst);

        let initial_errors = manager.get_diagnostics().total_errors;
        let events = manager.check_all();
        // Zero new errors on recovery
        assert_eq!(manager.get_diagnostics().total_errors, initial_errors);
        assert_eq!(events.len(), 0); // Baseline established cleanly
    }

    #[test]
    fn test_detector_manager_repeated_lifecycle_stress() {
        let pct = Arc::new(AtomicU8::new(80));
        let bat = BatteryDetector::new(Box::new(TestPowerProvider(Arc::clone(&pct))));
        let act = UserActivityDetector::new(Box::new(DummyInputProvider), 10_000);
        let sess = SessionDetector::new(Box::new(DummySessionProvider));
        let net = NetworkDetector::new(Box::new(TestNetProvider(Arc::new(AtomicBool::new(true)))));
        let app = AppActivityDetector::new(Box::new(DummyAppProvider), 0);
        let dl = DownloadDetector::new(Box::new(DummyDownloadScanner), "C:\\Downloads".to_string());
        let fs = FilesystemDetector::new(Box::new(DummyFilesystemScanner), Vec::new());
        let st = ScreenTimeDetector::new(Box::new(TestScreenProvider { current_time: Arc::new(AtomicU64::new(1000)) }), 60_000);

        let config = DetectorConfig::default();
        let mut manager = DetectorManager::new(bat, act, sess, net, app, dl, fs, st, config);

        for i in 0..10 {
            let _ = manager.check_all();
            let mut cfg = manager.config.clone();
            cfg.battery_enabled = i % 2 == 0;
            manager.update_config(cfg);
            manager.reset_all();
        }

        assert_eq!(manager.get_diagnostics().check_count, 10);
        assert_eq!(manager.get_diagnostics().total_errors, 0);
    }
}
