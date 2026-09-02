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

/// Native Application Activity Detector
pub struct AppActivityDetector {
    provider: Box<dyn ForegroundAppProvider>,
    last_app: Option<AppInfo>,
    last_transition_time_ms: u64,
    min_debounce_ms: u64,
}

impl AppActivityDetector {
    pub fn new(provider: Box<dyn ForegroundAppProvider>, min_debounce_ms: u64) -> Self {
        Self {
            provider,
            last_app: None,
            last_transition_time_ms: 0,
            min_debounce_ms,
        }
    }

    /// Creates a detector using the real native Windows foreground app provider
    pub fn native() -> Self {
        Self::new(Box::new(WindowsForegroundAppProvider), 500) // 500ms debounce
    }

    /// Polls foreground window and emits DesktopEvents only on meaningful application switches
    pub fn check_events(&mut self) -> Result<Vec<DesktopEvent>, String> {
        let current = self.provider.get_foreground_app()?;
        let mut events = Vec::new();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        if let Some(current_app) = current {
            let is_different_app = match &self.last_app {
                Some(prev) => prev.app_name != current_app.app_name,
                None => false, // initial baseline recording
            };

            let debounce_satisfied =
                now.saturating_sub(self.last_transition_time_ms) >= self.min_debounce_ms;

            if is_different_app && debounce_satisfied {
                let prev_name = self.last_app.as_ref().map(|a| a.app_name.clone());

                events.push(DesktopEvent::new(
                    EventType::APP_OPENED,
                    "application",
                    json!({
                        "app_name": current_app.app_name,
                        "process_id": current_app.process_id,
                        "previous_app": prev_name,
                    }),
                ));

                self.last_transition_time_ms = now;
            }

            self.last_app = Some(current_app);
        }

        Ok(events)
    }

    /// Returns the last known active application
    pub fn get_current_app(&self) -> Option<&AppInfo> {
        self.last_app.as_ref()
    }

    /// Resets internal state
    pub fn reset(&mut self) {
        self.last_app = None;
        self.last_transition_time_ms = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::Mutex;

    struct MockAppProvider {
        current_app: Arc<Mutex<Option<AppInfo>>>,
    }

    impl ForegroundAppProvider for MockAppProvider {
        fn get_foreground_app(&self) -> Result<Option<AppInfo>, String> {
            Ok(self.current_app.lock().unwrap().clone())
        }
    }

    #[test]
    fn test_app_transitions_and_deduplication() {
        let app_state = Arc::new(Mutex::new(Some(AppInfo {
            app_name: "VS Code".to_string(),
            process_id: 100,
            window_title: Some("code.rs - VS Code".to_string()),
        })));

        let provider = MockAppProvider {
            current_app: Arc::clone(&app_state),
        };

        let mut detector = AppActivityDetector::new(Box::new(provider), 0); // 0ms debounce for tests

        // 1. Initial check establishes baseline -> no event
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 2. Same app stays in focus -> duplicate suppressed
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 3. Switch to Google Chrome -> APP_OPENED emitted
        *app_state.lock().unwrap() = Some(AppInfo {
            app_name: "Google Chrome".to_string(),
            process_id: 200,
            window_title: Some("GitHub - Google Chrome".to_string()),
        });

        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::APP_OPENED);
        assert_eq!(events[0].payload["app_name"], "Google Chrome");
        assert_eq!(events[0].payload["previous_app"], "VS Code");

        // 4. Continued focus in Google Chrome -> duplicate suppressed
        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 0);

        // 5. Switch to Spotify -> APP_OPENED emitted
        *app_state.lock().unwrap() = Some(AppInfo {
            app_name: "Spotify".to_string(),
            process_id: 300,
            window_title: Some("Spotify Music".to_string()),
        });

        let events = detector.check_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, EventType::APP_OPENED);
        assert_eq!(events[0].payload["app_name"], "Spotify");
    }
}
