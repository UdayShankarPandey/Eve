# Privacy Specification

PixelPal is built with a **local-first** philosophy. Privacy must be designed into the architecture from the beginning.

## Core Principle
"If the application does not need a piece of information to perform a feature, it should not collect or transmit that information."

## Privacy Boundaries
- **Routine monitoring** remains strictly local.
- **AI features** should only receive information when:
  1. The feature specifically requires it.
  2. The user has explicitly permitted the relevant context.

## Event Awareness vs. Content Access
PixelPal distinguishes between knowing *that* an event happened and knowing the *contents* of that event.
- **Example**: Knowing that a notification appeared is different from reading private email contents.
- **MVP Constraint**: Email content and sensitive content parsing must NOT be part of the MVP.

## Permission Categories
Users will have explicit control over what PixelPal can monitor. Future categories will include:
- **System** (Battery, Idle, Power state)
- **Applications** (Currently focused window)
- **Files** (Restricted to user-selected paths only)
- **Notifications** (Awareness vs Content)
- **Screen Time**
- **AI Context** (What is sent to remote LLMs/Generators)

## Data Deletion & Management
Users must have the capability to view and delete all local character, event, and conversation data stored in the local SQLite database.
