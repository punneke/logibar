import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";

type BatteryUpdate = {
  device_key: string;
  device_kind: "keyboard" | "mouse" | "other";
  name: string;
  percentage: number | null;
  charging: boolean;
};

function render(update: BatteryUpdate) {
  const selector =
    update.device_kind === "keyboard"
      ? "#device-keyboard"
      : update.device_kind === "mouse"
      ? "#device-mouse"
      : null;
  if (!selector) return;

  const el = document.querySelector(selector);
  if (!el) return;

  const pctEl = el.querySelector(".pct");
  const labelEl = el.querySelector(".label");
  if (!pctEl || !labelEl) return;

  labelEl.textContent = update.name;
  if (update.percentage == null) {
    pctEl.textContent = "--%";
    pctEl.classList.remove("low");
  } else {
    pctEl.textContent = `${update.percentage}%${update.charging ? " ⚡" : ""}`;
    pctEl.classList.toggle("low", update.percentage <= 20);
  }
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
      // TODO: opens settings window in the next commit.
      console.log("manage devices — not implemented yet");
      break;
    case "quit":
      await getCurrentWindow().close();
      break;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  listen<BatteryUpdate>("battery-update", (event) => render(event.payload));

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
});
