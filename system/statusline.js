#!/usr/bin/env node
let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }

  const get = (obj, path) =>
    path.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);

  const pct = (path) => {
    const v = get(data, path);
    return typeof v === "number" ? `${Math.round(v)}%` : "N/A";
  };

  const model = get(data, "model.display_name") || "?";
  let ctx = pct("context_window.used_percentage");
  try {
    const { contextTokens, WARN, CRIT } = require("./hooks/ctx-lib");
    const t = contextTokens(data.transcript_path);
    if (t != null) {
      const color = t >= CRIT ? "\x1b[31m" : t >= WARN ? "\x1b[33m" : "";
      ctx = `${color}${Math.round(t / 1000)}k (${ctx})${color ? "\x1b[0m" : ""}`;
    }
  } catch {}
  const costVal = get(data, "cost.total_cost_usd");
  const cost = typeof costVal === "number" ? `$${costVal.toFixed(2)}` : "$0.00";
  const fiveHour = pct("rate_limits.five_hour.used_percentage");
  const sevenDay = pct("rate_limits.seven_day.used_percentage");

  // Снимок лимитов для хука limit-guard: хуки rate_limits не получают
  try {
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "state");
    fs.mkdirSync(dir, { recursive: true });
    const rl = data.rate_limits;
    const win = (w, label) =>
      w && typeof w.used_percentage === "number"
        ? { label, pct: w.used_percentage, resets_at: w.resets_at ? w.resets_at * 1000 : null }
        : null;
    if (rl) {
      const week = win(rl.seven_day, "Weekly");
      fs.writeFileSync(
        path.join(dir, "rate-limits.json"),
        JSON.stringify({
          ts: Date.now(),
          source: "statusline",
          status: "ok",
          five_hour: win(rl.five_hour, "5-hour"),
          weekly: week ? [week] : [],
        })
      );
    }
  } catch {}

  process.stdout.write(
    `${model} | Ctx ${ctx} | ${cost} | 5h ${fiveHour} | 7d ${sevenDay}`
  );
});
