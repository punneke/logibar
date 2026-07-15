import { listen } from "@tauri-apps/api/event";

type BatteryUpdate = {
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

window.addEventListener("DOMContentLoaded", () => {
  listen<BatteryUpdate>("battery-update", (event) => render(event.payload));
});
