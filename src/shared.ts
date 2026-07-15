import { load, Store } from "@tauri-apps/plugin-store";

export type TrackedDevice = {
  device_key: string;
  custom_name: string | null;
};

export type BatteryUpdate = {
  device_key: string;
  device_kind: "keyboard" | "mouse" | "other";
  name: string;
  percentage: number | null;
  charging: boolean;
};

export type DetectedDevice = {
  device_key: string;
  name: string;
  kind: "keyboard" | "mouse" | "other";
  percentage: number | null;
  charging: boolean;
};

const STORE_FILE = "logibar.json";
const TRACKED_KEY = "tracked";

let cached: Store | null = null;

export async function getStore(): Promise<Store> {
  if (!cached) {
    cached = await load(STORE_FILE, { autoSave: true });
  }
  return cached;
}

export async function loadTracked(): Promise<TrackedDevice[]> {
  const store = await getStore();
  return (await store.get<TrackedDevice[]>(TRACKED_KEY)) ?? [];
}

export async function saveTracked(list: TrackedDevice[]): Promise<void> {
  const store = await getStore();
  await store.set(TRACKED_KEY, list);
  await store.save();
}

export function escapeHtml(str: string): string {
  return str.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}
