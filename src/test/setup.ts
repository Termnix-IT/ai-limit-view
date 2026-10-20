import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

const stored = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({
    get: async (key: string) => stored.get(key),
    set: async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); },
    save: async () => {},
  }),
}));
beforeEach(() => stored.clear());
