use crate::events::types::{DesktopEvent, EventType};
use serde_json::json;

/// Raw power snapshot from the OS or mock provider
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RawPowerStatus {
    /// 0 = offline (discharging), 1 = online (charging / AC), 255 = unknown
    pub ac_line_status: u8,
    /// 0..100 percentage, or 255 = unknown / no battery
    pub battery_life_percent: u8,
}

/// Abstract provider for reading power state (enables deterministic mocking)
pub trait PowerStatusProvider: Send + Sync {
    fn get_power_status(&self) -> Result<RawPowerStatus, String>;
}

/// Real Windows implementation using Win32 GetSystemPowerStatus
pub struct WindowsPowerStatusProvider;

impl PowerStatusProvider for WindowsPowerStatusProvider {
    fn get_power_status(&self) -> Result<RawPowerStatus, String> {
        #[cfg(target_os = "windows")]
        {
            #[repr(C)]
            #[derive(Copy, Clone)]
            struct SystemPowerStatus {
                ac_line_status: u8,
                battery_flag: u8,
                battery_life_percent: u8,
                system_status_flag: u8,
                battery_life_time: u32,
                battery_full_life_time: u32,
            }

            extern "system" {
                fn GetSystemPowerStatus(lpSystemPowerStatus: *mut SystemPowerStatus) -> i32;
            }

            let mut status = SystemPowerStatus {
                ac_line_status: 255,
                battery_flag: 255,
                battery_life_percent: 255,
                system_status_flag: 0,
                battery_life_time: 0,
                battery_full_life_time: 0,
            };

            let success = unsafe { GetSystemPowerStatus(&mut status) };
            if success != 0 {
                Ok(RawPowerStatus {
                    ac_line_status: status.ac_line_status,
                    battery_life_percent: status.battery_life_percent,
                })
            } else {
                Err("Win32 GetSystemPowerStatus call failed".to_string())
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            // Non-Windows fallback for development/testing
            Ok(RawPowerStatus {
                ac_line_status: 1,
                battery_life_percent: 100,
            })
        }
    }
}

/// Categorized battery level bands
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BatteryBand {
    Normal,   // > 15%
    Low,      // <= 15% and > 8%
    Critical, // <= 8%
}

/// Native Battery & Power Detector
pub struct BatteryDetector {
    provider: Box<dyn PowerStatusProvider>,
    last_battery_band: Option<BatteryBand>,
    last_charging_state: Option<bool>, // true = charging, false = discharging
    last_percent: Option<u8>,
}

impl BatteryDetector {
    pub fn new(provider: Box<dyn PowerStatusProvider>) -> Self {
        Self {
            provider,
            last_battery_band: None,
            last_charging_state: None,
            last_percent: None,
        }
    }

    /// Creates a detector using the real native Windows power provider
    pub fn native() -> Self {
        Self::new(Box::new(WindowsPowerStatusProvider))
    }

    /// Polls the battery state and emits DesktopEvents only on meaningful state transitions
    pub fn check_events(&mut self) -> Result<Vec<DesktopEvent>, String> {
        let raw = self.provider.get_power_status()?;
        let mut events = Vec::new();

        // 1. Check Charging Transitions
        // ac_line_status: 0 = discharging, 1 = online (charging/AC)
        if raw.ac_line_status != 255 {
            let is_charging = raw.ac_line_status == 1;

            if let Some(prev_charging) = self.last_charging_state {
                if is_charging && !prev_charging {
                    events.push(DesktopEvent::new(
                        EventType::CHARGING_STARTED,
                        "battery",
                        json!({
                            "battery_percent": raw.battery_life_percent,
                            "ac_line_status": raw.ac_line_status,
                        }),
                    ));
                } else if !is_charging && prev_charging {
                    events.push(DesktopEvent::new(
                        EventType::CHARGING_STOPPED,
                        "battery",
                        json!({
                            "battery_percent": raw.battery_life_percent,
                            "ac_line_status": raw.ac_line_status,
                        }),
                    ));
                }
            } else {
                // First reading: record state without emitting transition
            }
            self.last_charging_state = Some(is_charging);
        }

        // 2. Check Battery Percentage Band Transitions
        if raw.battery_life_percent <= 100 {
            let current_band = if raw.battery_life_percent <= 8 {
                BatteryBand::Critical
            } else if raw.battery_life_percent <= 15 {
                BatteryBand::Low
            } else {
                BatteryBand::Normal
            };

            let prev_band = self.last_battery_band;

            match (prev_band, current_band) {
                (Some(BatteryBand::Critical), BatteryBand::Critical) => {
                    // Already critical, suppress duplicate
                }
                (_, BatteryBand::Critical) => {
                    // Transition into Critical (<= 8%)
                    events.push(DesktopEvent::new(
                        EventType::BATTERY_CRITICAL,
                        "battery",
                        json!({
                            "battery_percent": raw.battery_life_percent,
                            "previous_percent": self.last_percent,
                            "ac_line_status": raw.ac_line_status,
                        }),
                    ));
                }
                (Some(BatteryBand::Low), BatteryBand::Low) => {
                    // Already low, suppress duplicate
                }
                (Some(BatteryBand::Critical), BatteryBand::Low) => {
                    // Recovering from critical to low, no need to re-alert low
                }
                (_, BatteryBand::Low) => {
                    // Transition into Low (<= 15% and > 8%)
                    events.push(DesktopEvent::new(
                        EventType::BATTERY_LOW,
                        "battery",
                        json!({
                            "battery_percent": raw.battery_life_percent,
                            "previous_percent": self.last_percent,
                            "ac_line_status": raw.ac_line_status,
                        }),
                    ));
                }
                _ => {
                    // Normal state (> 15%), no alert needed
                }
            }

            self.last_battery_band = Some(current_band);
            self.last_percent = Some(raw.battery_life_percent);
        }

        Ok(events)
    }

    /// Resets internal tracking state
    pub fn reset(&mut self) {
        self.last_battery_band = None;
        self.last_charging_state = None;
        self.last_percent = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::Arc;

    struct MockPowerProvider {
        ac_line: Arc<AtomicU8>,
        percent: Arc<AtomicU8>,
    }

    impl PowerStatusProvider for MockPowerProvider {
        fn get_power_status(&self) -> Result<RawPowerStatus, String> {
            Ok(RawPowerStatus {
                ac_line_status: self.ac_line.load(Ordering::SeqCst),
                battery_life_percent: self.percent.load(Ordering::SeqCst),
            })
        }
    }

    #[test]
    fn test_battery_low_and_critical_thresholds() {
        let ac = Arc::new(AtomicU8::new(0)); // Discharging
        let pct = Arc::new(AtomicU8::new(50)); // 50%
        let provider = MockPowerProvider {
            ac_line: Arc::clone(&ac),
            percent: Arc::clone(&pct),
        };

        let mut detector = BatteryDetector::new(Box::new(provider));

        // 1. Initial check at 50% -> Normal band, no event
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 2. Drop to 15% -> BATTERY_LOW emitted
        pct.store(15, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::BATTERY_LOW);
        assert_eq!(events[0].payload["battery_percent"], 15);

        // 3. Drop to 14% -> Still in Low band, duplicate suppressed
        pct.store(14, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 4. Drop to 8% -> BATTERY_CRITICAL emitted
        pct.store(8, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::BATTERY_CRITICAL);

        // 5. Drop to 5% -> Still in Critical band, duplicate suppressed
        pct.store(5, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);
    }

    #[test]
    fn test_charging_transitions_and_deduplication() {
        let ac = Arc::new(AtomicU8::new(0)); // Discharging
        let pct = Arc::new(AtomicU8::new(80));
        let provider = MockPowerProvider {
            ac_line: Arc::clone(&ac),
            percent: Arc::clone(&pct),
        };

        let mut detector = BatteryDetector::new(Box::new(provider));

        // Initial check: establishes baseline
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // Plug in charger (ac_line = 1) -> CHARGING_STARTED
        ac.store(1, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::CHARGING_STARTED);

        // Subsequent check while still charging -> duplicate suppressed
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // Unplug charger (ac_line = 0) -> CHARGING_STOPPED
        ac.store(0, Ordering::SeqCst);
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::CHARGING_STOPPED);

        // Subsequent check while still discharging -> duplicate suppressed
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);
    }
}
