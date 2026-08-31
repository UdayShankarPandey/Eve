# Development Guide

## Prerequisites
- Node.js (v18+)
- npm / Yarn / pnpm
- Rust toolchain (`rustup`, `cargo`)
- Windows 10/11 SDK (for Tauri development on Windows)

## Repository Structure
```text
pixelpal/
├── apps/
│   └── desktop/                 # Tauri + React Application
├── services/                    # Optional Future AI/External Services
│   ├── ai/
│   ├── character-generation/
│   ├── conversation/
│   └── image-processing/
├── assets/                      # Shared assets (Sprites, Sounds, Animations)
├── packages/                    # Shared code/types
│   ├── event-types/
│   └── shared-types/
└── docs/                        # Project documentation
```

## Setup Instructions
1. Clone the repository: `git clone https://github.com/UdayShankarPandey/Eve`
2. Navigate to the desktop app: `cd apps/desktop`
3. Install frontend dependencies: `npm install`
4. Run the development server: `npm run tauri dev`

## Formatting & Linting
- **Frontend**: ESLint and Prettier are configured for the React/TypeScript codebase.
- **Backend (Rust)**: Use `cargo fmt` for formatting and `cargo clippy` for linting.
- Run `npm run lint` within the `apps/desktop` directory (once configured).

## CI/CD
Basic GitHub actions are set up in `.github/workflows/ci.yml` to automatically verify frontend builds, TypeScript types, and Rust compilation/tests on PRs.

## Sprint Workflow
1. **START**: Review goal, architecture, backlog, define acceptance criteria.
2. **BUILD**: Implement smallest working version.
3. **INTEGRATE**: Connect modules, remove hacks.
4. **TEST**: Normal, edge, and failure cases.
5. **POLISH**: UX, code quality, documentation.
6. **CHECKPOINT**: Demo, capture evidence, verify criteria, commit/tag.
