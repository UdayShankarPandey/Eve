use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// Window state for desktop shell management
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub always_on_top: bool,
    pub is_visible: bool,
}

/// Configuration for window defaults
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowConfig {
    pub default_width: u32,
    pub default_height: u32,
    pub default_always_on_top: bool,
    pub default_x: Option<i32>,
    pub default_y: Option<i32>,
}

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            default_width: 400,
            default_height: 400,
            default_always_on_top: true,
            default_x: None,
            default_y: None,
        }
    }
}

/// Get the current window state
#[tauri::command]
fn get_window_state(app: AppHandle) -> Result<WindowState, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Failed to get main window")?;

    let size = window
        .outer_size()
        .map_err(|e| format!("Failed to get window size: {}", e))?;

    let always_on_top = window
        .is_always_on_top()
        .map_err(|e| format!("Failed to get always-on-top state: {}", e))?;

    let is_visible = window
        .is_visible()
        .map_err(|e| format!("Failed to get visibility state: {}", e))?;

    Ok(WindowState {
        width: size.width,
        height: size.height,
        always_on_top,
        is_visible,
    })
}

/// Get the application shell info
#[tauri::command]
fn get_shell_info() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "app_name": "PixelPal",
        "version": "0.1.0",
        "status": "running"
    }))
}

/// Toggle always-on-top state
#[tauri::command]
fn toggle_always_on_top(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Failed to get main window")?;

    let current_state = window
        .is_always_on_top()
        .map_err(|e| format!("Failed to get always-on-top state: {}", e))?;

    let new_state = !current_state;

    window
        .set_always_on_top(new_state)
        .map_err(|e| format!("Failed to set always-on-top: {}", e))?;

    Ok(new_state)
}

/// Show the main window
#[tauri::command]
fn show_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Failed to get main window")?;

    window
        .show()
        .map_err(|e| format!("Failed to show window: {}", e))?;

    Ok(())
}

/// Hide the main window
#[tauri::command]
fn hide_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Failed to get main window")?;

    window
        .hide()
        .map_err(|e| format!("Failed to hide window: {}", e))?;

    Ok(())
}

/// Get the default window configuration
#[tauri::command]
fn get_window_config() -> Result<WindowConfig, String> {
    Ok(WindowConfig::default())
}

/// Simple greeting command for React-Rust communication testing
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! PixelPal desktop shell is working.", name)
}

/// Setup the system tray
fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show PixelPal", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "Hide PixelPal", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit PixelPal", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("PixelPal - Desktop Companion")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Err(e) = setup_tray(app.handle()) {
                eprintln!("Failed to setup system tray: {}", e);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_window_state,
            get_shell_info,
            toggle_always_on_top,
            show_window,
            hide_window,
            get_window_config,
            greet,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
