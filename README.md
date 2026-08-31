# PixelPal

Turn yourself into a pixel character that lives on your desktop and reacts to your digital life.

## Overview
PixelPal is an AI-powered personalized desktop companion for Windows. The application transforms a user-provided photograph into a personalized pixel/chibi character and places that character on the Windows desktop. The character reacts to permitted desktop events (battery state, PC lock/unlock, user idle state, etc.) in a deterministic and local-first manner, with AI serving as an enhancement layer.

## Current Project Status
Sprint 0 (Planning & Foundation) completed. Project scope, MVP, architecture, and development scaffolding have been established.

## High-Level Architecture
PixelPal uses an event-driven architecture designed for modularity, privacy, and local-first execution.
- **Frontend**: React + TypeScript + Tailwind CSS
- **Desktop/Native Layer**: Tauri 2 (Rust)
- **Event Bus**: Common deterministic event system (OS events -> DesktopEvents)
- **State/Persistence**: SQLite for characters, settings, events, animations

## Technology Stack
- **Desktop Framework**: Tauri 2
- **Frontend**: React (TypeScript), Tailwind CSS
- **Backend/Native**: Rust
- **Database**: SQLite
- **Testing**: Vitest, Playwright, Rust native tests
- **CI/CD**: GitHub Actions

## Development Setup
Please see [docs/development.md](docs/development.md) for detailed environment setup instructions.

## Scope
- **MVP Scope**: Detailed in [docs/mvp.md](docs/mvp.md).
- **Future Scope**: Outlined in the future features section of [docs/mvp.md](docs/mvp.md). Includes AI generation, LLM chat, application-specific monitoring (VS Code, Discord, Spotify), and more.

## Privacy
PixelPal is built with a local-first privacy model. For detailed privacy guidelines and boundaries, refer to [docs/privacy.md](docs/privacy.md).
