use serde::{Deserialize, Serialize};

/// Canonical Event Types for the PixelPal Event Engine
pub struct EventType;

impl EventType {
    // Battery & Power
    pub const BATTERY_LOW: &'static str = "BATTERY_LOW";
    pub const BATTERY_CRITICAL: &'static str = "BATTERY_CRITICAL";
    pub const CHARGING_STARTED: &'static str = "CHARGING_STARTED";
    pub const CHARGING_STOPPED: &'static str = "CHARGING_STOPPED";

    // User Activity
    pub const USER_IDLE: &'static str = "USER_IDLE";
    pub const USER_ACTIVE: &'static str = "USER_ACTIVE";

    // System & Session
    pub const PC_LOCKED: &'static str = "PC_LOCKED";
    pub const PC_UNLOCKED: &'static str = "PC_UNLOCKED";

    // Network
    pub const NETWORK_CONNECTED: &'static str = "NETWORK_CONNECTED";
    pub const NETWORK_DISCONNECTED: &'static str = "NETWORK_DISCONNECTED";

    // Application Activity
    pub const APP_OPENED: &'static str = "APP_OPENED";
    pub const APP_CLOSED: &'static str = "APP_CLOSED";

    // Filesystem
    pub const DOWNLOAD_COMPLETED: &'static str = "DOWNLOAD_COMPLETED";
}

/// Standardized DesktopEvent contract
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DesktopEvent {
    /// Unique event identifier
    pub id: String,
    /// Canonical event type (e.g. "BATTERY_LOW", "USER_IDLE", "NETWORK_CONNECTED")
    #[serde(rename = "type")]
    pub event_type: String,
    /// Epoch timestamp in milliseconds
    pub timestamp: u64,
    /// Detector/subsystem category (e.g. "battery", "user_activity", "session", "network", "application", "filesystem")
    pub source: String,
    /// Structured payload containing event-specific data
    pub payload: serde_json::Value,
    /// Optional metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

impl DesktopEvent {
    /// Helper constructor for creating a new standardized DesktopEvent
    pub fn new(
        event_type: impl Into<String>,
        source: impl Into<String>,
        payload: serde_json::Value,
    ) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let id = format!("{}_{}", timestamp, fastrand_or_fallback());

        Self {
            id,
            event_type: event_type.into(),
            timestamp,
            source: source.into(),
            payload,
            metadata: None,
        }
    }
}

/// Simple pseudo-random fallback for generating unique ID suffixes without heavy dependencies
fn fastrand_or_fallback() -> u32 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(12345);
    nanos % 1_000_000
}
