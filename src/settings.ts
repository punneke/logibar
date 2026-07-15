import { listen, emit } from "@tauri-apps/api/event";

import {
  DetectedDevice,
  TrackedDevice,
  loadTracked,
  saveTracked,
  escapeHtml,
} from "./shared";

const detected = new Map<string, DetectedDevice>();
let tracked: TrackedDevice[] = [];

function renderTracked() {
  const list = document.getElementById("tracked-list")!;
  const empty = document.getElementById("empty-tracked")!;
  if (tracked.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  list.innerHTML = tracked
    .map((t) => {
      const d = detected.get(t.device_key);
      const defaultName = d?.name ?? "(not currently connected)";
      const pctBadge =
        d?.percentage != null
          ? `${d.percentage}%${d.charging ? " ⚡" : ""}`
          : "—";
      const value = t.custom_name ?? "";
      return `
        <div class="tracked-row" data-key="${escapeHtml(t.device_key)}">
          <input
            type="text"
            class="name-input"
            value="${escapeHtml(value)}"
            placeholder="${escapeHtml(defaultName)}"
          />
          <span class="pct-badge">${escapeHtml(pctBadge)}</span>
          <button class="icon-btn reset" title="Reset custom name">↺</button>
          <button class="icon-btn remove" title="Remove from widget">×</button>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll<HTMLElement>(".tracked-row").forEach((row) => {
    const key = row.dataset.key!;
    const input = row.querySelector<HTMLInputElement>(".name-input")!;
    input.addEventListener("input", () => {
      updateTracked(key, (t) => {
        t.custom_name = input.value.trim() || null;
      });
    });
    row.querySelector(".reset")!.addEventListener("click", () => {
      updateTracked(key, (t) => {
        t.custom_name = null;
      });
      input.value = "";
    });
    row.querySelector(".remove")!.addEventListener("click", () => {
      tracked = tracked.filter((t) => t.device_key !== key);
      void persist();
      renderTracked();
      renderAdd();
    });
  });
}

function renderAdd() {
  const select = document.getElementById("add-select") as HTMLSelectElement;
  const btn = document.getElementById("add-btn") as HTMLButtonElement;
  const hint = document.getElementById("add-hint")!;

  const trackedKeys = new Set(tracked.map((t) => t.device_key));
  const available = Array.from(detected.values()).filter(
    (d) => !trackedKeys.has(d.device_key),
  );

  select.innerHTML =
    `<option value="">Select a detected device…</option>` +
    available
      .map(
        (d) =>
          `<option value="${escapeHtml(d.device_key)}">${escapeHtml(d.name)} (${escapeHtml(d.device_key)})</option>`,
      )
      .join("");

  const nothingLeft = available.length === 0;
  select.disabled = nothingLeft;
  btn.disabled = true;

  if (detected.size === 0) {
    hint.textContent = "Waiting for battery updates… make sure your devices are turned on.";
  } else if (nothingLeft) {
    hint.textContent = "All detected devices are already tracked.";
  } else {
    hint.textContent = "";
  }
}

function updateTracked(key: string, mutate: (t: TrackedDevice) => void) {
  const t = tracked.find((x) => x.device_key === key);
  if (!t) return;
  mutate(t);
  void persist();
}

async function persist() {
  await saveTracked(tracked);
  await emit("tracked-changed");
}

async function init() {
  tracked = await loadTracked();

  // Listen first, THEN ask the widget to broadcast its cached list — otherwise
  // the widget's reply can race in before our listener is registered.
  await listen<DetectedDevice[]>("detected-changed", (event) => {
    detected.clear();
    for (const d of event.payload) detected.set(d.device_key, d);
    renderTracked();
    renderAdd();
  });
  await emit("request-detected");

  renderTracked();
  renderAdd();

  const select = document.getElementById("add-select") as HTMLSelectElement;
  const btn = document.getElementById("add-btn") as HTMLButtonElement;

  select.addEventListener("change", () => {
    btn.disabled = !select.value;
  });

  btn.addEventListener("click", () => {
    const key = select.value;
    if (!key) return;
    if (tracked.some((t) => t.device_key === key)) return;
    tracked.push({ device_key: key, custom_name: null });
    void persist();
    renderTracked();
    renderAdd();
  });
}

window.addEventListener("DOMContentLoaded", () => {
  void init();
});
