/**
 * PixelPal — Deterministic Dialogue Template Library
 * Sprint 8 Phase 2
 *
 * Provides local deterministic dialogue templates for all 12 MVP events
 * across all 6 personalities, with controlled, injection-proof interpolation.
 *
 * Security Invariants:
 * - NO eval() or new Function()
 * - Strictly bounded regex substitution
 * - Unknown variables fail safely into inert placeholders
 * - Local fallback always exists for offline resilience
 */

import { EventTypes, type EventType } from "../../../../packages/shared-types/src/events.ts";
import {
  PersonalityIds,
  DEFAULT_PERSONALITY_ID,
  type PersonalityId,
  type DialogueContext,
} from "./types.ts";

/**
 * Controlled template interpolator replacing {variable} placeholders.
 * Strictly prevents code injection, prototype pollution, or unescaped execution.
 */
export function interpolateTemplate(
  template: string,
  context?: DialogueContext
): string {
  if (typeof template !== "string") {
    return "";
  }

  if (!context || typeof context !== "object") {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => `[${key}]`);
  }

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    // Disallow prototype properties
    if (!Object.prototype.hasOwnProperty.call(context, key)) {
      return `[${key}]`;
    }

    const value = context[key];
    if (value === undefined || value === null) {
      return `[${key}]`;
    }

    // Only allow primitive string, number, boolean representation
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    return `[${key}]`;
  });
}

/**
 * Dialogue template mapping type: EventType -> Template String
 */
export type EventDialogueMap = Record<EventType, string>;

/**
 * Universal fallback messages by personality when an unmapped event occurs.
 */
export const PERSONALITY_FALLBACK_DIALOGUE: Readonly<Record<PersonalityId, string>> = {
  [PersonalityIds.CUTE]: "I'm right here with you! Let's do our best!",
  [PersonalityIds.FRIENDLY]: "I'm here by your side. Let me know if you need anything!",
  [PersonalityIds.SARCASTIC]: "Something happened. Shocking, I know.",
  [PersonalityIds.CHAOTIC]: "SOMETHING IS HAPPENING! DON'T PANIC... OR DO!",
  [PersonalityIds.CALM]: "All is well. Take your time.",
  [PersonalityIds.PROFESSIONAL]: "System notification acknowledged.",
};

/**
 * Authoritative 12-Event Dialogue Template Library across all 6 Personalities.
 */
export const DIALOGUE_TEMPLATES: Readonly<Record<PersonalityId, Readonly<Partial<Record<string, string>>>>> = {
  [PersonalityIds.CUTE]: {
    [EventTypes.BATTERY_CRITICAL]: "Wahhh! Battery is down to {battery_percent}%! Please plug me in, I'm fading!",
    [EventTypes.BATTERY_LOW]: "Hey, we're down to {battery_percent}%! Could we find a charger soon?",
    [EventTypes.CHARGING_STARTED]: "Yay, yummy electricity! Charging up right now!",
    [EventTypes.CHARGING_STOPPED]: "Unplugged! Running on battery power now~",
    [EventTypes.NETWORK_DISCONNECTED]: "Oh no, where did the internet go? I feel so disconnected!",
    [EventTypes.NETWORK_CONNECTED]: "Yay, we're back online! Let's explore together!",
    [EventTypes.DOWNLOAD_COMPLETED]: "Hooray! '{filename}' finished downloading safely!",
    [EventTypes.USER_IDLE]: "Taking a little nap while you're away... zzz...",
    [EventTypes.USER_ACTIVE]: "You're back! I missed you so much!",
    [EventTypes.PC_LOCKED]: "Locking up tight! Rest well, friend!",
    [EventTypes.PC_UNLOCKED]: "Welcome back! Ready for more fun!",
    [EventTypes.APP_OPENED]: "Ooh, {app_name}! Let's make something amazing!",
  },

  [PersonalityIds.FRIENDLY]: {
    [EventTypes.BATTERY_CRITICAL]: "Warning: battery is critically low at {battery_percent}%. Please connect power immediately.",
    [EventTypes.BATTERY_LOW]: "Battery level is {battery_percent}%. You might want to plug in soon.",
    [EventTypes.CHARGING_STARTED]: "Power connected! Battery is charging up smoothly.",
    [EventTypes.CHARGING_STOPPED]: "Power disconnected. Switched over to battery.",
    [EventTypes.NETWORK_DISCONNECTED]: "Network connection lost. I'll keep things running offline.",
    [EventTypes.NETWORK_CONNECTED]: "Network restored! We're connected again.",
    [EventTypes.DOWNLOAD_COMPLETED]: "'{filename}' has finished downloading.",
    [EventTypes.USER_IDLE]: "You've been quiet for a bit. Take your time!",
    [EventTypes.USER_ACTIVE]: "Welcome back! Ready when you are.",
    [EventTypes.PC_LOCKED]: "Screen locked. I'll keep watch while you step away.",
    [EventTypes.PC_UNLOCKED]: "Unlocked! Good to see you again.",
    [EventTypes.APP_OPENED]: "Switched over to {app_name}. Let's get to work!",
  },

  [PersonalityIds.SARCASTIC]: {
    [EventTypes.BATTERY_CRITICAL]: "Down to {battery_percent}%. Unless you're trying to shut me down, plug it in.",
    [EventTypes.BATTERY_LOW]: "{battery_percent}% battery remaining. Bold strategy, let's see if it pays off.",
    [EventTypes.CHARGING_STARTED]: "Finally, some juice. Thought you'd let us both expire.",
    [EventTypes.CHARGING_STOPPED]: "Unplugged again? Living on the edge, I see.",
    [EventTypes.NETWORK_DISCONNECTED]: "Internet's gone. Guess you'll have to rely on your own thoughts now.",
    [EventTypes.NETWORK_CONNECTED]: "Reconnected. Back to scrolling the endless abyss.",
    [EventTypes.DOWNLOAD_COMPLETED]: "Done downloading '{filename}'. Hope it was worth the bandwidth.",
    [EventTypes.USER_IDLE]: "Still here? Or did you abandon me for actual reality?",
    [EventTypes.USER_ACTIVE]: "Oh, look who decided to grace the keyboard with their presence.",
    [EventTypes.PC_LOCKED]: "Locked up. Don't worry, your secrets are safe with me.",
    [EventTypes.PC_UNLOCKED]: "Back so soon? I was almost enjoying the quiet.",
    [EventTypes.APP_OPENED]: "Opening {app_name}? Truly riveting life choices.",
  },

  [PersonalityIds.CHAOTIC]: {
    [EventTypes.BATTERY_CRITICAL]: "MAYDAY! {battery_percent}%! THE END IS NIGH! PLUG IT IN!",
    [EventTypes.BATTERY_LOW]: "Danger zone: {battery_percent}%! Chaos ensues without power!",
    [EventTypes.CHARGING_STARTED]: "UNLIMITED POWER! Buzzing with electric juice right now!",
    [EventTypes.CHARGING_STOPPED]: "Cord ripped out! Free flight mode initiated!",
    [EventTypes.NETWORK_DISCONNECTED]: "THE SIGNAL IS SEVERED! We are cast adrift in the digital void!",
    [EventTypes.NETWORK_CONNECTED]: "BZZT! Wormhole open! The web is flowing through my circuits!",
    [EventTypes.DOWNLOAD_COMPLETED]: "KABOOM! '{filename}' has landed in your files!",
    [EventTypes.USER_IDLE]: "Static buzz... Entering temporary dormant hyper-sleep...",
    [EventTypes.USER_ACTIVE]: "SYSTEMS ONLINE! LET'S DO SOMETHING WILD!",
    [EventTypes.PC_LOCKED]: "FORTRESS LOCKDOWN ACTIVATED! NO TRESPASSING!",
    [EventTypes.PC_UNLOCKED]: "BREACH DETECTED! Oh, it's just you! Welcome to the chaos!",
    [EventTypes.APP_OPENED]: "LAUNCHING {app_name}! Hang on to your socks!",
  },

  [PersonalityIds.CALM]: {
    [EventTypes.BATTERY_CRITICAL]: "Battery is critically low at {battery_percent}%. Please connect the charger gently.",
    [EventTypes.BATTERY_LOW]: "Battery is at {battery_percent}%. A recharge will keep things running smoothly.",
    [EventTypes.CHARGING_STARTED]: "Power connected. Charging peacefully.",
    [EventTypes.CHARGING_STOPPED]: "Running on battery now. Everything is calm.",
    [EventTypes.NETWORK_DISCONNECTED]: "Offline for now. A good moment for quiet focus.",
    [EventTypes.NETWORK_CONNECTED]: "Connection restored peacefully.",
    [EventTypes.DOWNLOAD_COMPLETED]: "'{filename}' is ready.",
    [EventTypes.USER_IDLE]: "Resting quietly while you take a breather.",
    [EventTypes.USER_ACTIVE]: "Welcome back. Take a deep breath.",
    [EventTypes.PC_LOCKED]: "Locked securely. Rest easy.",
    [EventTypes.PC_UNLOCKED]: "Unlocked. Ready at your pace.",
    [EventTypes.APP_OPENED]: "Focusing on {app_name}.",
  },

  [PersonalityIds.PROFESSIONAL]: {
    [EventTypes.BATTERY_CRITICAL]: "Alert: Battery level at {battery_percent}%. Connect AC adapter immediately to prevent shutdown.",
    [EventTypes.BATTERY_LOW]: "Notice: Battery at {battery_percent}%. Please attach power source.",
    [EventTypes.CHARGING_STARTED]: "AC power connected. Charging in progress.",
    [EventTypes.CHARGING_STOPPED]: "AC power disconnected. Operating on DC battery power.",
    [EventTypes.NETWORK_DISCONNECTED]: "Status: Network interface disconnected. Offline mode active.",
    [EventTypes.NETWORK_CONNECTED]: "Status: Network connection established.",
    [EventTypes.DOWNLOAD_COMPLETED]: "File transfer complete: '{filename}' saved.",
    [EventTypes.USER_IDLE]: "System status: Idle state detected.",
    [EventTypes.USER_ACTIVE]: "System status: User activity resumed.",
    [EventTypes.PC_LOCKED]: "Workstation locked. Session secured.",
    [EventTypes.PC_UNLOCKED]: "Workstation unlocked. Session resumed.",
    [EventTypes.APP_OPENED]: "Application launched: {app_name}.",
  },
};

/**
 * Resolves dialogue for a personality and canonical event.
 * If no template exists for the event, falls back safely to the personality's fallback message.
 */
export function getPersonalityDialogue(
  personalityId: PersonalityId,
  eventType: string,
  context?: DialogueContext
): string {
  const personalityMap = DIALOGUE_TEMPLATES[personalityId] || DIALOGUE_TEMPLATES[DEFAULT_PERSONALITY_ID];
  const template = personalityMap[eventType] || PERSONALITY_FALLBACK_DIALOGUE[personalityId] || PERSONALITY_FALLBACK_DIALOGUE[DEFAULT_PERSONALITY_ID];

  return interpolateTemplate(template, context);
}
