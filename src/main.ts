import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";

import {
  BatteryUpdate,
  DetectedDevice,
  TrackedDevice,
  loadTracked,
  escapeHtml,
} from "./shared";

const detected = new Map<string, DetectedDevice>();
let tracked: TrackedDevice[] = [];

function render() {
  const widget = document.getElementById("widget")!;
  if (tracked.length === 0) {
    widget.innerHTML = `<div class="empty">No devices tracked.<br><span class="hint">Right-click for options.</span></div>`;
    return;
  }
  widget.innerHTML = tracked
    .map((t) => {
      const d = detected.get(t.device_key);
      const name = t.custom_name ?? d?.name ?? t.device_key;
      const pct = d?.percentage;
      const low = pct != null && pct <= 20 ? " low" : "";
      const bolt = d?.charging ? " ⚡" : "";
      const pctText = pct != null ? `${pct}%${bolt}` : "--%";
      return `
        <div class="device" data-key="${escapeHtml(t.device_key)}">
          <span class="label">${escapeHtml(name)}</span>
          <span class="pct${low}">${pctText}</span>
        </div>
      `;
    })
    .join("");
}

async function refreshAutostartCheck() {
  const check = document.querySelector<HTMLSpanElement>(
    '.menu-item[data-action="toggle-autostart"] .menu-check',
  );
  if (!check) return;
  try {
    check.textContent = (await isEnabled()) ? "☑" : "☐";
  } catch (err) {
    console.warn("isEnabled failed", err);
  }
}

function positionMenu(menu: HTMLElement, x: number, y: number) {
  menu.classList.remove("hidden");
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  menu.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, maxY))}px`;
}

function hideMenu() {
  document.getElementById("context-menu")?.classList.add("hidden");
}

async function openSettings() {
  try {
    await invoke("open_settings");
  } catch (err) {
    console.error("open_settings failed:", err);
  }
}

async function handleMenuClick(action: string) {
  hideMenu();
  switch (action) {
    case "toggle-autostart":
      try {
        if (await isEnabled()) {
          await disable();
        } else {
          await enable();
        }
        await refreshAutostartCheck();
      } catch (err) {
        console.warn("autostart toggle failed", err);
      }
      break;
    case "manage-devices":
      await openSettings();
      break;
    case "quit":
      await getCurrentWindow().close();
      break;
  }
}

async function init() {
  tracked = await loadTracked();
  render();

  await listen<BatteryUpdate>("battery-update", (event) => {
    const u = event.payload;
    detected.set(u.device_key, {
      device_key: u.device_key,
      name: u.name,
      kind: u.device_kind,
      percentage: u.percentage,
      charging: u.charging,
    });
    // Rebroadcast to any settings window that's open.
    void emit("detected-changed", Array.from(detected.values()));
    render();
  });

  await listen("tracked-changed", async () => {
    tracked = await loadTracked();
    render();
  });

  // Answer "give me the current detected list" requests from other windows.
  await listen("request-detected", () => {
    void emit("detected-changed", Array.from(detected.values()));
  });

  const menu = document.getElementById("context-menu")!;

  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    void refreshAutostartCheck();
    positionMenu(menu, e.clientX, e.clientY);
  });

  document.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".menu-item");
    if (item && menu.contains(item)) {
      const action = item.dataset.action;
      if (action) void handleMenuClick(action);
      return;
    }
    if (!menu.classList.contains("hidden")) hideMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideMenu();
  });
}

window.addEventListener("DOMContentLoaded", () => {
  void init();
});
