use crate::events::types::{DesktopEvent, EventType};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

/// Snapshot of the active foreground application
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppInfo {
    pub app_name: String,
    pub process_id: u32,
    pub window_title: Option<String>,
}

/// Abstract provider for querying the foreground window (enables deterministic testing)
pub trait ForegroundAppProvider: Send + Sync {
    fn get_foreground_app(&self) -> Result<Option<AppInfo>, String>;
}

/// Real Windows implementation using Win32 GetForegroundWindow and GetWindowTextW
pub struct WindowsForegroundAppProvider;

impl ForegroundAppProvider for WindowsForegroundAppProvider {
    fn get_foreground_app(&self) -> Result<Option<AppInfo>, String> {
        #[cfg(target_os = "windows")]
        {
            extern "system" {
                fn GetForegroundWindow() -> isize;
                fn GetWindowTextW(hWnd: isize, lpString: *mut u16, nMaxCount: i32) -> i32;
                fn GetWindowThreadProcessId(hWnd: isize, lpdwProcessId: *mut u32) -> u32;
            }

            let hwnd = unsafe { GetForegroundWindow() };
            if hwnd == 0 {
                return Ok(None);
            }

            let mut process_id: u32 = 0;
            unsafe { GetWindowThreadProcessId(hwnd, &mut process_id) };

            let mut title_buf = [0u16; 512];
            let len = unsafe { GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 512) };

            let title = if len > 0 {
                String::from_utf16_lossy(&title_buf[..len as usize])
            } else {
                String::new()
            };

            // Derive a clean, human-readable application label from the window title or process
            let app_name = sanitize_app_name(&title, process_id);

            Ok(Some(AppInfo {
                app_name,
                process_id,
                window_title: if !title.is_empty() { Some(title) } else { None },
            }))
        }

        #[cfg(not(target_os = "windows"))]
        {
            let window_title = Some("Mock Application".to_string());
            let app_name = sanitize_app_name("Mock Application", 1234);
            Ok(Some(AppInfo {
                app_name,
                process_id: 1234,
                window_title,
            }))
        }
    }
}

/// Sanitizes application window titles into compact application identifiers
#[allow(dead_code)]
pub fn sanitize_app_name(title: &str, process_id: u32) -> String {
    if title.is_empty() {
        return format!("Process_{}", process_id);
    }

    // Common standard application patterns (e.g. "Visual Studio Code", "Google Chrome", "Spotify")
    let lower = title.to_lowercase();
    if lower.contains("visual studio code") || lower.contains("code") {
        "VS Code".to_string()
    } else if lower.contains("chrome") {
        "Google Chrome".to_string()
    } else if lower.contains("firefox") {
        "Firefox".to_string()
    } else if lower.contains("spotify") {
        "Spotify".to_string()
    } else if lower.contains("discord") {
        "Discord".to_string()
    } else if lower.contains("slack") {
        "Slack".to_string()
    } else if lower.contains("terminal")
        || lower.contains("powershell")
        || lower.contains("cmd.exe")
    {
        "Terminal".to_string()
    } else {
        // Use first segment of title if formatted with dash (e.g. "File.txt - Notepad")
        if let Some(pos) = title.rfind(" - ") {
            title[pos + 3..].trim().to_string()
        } else {
            let max_len = title.len().min(40);
            title[..max_len].trim().to_string()
        }
    }
}

/// Native Selected Application Activity & Focus Transition Detector (Sprint 5 Phase 2)
pub struct AppActivityDetector {
    provider: Box<dyn ForegroundAppProvider>,
    allow_list: Vec<String>,
    active_selected_app: Option<AppInfo>,
    last_detected_app: Option<AppInfo>,
    last_transition_time_ms: u64,
    min_debounce_ms: u64,
    is_initial_scan: bool,
}

impl AppActivityDetector {
    /// Creates a detector with default empty allow-list (or backward-compatible setup)
    pub fn new(provider: Box<dyn ForegroundAppProvider>, min_debounce_ms: u64) -> Self {
        Self::with_allow_list(provider, Vec::new(), min_debounce_ms)
    }

    /// Creates a detector with a configurable allow-list
    pub fn with_allow_list(
        provider: Box<dyn ForegroundAppProvider>,
        allow_list: Vec<String>,
        min_debounce_ms: u64,
    ) -> Self {
        Self {
            provider,
            allow_list,
            active_selected_app: None,
            last_detected_app: None,
            last_transition_time_ms: 0,
            min_debounce_ms,
            is_initial_scan: true,
        }
    }

    /// Creates a detector using the real native Windows foreground app provider
    pub fn native(allow_list: Vec<String>) -> Self {
        Self::with_allow_list(Box::new(WindowsForegroundAppProvider), allow_list, 500)
    }

    /// Updates the selected application allow-list at runtime
    pub fn set_allow_list(&mut self, allow_list: Vec<String>) {
        self.allow_list = allow_list;
        // If current active app is no longer allowed, clear active_selected_app
        if let Some(ref current) = self.active_selected_app {
            if self.is_app_allowed(&current.app_name).is_none() {
                self.active_selected_app = None;
            }
        }
    }

    /// Returns the current allow-list
    pub fn get_allow_list(&self) -> &[String] {
        &self.allow_list
    }

    /// Matches an app name against the allow-list (case-insensitive substring/equality)
    pub fn is_app_allowed(&self, app_name: &str) -> Option<String> {
        let app_lower = app_name.to_lowercase();
        for item in &self.allow_list {
            let item_lower = item.trim().to_lowercase();
            if !item_lower.is_empty()
                && (app_lower == item_lower
                    || app_lower.contains(&item_lower)
                    || item_lower.contains(&app_lower))
            {
                return Some(item.clone());
            }
        }
        None
    }

    /// Polls foreground window and emits APP_OPENED / APP_CLOSED only for selected applications
    pub fn check_events(&mut self) -> Result<Vec<DesktopEvent>, String> {
        let current = self.provider.get_foreground_app()?;
        let mut events = Vec::new();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        match current {
            None => {
                self.is_initial_scan = false;
                // No foreground window (e.g. desktop/lockscreen)
                if let Some(prev_selected) = self.active_selected_app.take() {
                    let app_id = self.is_app_allowed(&prev_selected.app_name);
                    events.push(DesktopEvent::new(
                        EventType::APP_CLOSED,
                        "application",
                        json!({
                            "app_name": prev_selected.app_name,
                            "app_id": app_id,
                            "process_id": prev_selected.process_id,
                            "previous_app": null,
                        }),
                    ));
                }
                self.last_detected_app = None;
            }
            Some(current_app) => {
                // Check if identical to last detected app -> duplicate suppression
                let is_same_app = self
                    .last_detected_app
                    .as_ref()
                    .map(|a| a.app_name == current_app.app_name)
                    .unwrap_or(false);

                if is_same_app {
                    return Ok(events);
                }

                let current_allowed_id = self.is_app_allowed(&current_app.app_name);

                if self.is_initial_scan {
                    // On initial scan, establish baseline without spurious open events
                    self.is_initial_scan = false;
                    self.last_detected_app = Some(current_app.clone());
                    if current_allowed_id.is_some() {
                        self.active_selected_app = Some(current_app);
                    }
                    return Ok(events);
                }

                // Check debounce
                let debounce_satisfied =
                    now.saturating_sub(self.last_transition_time_ms) >= self.min_debounce_ms;

                if !debounce_satisfied {
                    return Ok(events);
                }

                self.last_transition_time_ms = now;

                match current_allowed_id {
                    Some(app_id) => {
                        // Current app is in allow-list
                        if let Some(prev_allowed) = self.active_selected_app.take() {
                            if prev_allowed.app_name != current_app.app_name {
                                // Switched from Allowed App A -> Allowed App B
                                let prev_id = self.is_app_allowed(&prev_allowed.app_name);
                                events.push(DesktopEvent::new(
                                    EventType::APP_CLOSED,
                                    "application",
                                    json!({
                                        "app_name": prev_allowed.app_name,
                                        "app_id": prev_id,
                                        "process_id": prev_allowed.process_id,
                                        "previous_app": null,
                                    }),
                                ));

                                events.push(DesktopEvent::new(
                                    EventType::APP_OPENED,
                                    "application",
                                    json!({
                                        "app_name": current_app.app_name,
                                        "app_id": Some(app_id),
                                        "process_id": current_app.process_id,
                                        "previous_app": Some(prev_allowed.app_name),
                                    }),
                                ));
                            }
                        } else {
                            // Switched from Unselected App -> Allowed App B
                            let prev_name = self.last_detected_app.as_ref().map(|a| a.app_name.clone());
                            events.push(DesktopEvent::new(
                                EventType::APP_OPENED,
                                "application",
                                json!({
                                    "app_name": current_app.app_name,
                                    "app_id": Some(app_id),
                                    "process_id": current_app.process_id,
                                    "previous_app": prev_name,
                                }),
                            ));
                        }
                        self.active_selected_app = Some(current_app.clone());
                    }
                    None => {
                        // Current app is NOT in allow-list
                        if let Some(prev_allowed) = self.active_selected_app.take() {
                            // Allowed App A was active, but now switched away to unlisted app
                            let prev_id = self.is_app_allowed(&prev_allowed.app_name);
                            events.push(DesktopEvent::new(
                                EventType::APP_CLOSED,
                                "application",
                                json!({
                                    "app_name": prev_allowed.app_name,
                                    "app_id": prev_id,
                                    "process_id": prev_allowed.process_id,
                                    "previous_app": null,
                                }),
                            ));
                        }
                        // If no allowed app was active, unselected -> unselected produces zero events
                    }
                }

                self.last_detected_app = Some(current_app);
            }
        }

        Ok(events)
    }

    /// Returns the currently active selected application
    pub fn get_active_selected_app(&self) -> Option<&AppInfo> {
        self.active_selected_app.as_ref()
    }

    /// Returns the last known active application
    pub fn get_current_app(&self) -> Option<&AppInfo> {
        self.last_detected_app.as_ref()
    }

    /// Resets internal state
    pub fn reset(&mut self) {
        self.active_selected_app = None;
        self.last_detected_app = None;
        self.last_transition_time_ms = 0;
        self.is_initial_scan = true;
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    pub struct MockAppProvider {
        pub current_app: Arc<Mutex<Option<AppInfo>>>,
        pub should_fail: Arc<Mutex<bool>>,
    }

    impl ForegroundAppProvider for MockAppProvider {
        fn get_foreground_app(&self) -> Result<Option<AppInfo>, String> {
            if *self.should_fail.lock().unwrap() {
                return Err("Simulated foreground window query failure".to_string());
            }
            Ok(self.current_app.lock().unwrap().clone())
        }
    }

    fn make_app(name: &str, pid: u32) -> AppInfo {
        AppInfo {
            app_name: name.to_string(),
            process_id: pid,
            window_title: Some(format!("{} - Window", name)),
        }
    }

    #[test]
    fn test_empty_allow_list() {
        let current = Arc::new(Mutex::new(Some(make_app("VS Code", 100))));
        let provider = MockAppProvider {
            current_app: Arc::clone(&current),
            should_fail: Arc::new(Mutex::new(false)),
        };

        // Empty allow-list
        let mut detector = AppActivityDetector::with_allow_list(Box::new(provider), Vec::new(), 0);

        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        *current.lock().unwrap() = Some(make_app("Google Chrome", 200));
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);
    }

    #[test]
    fn test_single_and_multiple_allowed_apps_lifecycle() {
        let current = Arc::new(Mutex::new(Some(make_app("Notepad", 50)))); // Unlisted
        let provider = MockAppProvider {
            current_app: Arc::clone(&current),
            should_fail: Arc::new(Mutex::new(false)),
        };

        let allow_list = vec!["VS Code".to_string(), "Google Chrome".to_string()];
        let mut detector = AppActivityDetector::with_allow_list(Box::new(provider), allow_list, 0);

        // 1. Initial check (Notepad) -> baseline established, 0 events
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);
        assert_eq!(detector.get_active_selected_app(), None);

        // 2. Switch to VS Code (Allowed App A) -> APP_OPENED
        *current.lock().unwrap() = Some(make_app("VS Code", 100));
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::APP_OPENED);
        assert_eq!(events[0].payload["app_name"], "VS Code");
        assert_eq!(detector.get_active_selected_app().unwrap().app_name, "VS Code");

        // 3. Repeated check in VS Code -> duplicate suppressed
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 4. Switch from VS Code -> Google Chrome (Allowed App B) -> APP_CLOSED(VS Code) + APP_OPENED(Google Chrome)
        *current.lock().unwrap() = Some(make_app("Google Chrome", 200));
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event_type, EventType::APP_CLOSED);
        assert_eq!(events[0].payload["app_name"], "VS Code");
        assert_eq!(events[1].event_type, EventType::APP_OPENED);
        assert_eq!(events[1].payload["app_name"], "Google Chrome");
        assert_eq!(detector.get_active_selected_app().unwrap().app_name, "Google Chrome");

        // 5. Switch from Google Chrome -> Notepad (Unlisted) -> APP_CLOSED(Google Chrome)
        *current.lock().unwrap() = Some(make_app("Notepad", 50));
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::APP_CLOSED);
        assert_eq!(events[0].payload["app_name"], "Google Chrome");
        assert_eq!(detector.get_active_selected_app(), None);

        // 6. Switch from Notepad -> Calculator (both unlisted) -> 0 events
        *current.lock().unwrap() = Some(make_app("Calculator", 60));
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 7. Return back to VS Code -> APP_OPENED
        *current.lock().unwrap() = Some(make_app("VS Code", 100));
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::APP_OPENED);
        assert_eq!(events[0].payload["app_name"], "VS Code");

        // 8. Desktop foreground (None) -> APP_CLOSED(VS Code)
        *current.lock().unwrap() = None;
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::APP_CLOSED);
        assert_eq!(events[0].payload["app_name"], "VS Code");
    }

    #[test]
    fn test_debounce_and_rapid_switching() {
        let current = Arc::new(Mutex::new(Some(make_app("Notepad", 50))));
        let provider = MockAppProvider {
            current_app: Arc::clone(&current),
            should_fail: Arc::new(Mutex::new(false)),
        };

        // 500ms debounce
        let allow_list = vec!["VS Code".to_string()];
        let mut detector = AppActivityDetector::with_allow_list(Box::new(provider), allow_list, 500);

        // Initial scan
        let _ = detector.check_events().unwrap();

        // Switch to VS Code
        *current.lock().unwrap() = Some(make_app("VS Code", 100));
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::APP_OPENED);

        // Immediate rapid switch within debounce interval (<500ms)
        *current.lock().unwrap() = Some(make_app("Notepad", 50));
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0); // Debounce suppressed transient switch
    }

    #[test]
    fn test_error_handling_and_recovery() {
        let current = Arc::new(Mutex::new(Some(make_app("VS Code", 100))));
        let should_fail = Arc::new(Mutex::new(false));
        let provider = MockAppProvider {
            current_app: Arc::clone(&current),
            should_fail: Arc::clone(&should_fail),
        };

        let mut detector =
            AppActivityDetector::with_allow_list(Box::new(provider), vec!["VS Code".to_string()], 0);

        let _ = detector.check_events().unwrap();

        // Provider fails -> returns Err safely without crashing
        *should_fail.lock().unwrap() = true;
        let res = detector.check_events();
        assert!(res.is_err());

        // Provider recovers -> detector continues cleanly
        *should_fail.lock().unwrap() = false;
        *current.lock().unwrap() = Some(make_app("Notepad", 50));
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::APP_CLOSED);
    }

    #[test]
    fn test_configuration_update_allow_list() {
        let current = Arc::new(Mutex::new(Some(make_app("Chrome", 200))));
        let provider = MockAppProvider {
            current_app: Arc::clone(&current),
            should_fail: Arc::new(Mutex::new(false)),
        };

        // Initially only VS Code is allowed
        let mut detector =
            AppActivityDetector::with_allow_list(Box::new(provider), vec!["VS Code".to_string()], 0);

        let _ = detector.check_events().unwrap();
        assert_eq!(detector.get_active_selected_app(), None);

        // Update allow-list to include Chrome
        detector.set_allow_list(vec!["VS Code".to_string(), "Chrome".to_string()]);
        assert_eq!(detector.get_allow_list().len(), 2);

        // Switch to Chrome -> now recognized as allowed app
        *current.lock().unwrap() = Some(make_app("Google Chrome", 200));
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::APP_OPENED);
    }
}
