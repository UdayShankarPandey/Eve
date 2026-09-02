use crate::events::types::{DesktopEvent, EventType};
use serde_json::json;

/// Raw snapshot of last user interaction time
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RawInputSnapshot {
    /// Tick count (in ms) when last user input (mouse/keyboard) occurred
    pub last_input_tick: u32,
    /// Current system tick count (in ms)
    pub current_tick: u32,
}

/// Abstract provider for reading last input time (enables deterministic testing)
pub trait LastInputProvider: Send + Sync {
    fn get_input_snapshot(&self) -> Result<RawInputSnapshot, String>;
}

/// Real Windows implementation using Win32 GetLastInputInfo
pub struct WindowsLastInputProvider;

impl LastInputProvider for WindowsLastInputProvider {
    fn get_input_snapshot(&self) -> Result<RawInputSnapshot, String> {
        #[cfg(target_os = "windows")]
        {
            #[repr(C)]
            struct LastInputInfo {
                cb_size: u32,
                dw_time: u32,
            }

            extern "system" {
                fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
                fn GetTickCount() -> u32;
            }

            let mut info = LastInputInfo {
                cb_size: std::mem::size_of::<LastInputInfo>() as u32,
                dw_time: 0,
            };

            let success = unsafe { GetLastInputInfo(&mut info) };
            if success != 0 {
                let current_tick = unsafe { GetTickCount() };
                Ok(RawInputSnapshot {
                    last_input_tick: info.dw_time,
                    current_tick,
                })
            } else {
                Err("Win32 GetLastInputInfo call failed".to_string())
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            Ok(RawInputSnapshot {
                last_input_tick: 1000,
                current_tick: 1000,
            })
        }
    }
}

/// User activity state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserActivityState {
    Active,
    Idle,
}

/// Native User Activity & Idle Detector
pub struct UserActivityDetector {
    provider: Box<dyn LastInputProvider>,
    threshold_ms: u64,
    current_state: UserActivityState,
    last_known_input_tick: Option<u32>,
}

impl UserActivityDetector {
    pub fn new(provider: Box<dyn LastInputProvider>, threshold_ms: u64) -> Self {
        Self {
            provider,
            threshold_ms,
            current_state: UserActivityState::Active,
            last_known_input_tick: None,
        }
    }

    /// Creates a detector using the real native Windows last input provider
    pub fn native(threshold_ms: u64) -> Self {
        Self::new(Box::new(WindowsLastInputProvider), threshold_ms)
    }

    /// Sets the idle threshold in milliseconds
    pub fn set_threshold_ms(&mut self, threshold_ms: u64) {
        self.threshold_ms = threshold_ms;
    }

    /// Returns the current idle threshold in milliseconds
    pub fn get_threshold_ms(&self) -> u64 {
        self.threshold_ms
    }

    /// Returns the current user activity state
    pub fn get_state(&self) -> UserActivityState {
        self.current_state
    }

    /// Polls user activity and emits DesktopEvents only on actual state transitions
    pub fn check_events(&mut self) -> Result<Vec<DesktopEvent>, String> {
        let snapshot = self.provider.get_input_snapshot()?;
        let mut events = Vec::new();

        // Calculate elapsed idle time with wrapping subtraction support (Win32 tick count rolls over after ~49.7 days)
        let elapsed_idle_ms = snapshot.current_tick.wrapping_sub(snapshot.last_input_tick) as u64;

        let has_new_user_input = match self.last_known_input_tick {
            Some(prev_tick) => snapshot.last_input_tick != prev_tick,
            None => false,
        };

        self.last_known_input_tick = Some(snapshot.last_input_tick);

        match self.current_state {
            UserActivityState::Active => {
                if elapsed_idle_ms >= self.threshold_ms {
                    // Transition: Active -> Idle
                    self.current_state = UserActivityState::Idle;
                    events.push(DesktopEvent::new(
                        EventType::USER_IDLE,
                        "user_activity",
                        json!({
                            "idle_duration_ms": elapsed_idle_ms,
                            "idle_threshold_ms": self.threshold_ms,
                        }),
                    ));
                }
            }
            UserActivityState::Idle => {
                if has_new_user_input || elapsed_idle_ms < self.threshold_ms {
                    // Transition: Idle -> Active
                    self.current_state = UserActivityState::Active;
                    events.push(DesktopEvent::new(
                        EventType::USER_ACTIVE,
                        "user_activity",
                        json!({
                            "idle_duration_ms": elapsed_idle_ms,
                            "idle_threshold_ms": self.threshold_ms,
                        }),
                    ));
                }
            }
        }

        Ok(events)
    }

    /// Resets internal detector state
    pub fn reset(&mut self) {
        self.current_state = UserActivityState::Active;
        self.last_known_input_tick = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    struct MockInputProvider {
        last_input: Arc<AtomicU32>,
        current_tick: Arc<AtomicU32>,
    }

    impl LastInputProvider for MockInputProvider {
        fn get_input_snapshot(&self) -> Result<RawInputSnapshot, String> {
            Ok(RawInputSnapshot {
                last_input_tick: self.last_input.load(Ordering::SeqCst),
                current_tick: self.current_tick.load(Ordering::SeqCst),
            })
        }
    }

    #[test]
    fn test_user_idle_and_active_transitions() {
        let last_input = Arc::new(AtomicU32::new(10_000));
        let current_tick = Arc::new(AtomicU32::new(10_000));
        let provider = MockInputProvider {
            last_input: Arc::clone(&last_input),
            current_tick: Arc::clone(&current_tick),
        };

        // Threshold = 5000ms (5 seconds)
        let mut detector = UserActivityDetector::new(Box::new(provider), 5000);

        // 1. Initial check: elapsed = 0ms (< 5000ms) -> remains Active, no events
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);
        assert_eq!(detector.get_state(), UserActivityState::Active);

        // 2. Advance clock by 4000ms (elapsed = 4000ms < 5000ms) -> Still active, no events
        current_tick.store(14_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);
        assert_eq!(detector.get_state(), UserActivityState::Active);

        // 3. Advance clock by another 1000ms (elapsed = 5000ms == threshold) -> USER_IDLE emitted!
        current_tick.store(15_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::USER_IDLE);
        assert_eq!(detector.get_state(), UserActivityState::Idle);

        // 4. Continued idle (elapsed = 8000ms) -> Duplicate USER_IDLE suppressed
        current_tick.store(18_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);
        assert_eq!(detector.get_state(), UserActivityState::Idle);

        // 5. User moves mouse / types (last_input updated to 18_500 at current_tick 18_500) -> USER_ACTIVE emitted!
        last_input.store(18_500, Ordering::SeqCst);
        current_tick.store(18_500, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::USER_ACTIVE);
        assert_eq!(detector.get_state(), UserActivityState::Active);

        // 6. Continued activity -> Duplicate USER_ACTIVE suppressed
        current_tick.store(19_000, Ordering::SeqCst);
        last_input.store(19_000, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);
        assert_eq!(detector.get_state(), UserActivityState::Active);
    }
}
