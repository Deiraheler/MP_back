/**
 * Generate a unique id for copilot messages/instructions.
 * Prefer crypto.randomUUID() if available; else fallback.
 */
export function generateCopilotId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
