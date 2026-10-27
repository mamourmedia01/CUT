// Cut Log widget for Scriptable (free on the App Store). Works on the Lock Screen
// (circular, rectangular, inline) and the Home Screen (small, medium).
// Cut Log → Settings → Lock-screen widget fills in your link and copies the whole script.
const LINK = "__LINK__";
const AUTH = "__AUTH__";

const ORANGE = new Color("#ff6b35"), GREEN = new Color("#22c55e"), AMBER = new Color("#fbbf24"), RED = new Color("#ef4444"), GREY = new Color("#9a9a9a");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const nice = id => { if (!id) return "–"; const d = new Date(id + "T12:00:00"); return WD[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()]; };
const recColor = r => r == null ? GREY : r >= 67 ? GREEN : r >= 34 ? AMBER : RED;

let d = null;
try {
  const req = new Request(LINK); req.headers = { Authorization: AUTH }; req.timeoutInterval = 15;
  d = await req.loadJSON();
  Keychain.set("cutlog-widget", JSON.stringify(d));   // last good copy for when you're offline
} catch (e) {
  try { d = JSON.parse(Keychain.get("cutlog-widget")); } catch (e2) { d = null; }
}

const fam = config.widgetFamily || "medium";
const w = new ListWidget();
w.url = "https://mamourmedia01.github.io/CUT/#home";
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

function txt(stack, s, size, opts = {}) {
  const t = stack.addText(String(s));
  t.font = opts.bold ? Font.heavySystemFont(size) : opts.med ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  if (opts.color) t.textColor = opts.color;
  if (opts.center) t.centerAlignText();
  t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  return t;
}

if (!d || d.error) {
  txt(w, "Cut Log", 13, { bold: true });
  txt(w, d && d.error ? "Link not valid: copy it again in Settings" : "No data yet", 11);
} else if (fam === "accessoryCircular") {
  // recovery % in the middle, or the streak before the watch has synced
  w.addAccessoryWidgetBackground = true;
  const v = d.recovery != null ? d.recovery : d.streak;
  txt(w, v, 20, { bold: true, center: true });
  txt(w, d.recovery != null ? "REC" : "DAYS", 9, { med: true, center: true });
} else if (fam === "accessoryRectangular") {
  txt(w, "CUT LOG · DAY " + d.day, 11, { bold: true });
  txt(w, d.streak + "-day streak · " + (d.recovery != null ? d.recovery + "% rec" : "rec –"), 12, { med: true });
  txt(w, d.weight + " kg → " + d.weekTarget + " kg by " + nice(d.weekBy || d.weekEnd).split(" ")[0], 12);
  txt(w, d.protein ? "Protein day today" : "Next shake " + nice(d.nextShake), 11);
} else if (fam === "accessoryInline") {
  txt(w, "Day " + d.day + " · " + d.streak + "d streak · " + (d.protein ? "shake today" : "shake " + nice(d.nextShake).split(" ")[0]), 12);
} else {
  w.backgroundColor = new Color("#0b0b0b");
  w.setPadding(14, 14, 14, 14);
  const top = w.addStack(); top.centerAlignContent();
  txt(top, "CUT LOG", 12, { bold: true, color: ORANGE }); top.addSpacer();
  txt(top, "DAY " + d.day, 12, { bold: true, color: GREY });
  if (d.name && fam !== "small") { w.addSpacer(2); txt(w, d.name, 11, { color: GREY }); }
  w.addSpacer(6);
  const row = w.addStack(); row.bottomAlignContent();
  const a = row.addStack(); a.layoutVertically();
  txt(a, d.streak, 34, { bold: true, color: Color.white() }); txt(a, "day streak", 10, { color: GREY });
  row.addSpacer(14);
  const b = row.addStack(); b.layoutVertically();
  txt(b, d.recovery != null ? d.recovery + "%" : "–", 34, { bold: true, color: recColor(d.recovery) }); txt(b, "recovery", 10, { color: GREY });
  if (fam !== "small") {
    row.addSpacer(14);
    const c = row.addStack(); c.layoutVertically();
    txt(c, d.weight, 34, { bold: true, color: Color.white() }); txt(c, "kg this morning", 10, { color: GREY });
  }
  w.addSpacer();
  txt(w, d.protein ? "Protein day: " + (d.shake || "shake") : "Next shake " + nice(d.nextShake), 11, { med: true, color: d.protein ? AMBER : Color.white() });
  txt(w, "Sunday ≈ " + d.weekTarget + " kg · " + d.toGo + " kg to " + d.goal, 11, { color: GREY });
}

Script.setWidget(w);
if (config.runsInApp) await w.presentMedium();
Script.complete();
