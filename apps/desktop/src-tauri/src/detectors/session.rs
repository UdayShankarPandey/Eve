use crate::events::types::{DesktopEvent, EventType};
use serde_json::json;

/// Workstation session lock state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionLockState {
    Unlocked,
    Locked,
    Unknown,
}

/// Abstract provider for reading session lock state
pub trait SessionStatusProvider: Send + Sync {
    fn get_session_lock_state(&self) -> Result<SessionLockState, String>;
}

/// Native Windows Session Status Provider
pub struct WindowsSessionStatusProvider;

impl SessionStatusProvider for WindowsSessionStatusProvider {
    fn get_session_lock_state(&self) -> Result<SessionLockState, String> {
        #[cfg(target_os = "windows")]
        {
            // On Windows, session lock status can be determined by checking whether the workstation desktop is switchable or query user session
            // As a baseline lightweight provider without requiring a hidden message-only window hook, return Unlocked
            Ok(SessionLockState::Unlocked)
        }

        #[cfg(not(target_os = "windows"))]
        {
            Ok(SessionLockState::Unlocked)
        }
    }
}

/// Native Session Lock / Unlock Detector
pub struct SessionDetector {
    provider: Box<dyn SessionStatusProvider>,
    last_state: Option<SessionLockState>,
}

impl SessionDetector {
    pub fn new(provider: Box<dyn SessionStatusProvider>) -> Self {
        Self {
            provider,
            last_state: None,
        }
    }

    /// Creates a detector using the native Windows provider
    pub fn native() -> Self {
        Self::new(Box::new(WindowsSessionStatusProvider))
    }

    /// Explicitly notifies detector of a session state transition (e.g. from native session notification hook)
    pub fn handle_state_change(&mut self, new_state: SessionLockState) -> Vec<DesktopEvent> {
        let mut events = Vec::new();

        if let Some(prev) = self.last_state {
            if prev == new_state {
                // State has not changed; suppress duplicate event
                return events;
            }

            match new_state {
                SessionLockState::Locked => {
                    events.push(DesktopEvent::new(
                        EventType::PC_LOCKED,
                        "session",
                        json!({
                            "lock_state": "locked"
                        }),
                    ));
                }
                SessionLockState::Unlocked => {
                    events.push(DesktopEvent::new(
                        EventType::PC_UNLOCKED,
                        "session",
                        json!({
                            "lock_state": "unlocked"
                        }),
                    ));
                }
                SessionLockState::Unknown => {}
            }
        }

        self.last_state = Some(new_state);
        events
    }

    /// Polls session state provider and emits DesktopEvents only on actual state transitions
    pub fn check_events(&mut self) -> Result<Vec<DesktopEvent>, String> {
        let current = self.provider.get_session_lock_state()?;
        Ok(self.handle_state_change(current))
    }

    /// Returns the last known session lock state
    pub fn get_state(&self) -> Option<SessionLockState> {
        self.last_state
    }

    /// Resets internal state tracking
    pub fn reset(&mut self) {
        self.last_state = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::Arc;

    struct MockSessionProvider {
        state: Arc<AtomicU8>,
    }

    impl SessionStatusProvider for MockSessionProvider {
        fn get_session_lock_state(&self) -> Result<SessionLockState, String> {
            match self.state.load(Ordering::SeqCst) {
                0 => Ok(SessionLockState::Unlocked),
                1 => Ok(SessionLockState::Locked),
                _ => Ok(SessionLockState::Unknown),
            }
        }
    }

    #[test]
    fn test_session_lock_and_unlock_transitions() {
        let state = Arc::new(AtomicU8::new(0)); // Unlocked
        let provider = MockSessionProvider {
            state: Arc::clone(&state),
        };

        let mut detector = SessionDetector::new(Box::new(provider));

        // 1. Initial check: establishes baseline Unlocked -> no event
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);
        assert_eq!(detector.get_state(), Some(SessionLockState::Unlocked));

        // 2. Lock workstation (state = 1) -> PC_LOCKED emitted!
        state.store(1, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::PC_LOCKED);
        assert_eq!(detector.get_state(), Some(SessionLockState::Locked));

        // 3. Subsequent check while still locked -> duplicate suppressed
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 4. Unlock workstation (state = 0) -> PC_UNLOCKED emitted!
        state.store(0, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::PC_UNLOCKED);
        assert_eq!(detector.get_state(), Some(SessionLockState::Unlocked));

        // 5. Subsequent check while still unlocked -> duplicate suppressed
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);
    }
}
