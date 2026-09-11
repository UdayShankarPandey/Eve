pub mod types;

pub use types::{DesktopEvent, EventType};

use crate::detectors::{DetectorConfig, DetectorManager};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex,
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
    shutdown_pair: Arc<(Mutex<bool>, Condvar)>,
}

impl NativeEventEngine {
    pub fn new(config: DetectorConfig) -> Self {
        let manager = DetectorManager::native(config);
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            manager: Arc::new(Mutex::new(manager)),
            event_count: Arc::new(Mutex::new(0)),
            worker_handle: None,
            shutdown_pair: Arc::new((Mutex::new(false), Condvar::new())),
        }
    }

    /// Starts the background detector loop with a custom event sink (for Tauri or tests)
    pub fn start_with_emitter<F>(&mut self, emit_fn: F) -> Result<(), String>
    where
        F: Fn(DesktopEvent) + Send + 'static,
    {
        if self.is_running.load(Ordering::SeqCst) {
            return Ok(()); // Idempotent: already running
        }

        // Reset stopped flag for new worker run
        {
            let (lock, _) = &*self.shutdown_pair;
            if let Ok(mut stopped) = lock.lock() {
                *stopped = false;
            }
        }

        self.is_running.store(true, Ordering::SeqCst);
        let is_running_clone = Arc::clone(&self.is_running);
        let manager_clone = Arc::clone(&self.manager);
        let event_count_clone = Arc::clone(&self.event_count);
        let shutdown_pair_clone = Arc::clone(&self.shutdown_pair);

        let handle = thread::spawn(move || {
            let (lock, cvar) = &*shutdown_pair_clone;
            while is_running_clone.load(Ordering::SeqCst) {
                // Wait for either timeout (1000ms) or early interrupt on shutdown
                {
                    let stopped = match lock.lock() {
                        Ok(g) => g,
                        Err(_) => break,
                    };
                    if *stopped || !is_running_clone.load(Ordering::SeqCst) {
                        break;
                    }
                    let wait_res = cvar.wait_timeout(stopped, Duration::from_millis(1000));
                    match wait_res {
                        Ok((g, _)) => {
                            if *g || !is_running_clone.load(Ordering::SeqCst) {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }

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

                // Emit events
                for event in events {
                    if let Ok(mut count) = event_count_clone.lock() {
                        *count += 1;
                    }
                    emit_fn(event);
                }
            }
        });

        self.worker_handle = Some(handle);
        Ok(())
    }

    /// Starts the background detector loop using Tauri AppHandle
    pub fn start(&mut self, app: AppHandle) -> Result<(), String> {
        self.start_with_emitter(move |event| {
            let _ = app.emit("desktop-event", &event);
        })
    }

    /// Stops the background detector loop promptly via interruptible Condvar notification
    pub fn stop(&mut self) -> Result<(), String> {
        self.is_running.store(false, Ordering::SeqCst);
        {
            let (lock, cvar) = &*self.shutdown_pair;
            if let Ok(mut stopped) = lock.lock() {
                *stopped = true;
                cvar.notify_all();
            }
        }
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

    /// Updates detector configuration at runtime, immediately controlling active detectors
    pub fn update_config(&self, config: DetectorConfig) -> Result<(), String> {
        let mut mgr = self
            .manager
            .lock()
            .map_err(|_| "Failed to lock detector manager".to_string())?;
        mgr.update_config(config);
        Ok(())
    }

    /// Returns the current detector configuration
    pub fn get_config(&self) -> Result<DetectorConfig, String> {
        let mgr = self
            .manager
            .lock()
            .map_err(|_| "Failed to lock detector manager".to_string())?;
        Ok(mgr.config.clone())
    }
}

impl Drop for NativeEventEngine {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn test_native_event_engine_runtime_config_update_and_suppression() {
        let engine = NativeEventEngine::new(DetectorConfig::default());
        let initial_config = engine.get_config().expect("Failed to get config");
        assert!(initial_config.battery_enabled);
        assert!(initial_config.filesystem_enabled);

        // Update config to disable battery and filesystem
        let mut updated = initial_config.clone();
        updated.battery_enabled = false;
        updated.filesystem_enabled = false;
        engine.update_config(updated).expect("Failed to update config");

        let current = engine.get_config().expect("Failed to get config");
        assert!(!current.battery_enabled, "Battery detector must be disabled");
        assert!(!current.filesystem_enabled, "Filesystem detector must be disabled");

        // Verify that check_all on underlying manager emits no battery/fs events
        let mut mgr = engine.manager.lock().unwrap();
        let events = mgr.check_all();
        for ev in events {
            assert_ne!(ev.source, "battery");
            assert_ne!(ev.source, "filesystem");
        }
    }

    #[test]
    fn test_native_event_engine_start_stop_idempotent() {
        let mut engine = NativeEventEngine::new(DetectorConfig::all_disabled());

        // Stop on unstarted engine is idempotent and safe
        assert!(engine.stop().is_ok());

        // Start engine
        assert!(engine.start_with_emitter(|_| {}).is_ok());
        assert!(engine.get_status().is_running);

        // Second start call while running is idempotent
        assert!(engine.start_with_emitter(|_| {}).is_ok());
        assert!(engine.get_status().is_running);

        // Stop engine
        assert!(engine.stop().is_ok());
        assert!(!engine.get_status().is_running);

        // Second stop call is idempotent
        assert!(engine.stop().is_ok());
        assert!(!engine.get_status().is_running);
    }

    #[test]
    fn test_native_event_engine_rapid_start_stop_cycling() {
        let mut engine = NativeEventEngine::new(DetectorConfig::all_disabled());

        for _ in 0..5 {
            assert!(engine.start_with_emitter(|_| {}).is_ok());
            assert!(engine.get_status().is_running);
            assert!(engine.stop().is_ok());
            assert!(!engine.get_status().is_running);
        }
    }

    #[test]
    fn test_native_event_engine_prompt_shutdown_unblocks_immediately() {
        let mut engine = NativeEventEngine::new(DetectorConfig::all_disabled());
        assert!(engine.start_with_emitter(|_| {}).is_ok());

        // Let worker thread start and enter cvar wait (1000ms timeout)
        thread::sleep(Duration::from_millis(20));

        let start_time = Instant::now();
        assert!(engine.stop().is_ok());
        let duration = start_time.elapsed();

        // Must wake up promptly via Condvar notification instead of waiting for 1000ms sleep
        assert!(
            duration < Duration::from_millis(200),
            "stop() took {:?}, expected < 200ms",
            duration
        );
        assert!(!engine.get_status().is_running);
    }

    #[test]
    fn test_native_event_engine_restart_after_stop_works() {
        let mut engine = NativeEventEngine::new(DetectorConfig::all_disabled());

        // First run
        assert!(engine.start_with_emitter(|_| {}).is_ok());
        assert!(engine.get_status().is_running);
        assert!(engine.stop().is_ok());
        assert!(!engine.get_status().is_running);

        // Restart run
        assert!(engine.start_with_emitter(|_| {}).is_ok());
        assert!(engine.get_status().is_running);
        assert!(engine.stop().is_ok());
        assert!(!engine.get_status().is_running);
    }
}
