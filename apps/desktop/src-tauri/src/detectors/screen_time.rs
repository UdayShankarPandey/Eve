use crate::events::types::{DesktopEvent, EventType};
use serde_json::json;

/// Provider interface for determining user activity and current time (mockable for tests)
pub trait ScreenTimeStatusProvider: Send + Sync {
    /// Returns (is_user_idle, is_session_locked, current_epoch_ms)
    fn get_status(&self) -> Result<(bool, bool, u64), String>;
}

/// Real system status provider for screen time tracking (fallback when queried stand-alone)
pub struct SystemScreenTimeStatusProvider;

impl ScreenTimeStatusProvider for SystemScreenTimeStatusProvider {
    fn get_status(&self) -> Result<(bool, bool, u64), String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        Ok((false, false, now))
    }
}

/// Continuous active screen-time detector
pub struct ScreenTimeDetector {
    provider: Box<dyn ScreenTimeStatusProvider>,
    threshold_ms: u64,
    session_start_timestamp: Option<u64>,
    last_active_timestamp: Option<u64>,
    accumulated_active_ms: u64,
    has_emitted_high_alert: bool,
}

impl ScreenTimeDetector {
    pub fn new(provider: Box<dyn ScreenTimeStatusProvider>, threshold_ms: u64) -> Self {
        Self {
            provider,
            threshold_ms,
            session_start_timestamp: None,
            last_active_timestamp: None,
            accumulated_active_ms: 0,
            has_emitted_high_alert: false,
        }
    }

    pub fn native(threshold_ms: u64) -> Self {
        Self::new(Box::new(SystemScreenTimeStatusProvider), threshold_ms)
    }

    pub fn set_threshold_ms(&mut self, threshold_ms: u64) {
        self.threshold_ms = threshold_ms;
    }

    pub fn reset(&mut self) {
        self.session_start_timestamp = None;
        self.last_active_timestamp = None;
        self.accumulated_active_ms = 0;
        self.has_emitted_high_alert = false;
    }

    /// Internal logic for processing session state and tracking active duration
    fn process_session_state(
        &mut self,
        is_idle: bool,
        is_locked: bool,
        now_ms: u64,
    ) -> Result<Vec<DesktopEvent>, String> {
        let mut events = Vec::new();

        if is_idle || is_locked {
            // User is inactive or session is locked: reset continuous active session
            self.session_start_timestamp = None;
            self.last_active_timestamp = None;
            self.accumulated_active_ms = 0;
            self.has_emitted_high_alert = false;
            return Ok(events);
        }

        // User is active: establish session start if not already established
        let session_start = match self.session_start_timestamp {
            Some(start) => start,
            None => {
                self.session_start_timestamp = Some(now_ms);
                self.last_active_timestamp = Some(now_ms);
                now_ms
            }
        };

        if let Some(last_ts) = self.last_active_timestamp {
            if now_ms > last_ts {
                let delta = now_ms - last_ts;
                self.accumulated_active_ms += delta;
            }
        }
        self.last_active_timestamp = Some(now_ms);

        // Check threshold crossing: emit SCREEN_TIME_HIGH exactly once per active session crossing threshold
        if self.accumulated_active_ms >= self.threshold_ms && !self.has_emitted_high_alert {
            self.has_emitted_high_alert = true;

            let payload = json!({
                "active_duration_ms": self.accumulated_active_ms,
                "threshold_ms": self.threshold_ms,
                "session_start_timestamp": session_start,
            });

            events.push(DesktopEvent::new(
                EventType::SCREEN_TIME_HIGH,
                "session",
                payload,
            ));
        }

        Ok(events)
    }

    /// Checks active session progression directly integrating with external detector states
    pub fn check_events_with_state(
        &mut self,
        is_idle: bool,
        is_locked: bool,
    ) -> Result<Vec<DesktopEvent>, String> {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.process_session_state(is_idle, is_locked, now_ms)
    }

    /// Checks active session progression using provider
    pub fn check_events(&mut self) -> Result<Vec<DesktopEvent>, String> {
        let (is_idle, is_locked, now_ms) = self.provider.get_status()?;
        self.process_session_state(is_idle, is_locked, now_ms)
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Arc;

    pub struct TestScreenTimeProvider {
        pub is_idle: Arc<AtomicBool>,
        pub is_locked: Arc<AtomicBool>,
        pub current_time: Arc<AtomicU64>,
    }

    impl ScreenTimeStatusProvider for TestScreenTimeProvider {
        fn get_status(&self) -> Result<(bool, bool, u64), String> {
            Ok((
                self.is_idle.load(Ordering::SeqCst),
                self.is_locked.load(Ordering::SeqCst),
                self.current_time.load(Ordering::SeqCst),
            ))
        }
    }

    #[test]
    fn test_screen_time_threshold_and_deduplication() {
        let is_idle = Arc::new(AtomicBool::new(false));
        let is_locked = Arc::new(AtomicBool::new(false));
        let current_time = Arc::new(AtomicU64::new(1000));

        let provider = Box::new(TestScreenTimeProvider {
            is_idle: Arc::clone(&is_idle),
            is_locked: Arc::clone(&is_locked),
            current_time: Arc::clone(&current_time),
        });

        // 60,000ms threshold
        let mut detector = ScreenTimeDetector::new(provider, 60_000);

        // Initial tick at 1000ms
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // Advance to 30,000ms -> Still below threshold
        current_time.store(30_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // Advance to 65,000ms -> Crosses threshold -> SCREEN_TIME_HIGH
        current_time.store(65_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::SCREEN_TIME_HIGH);
        assert_eq!(events[0].source, "session");

        // Advance to 80,000ms -> Already emitted alert, no duplicate spam
        current_time.store(80_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // User goes idle -> resets session
        is_idle.store(true, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // User becomes active again at 100,000ms
        is_idle.store(false, Ordering::SeqCst);
        current_time.store(100_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // Crosses threshold again at 165,000ms
        current_time.store(165_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::SCREEN_TIME_HIGH);
    }

    #[test]
    fn test_screen_time_session_lock_reset() {
        let is_idle = Arc::new(AtomicBool::new(false));
        let is_locked = Arc::new(AtomicBool::new(false));
        let current_time = Arc::new(AtomicU64::new(1000));

        let provider = Box::new(TestScreenTimeProvider {
            is_idle: Arc::clone(&is_idle),
            is_locked: Arc::clone(&is_locked),
            current_time: Arc::clone(&current_time),
        });

        let mut detector = ScreenTimeDetector::new(provider, 50_000);

        // Advance to 40,000ms (accumulated 39s)
        current_time.store(40_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // Workstation is locked at 45,000ms -> resets active session
        is_locked.store(true, Ordering::SeqCst);
        current_time.store(45_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // Unlocked at 50,000ms -> starts fresh session from 0
        is_locked.store(false, Ordering::SeqCst);
        current_time.store(50_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // Advance to 90,000ms (only 40s active since unlock) -> not yet 50s
        current_time.store(90_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // Advance to 105,000ms (55s active since unlock) -> triggers alert!
        current_time.store(105_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::SCREEN_TIME_HIGH);
    }
}
