// In-memory stand-in for the Rust display settings commands in tests.
let stored: unknown;

export const settingsStore = {
  get: (): unknown => structuredClone(stored),
  set: (value: unknown) => { stored = structuredClone(value); },
  clear: () => { stored = undefined; },
};
