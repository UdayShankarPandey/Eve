use crate::events::types::{DesktopEvent, EventType};
use serde_json::json;

/// Abstract provider for reading network connectivity state (enables deterministic testing)
pub trait NetworkStatusProvider: Send + Sync {
    fn is_connected(&self) -> Result<bool, String>;
}

/// Real Windows implementation using Win32 InternetGetConnectedState
pub struct WindowsNetworkStatusProvider;

impl NetworkStatusProvider for WindowsNetworkStatusProvider {
    fn is_connected(&self) -> Result<bool, String> {
        #[cfg(target_os = "windows")]
        {
            #[link(name = "wininet")]
            extern "system" {
                fn InternetGetConnectedState(lpdwFlags: *mut u32, dwReserved: u32) -> i32;
            }

            let mut flags: u32 = 0;
            let result = unsafe { InternetGetConnectedState(&mut flags, 0) };
            Ok(result != 0)
        }

        #[cfg(not(target_os = "windows"))]
        {
            Ok(true)
        }
    }
}

/// Native Network Connectivity Detector
pub struct NetworkDetector {
    provider: Box<dyn NetworkStatusProvider>,
    last_connected: Option<bool>,
}

impl NetworkDetector {
    pub fn new(provider: Box<dyn NetworkStatusProvider>) -> Self {
        Self {
            provider,
            last_connected: None,
        }
    }

    /// Creates a detector using the real native Windows network status provider
    pub fn native() -> Self {
        Self::new(Box::new(WindowsNetworkStatusProvider))
    }

    /// Polls network state and emits DesktopEvents only on actual state transitions
    pub fn check_events(&mut self) -> Result<Vec<DesktopEvent>, String> {
        let connected = self.provider.is_connected()?;
        let mut events = Vec::new();

        if let Some(prev) = self.last_connected {
            if connected && !prev {
                // Transition: Offline -> Online
                events.push(DesktopEvent::new(
                    EventType::NETWORK_CONNECTED,
                    "network",
                    json!({
                        "connected": true,
                        "previous_connected": false,
                    }),
                ));
            } else if !connected && prev {
                // Transition: Online -> Offline
                events.push(DesktopEvent::new(
                    EventType::NETWORK_DISCONNECTED,
                    "network",
                    json!({
                        "connected": false,
                        "previous_connected": true,
                    }),
                ));
            }
        }

        self.last_connected = Some(connected);
        Ok(events)
    }

    /// Returns the last known network state
    pub fn is_currently_connected(&self) -> Option<bool> {
        self.last_connected
    }

    /// Resets internal state
    pub fn reset(&mut self) {
        self.last_connected = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    struct MockNetworkProvider {
        connected: Arc<AtomicBool>,
    }

    impl NetworkStatusProvider for MockNetworkProvider {
        fn is_connected(&self) -> Result<bool, String> {
            Ok(self.connected.load(Ordering::SeqCst))
        }
    }

    #[test]
    fn test_network_transitions_and_deduplication() {
        let connected = Arc::new(AtomicBool::new(true)); // Initially connected
        let provider = MockNetworkProvider {
            connected: Arc::clone(&connected),
        };

        let mut detector = NetworkDetector::new(Box::new(provider));

        // 1. Initial check establishes baseline -> no transition event
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 2. Subsequent check while still connected -> duplicate suppressed
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 3. Disconnect network -> NETWORK_DISCONNECTED emitted
        connected.store(false, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::NETWORK_DISCONNECTED);
        assert_eq!(events[0].payload["connected"], false);

        // 4. Subsequent check while still disconnected -> duplicate suppressed
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 5. Reconnect network -> NETWORK_CONNECTED emitted
        connected.store(true, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::NETWORK_CONNECTED);
        assert_eq!(events[0].payload["connected"], true);
    }

    #[test]
    fn test_network_repeated_same_state_deduplication() {
        let connected = Arc::new(AtomicBool::new(false)); // Initially offline
        let provider = MockNetworkProvider {
            connected: Arc::clone(&connected),
        };

        let mut detector = NetworkDetector::new(Box::new(provider));

        // Initial check: baseline established (offline)
        assert_eq!(detector.check_events().unwrap().len(), 0);

        // Multiple repeated offline checks -> exactly 0 events
        assert_eq!(detector.check_events().unwrap().len(), 0);
        assert_eq!(detector.check_events().unwrap().len(), 0);

        // Connect -> exactly 1 event (NETWORK_CONNECTED)
        connected.store(true, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::NETWORK_CONNECTED);

        // Multiple repeated online checks -> exactly 0 events
        assert_eq!(detector.check_events().unwrap().len(), 0);
        assert_eq!(detector.check_events().unwrap().len(), 0);
        assert_eq!(detector.check_events().unwrap().len(), 0);

        // Disconnect -> exactly 1 event (NETWORK_DISCONNECTED)
        connected.store(false, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::NETWORK_DISCONNECTED);
    }

    struct MockFailableNetworkProvider {
        should_fail: Arc<AtomicBool>,
        connected: Arc<AtomicBool>,
    }

    impl NetworkStatusProvider for MockFailableNetworkProvider {
        fn is_connected(&self) -> Result<bool, String> {
            if self.should_fail.load(Ordering::SeqCst) {
                Err("Simulated Win32 wininet InternetGetConnectedState failure".to_string())
            } else {
                Ok(self.connected.load(Ordering::SeqCst))
            }
        }
    }

    #[test]
    fn test_network_failure_handling_and_recovery() {
        let should_fail = Arc::new(AtomicBool::new(false));
        let connected = Arc::new(AtomicBool::new(true));
        let provider = MockFailableNetworkProvider {
            should_fail: Arc::clone(&should_fail),
            connected: Arc::clone(&connected),
        };

        let mut detector = NetworkDetector::new(Box::new(provider));

        // 1. Initial check succeeds
        let res = detector.check_events();
        assert!(res.is_ok());
        assert_eq!(detector.is_currently_connected(), Some(true));

        // 2. Native API fails -> returns Err without panicking
        should_fail.store(true, Ordering::SeqCst);
        let res = detector.check_events();
        assert!(res.is_err());
        assert_eq!(
            res.unwrap_err(),
            "Simulated Win32 wininet InternetGetConnectedState failure"
        );
        // Last known state is preserved
        assert_eq!(detector.is_currently_connected(), Some(true));

        // 3. Native API recovers with network disconnected -> emits transition
        should_fail.store(false, Ordering::SeqCst);
        connected.store(false, Ordering::SeqCst);
        let res = detector.check_events();
        assert!(res.is_ok());
        let events = res.unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::NETWORK_DISCONNECTED);
        assert_eq!(detector.is_currently_connected(), Some(false));
    }
}
