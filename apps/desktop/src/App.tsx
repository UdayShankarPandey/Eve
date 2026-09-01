import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

interface ShellInfo {
  app_name: string;
  version: string;
  status: string;
}

function App() {
  const [greeting, setGreeting] = useState<string>("PixelPal Desktop Shell");
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    // Load shell info to verify React-Rust communication
    loadShellInfo();
  }, []);

  async function loadShellInfo() {
    try {
      const info = await invoke<ShellInfo>("get_shell_info");
      setGreeting(`${info.app_name} v${info.version} - ${info.status}`);
    } catch (e) {
      console.error("Failed to load shell info:", e);
    }
  }

  const handleMouseDown = async () => {
    setIsDragging(true);
    try {
      await getCurrentWindow().startDragging();
    } catch (e) {
      console.error("Failed to start dragging:", e);
      setIsDragging(false);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="pixelpal-container" onMouseDown={handleMouseDown} onMouseUp={handleMouseUp}>
      <div className={`placeholder-character ${isDragging ? "dragging" : ""}`}>
        <div className="character-body">
          <div className="character-face">
            <div className="eye left"></div>
            <div className="eye right"></div>
            <div className="mouth"></div>
          </div>
        </div>
        <div className="status-indicator" title={greeting}>
          <span className="status-dot"></span>
        </div>
      </div>
    </div>
  );
}

export default App;
