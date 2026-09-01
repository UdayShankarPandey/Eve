pub mod types;

pub use types::{DesktopEvent, EventType};

use crate::detectors::{DetectorConfig, DetectorManager};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Status of the native Event Engine
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EventEngineStatus {
    pub is_running: bool,
    pub config: DetectorConfig,
    pub total_events_emitted: u64,
}

/// Central Native Event Engine running in Rust
pub struct NativeEventEngine {
    is_running: Arc<AtomicBool>,
    manager: Arc<Mutex<DetectorManager>>,
    event_count: Arc<Mutex<u64>>,
    worker_handle: Option<thread::JoinHandle<()>>,
}

impl NativeEventEngine {
    pub fn new(config: DetectorConfig) -> Self {
        let manager = DetectorManager::native(config);
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            manager: Arc::new(Mutex::new(manager)),
            event_count: Arc::new(Mutex::new(0)),
            worker_handle: None,
        }
    }

    /// Starts the background detector loop
    pub fn start(&mut self, app: AppHandle) -> Result<(), String> {
        if self.is_running.load(Ordering::SeqCst) {
            return Ok(()); // Already running
        }

        self.is_running.store(true, Ordering::SeqCst);
        let is_running_clone = Arc::clone(&self.is_running);
        let manager_clone = Arc::clone(&self.manager);
        let event_count_clone = Arc::clone(&self.event_count);

        let handle = thread::spawn(move || {
            while is_running_clone.load(Ordering::SeqCst) {
                // Poll every 1000ms
                thread::sleep(Duration::from_millis(1000));
                if !is_running_clone.load(Ordering::SeqCst) {
                    break;
                }

                // Collect events from all active detectors
                let events = {
                    let mut mgr = match manager_clone.lock() {
                        Ok(guard) => guard,
                        Err(_) => continue,
                    };
                    mgr.check_all()
                };

                // Emit events to frontend/webview over Tauri IPC channel
                for event in events {
                    if let Ok(mut count) = event_count_clone.lock() {
                        *count += 1;
                    }

                    let _ = app.emit("desktop-event", &event);
                }
            }
        });

        self.worker_handle = Some(handle);
        Ok(())
    }

    /// Stops the background detector loop
    pub fn stop(&mut self) -> Result<(), String> {
        self.is_running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.worker_handle.take() {
            let _ = handle.join();
        }
        Ok(())
    }

    /// Returns current runtime status
    pub fn get_status(&self) -> EventEngineStatus {
        let is_running = self.is_running.load(Ordering::SeqCst);
        let config = self
            .manager
            .lock()
            .map(|mgr| mgr.config.clone())
            .unwrap_or_default();
        let total_events_emitted = self.event_count.lock().map(|c| *c).unwrap_or(0);

        EventEngineStatus {
            is_running,
            config,
            total_events_emitted,
        }
    }
}
