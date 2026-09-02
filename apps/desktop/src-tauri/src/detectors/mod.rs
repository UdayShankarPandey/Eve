pub mod app_activity;
pub mod battery;
pub mod downloads;
pub mod idle;
pub mod network;
pub mod session;

pub use app_activity::{AppActivityDetector, AppInfo, ForegroundAppProvider};
pub use battery::{BatteryDetector, PowerStatusProvider, RawPowerStatus};
pub use downloads::{DownloadDetector, DownloadsScannerProvider, FileMetadataEntry};
pub use idle::{LastInputProvider, RawInputSnapshot, UserActivityDetector, UserActivityState};
pub use network::{NetworkDetector, NetworkStatusProvider};
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
    pub idle_threshold_ms: u64,
    pub downloads_dir: Option<String>,
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
            idle_threshold_ms: 120_000, // 2 minutes default
            downloads_dir: None,
        }
    }
}

/// Central manager orchestrating all native OS detectors
pub struct DetectorManager {
    pub battery: BatteryDetector,
    pub activity: UserActivityDetector,
    pub session: SessionDetector,
    pub network: NetworkDetector,
    pub app_activity: AppActivityDetector,
    pub downloads: DownloadDetector,
    pub config: DetectorConfig,
}

impl DetectorManager {
    pub fn new(
        battery: BatteryDetector,
        activity: UserActivityDetector,
        session: SessionDetector,
        network: NetworkDetector,
        app_activity: AppActivityDetector,
        downloads: DownloadDetector,
        config: DetectorConfig,
    ) -> Self {
        Self {
            battery,
            activity,
            session,
            network,
            app_activity,
            downloads,
            config,
        }
    }

    /// Creates a manager configured with native Windows providers
    pub fn native(config: DetectorConfig) -> Self {
        let battery = BatteryDetector::native();
        let activity = UserActivityDetector::native(config.idle_threshold_ms);
        let session = SessionDetector::native();
        let network = NetworkDetector::native();
        let app_activity = AppActivityDetector::native();
        let mut downloads = DownloadDetector::native();

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
            config,
        )
    }

    /// Polls all enabled detectors, collecting events with strict error isolation
    pub fn check_all(&mut self) -> Vec<DesktopEvent> {
        let mut events = Vec::new();

        // 1. Battery Detector
        if self.config.battery_enabled {
            match self.battery.check_events() {
                Ok(mut bat_events) => events.append(&mut bat_events),
                Err(err) => {
                    eprintln!("[DetectorManager] Battery detector warning: {}", err);
                }
            }
        }

        // 2. User Activity / Idle Detector
        if self.config.user_activity_enabled {
            match self.activity.check_events() {
                Ok(mut act_events) => events.append(&mut act_events),
                Err(err) => {
                    eprintln!("[DetectorManager] Activity detector warning: {}", err);
                }
            }
        }

        // 3. Session Lock / Unlock Detector
        if self.config.session_enabled {
            match self.session.check_events() {
                Ok(mut sess_events) => events.append(&mut sess_events),
                Err(err) => {
                    eprintln!("[DetectorManager] Session detector warning: {}", err);
                }
            }
        }

        // 4. Network Detector
        if self.config.network_enabled {
            match self.network.check_events() {
                Ok(mut net_events) => events.append(&mut net_events),
                Err(err) => {
                    eprintln!("[DetectorManager] Network detector warning: {}", err);
                }
            }
        }

        // 5. Application Activity Detector
        if self.config.app_activity_enabled {
            match self.app_activity.check_events() {
                Ok(mut app_events) => events.append(&mut app_events),
                Err(err) => {
                    eprintln!("[DetectorManager] App activity detector warning: {}", err);
                }
            }
        }

        // 6. Download / File Detector
        if self.config.downloads_enabled {
            match self.downloads.check_events() {
                Ok(mut dl_events) => events.append(&mut dl_events),
                Err(err) => {
                    eprintln!("[DetectorManager] Download detector warning: {}", err);
                }
            }
        }

        events
    }

    /// Updates detector configuration
    pub fn update_config(&mut self, config: DetectorConfig) {
        self.activity.set_threshold_ms(config.idle_threshold_ms);
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::types::EventType;
    use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
    use std::sync::Arc;

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

    struct DummySessionProvider;
    impl SessionStatusProvider for DummySessionProvider {
        fn get_session_lock_state(&self) -> Result<SessionLockState, String> {
            Ok(SessionLockState::Unlocked)
        }
    }

    struct DummyAppProvider;
    impl ForegroundAppProvider for DummyAppProvider {
        fn get_foreground_app(&self) -> Result<Option<AppInfo>, String> {
            Ok(None)
        }
    }

    struct DummyDownloadScanner;
    impl DownloadsScannerProvider for DummyDownloadScanner {
        fn scan_downloads_dir(&self, _dir: &str) -> Result<Vec<FileMetadataEntry>, String> {
            Ok(Vec::new())
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

        let mut config = DetectorConfig::default();
        config.battery_enabled = false; // Disable battery detector

        let mut manager = DetectorManager::new(bat, act, sess, net, app, dl, config);

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

        let config = DetectorConfig::default();
        let mut manager = DetectorManager::new(bat, act, sess, net, app, dl, config);

        // Initial check establishes baseline
        let _ = manager.check_all();

        // Network disconnects -> Even though battery detector fails, network event is still captured!
        net_state.store(false, Ordering::SeqCst);
        let events = manager.check_all();

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::NETWORK_DISCONNECTED);
    }
}
