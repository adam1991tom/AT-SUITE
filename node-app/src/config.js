// This laptop's settings: which AT-SUITE server it belongs to, its node token
// (encrypted with Windows DPAPI via safeStorage) and whether pop-ups are on.
// IT can pre-set the server and enrolment code for a silent roll-out in
// %ProgramData%\AT-SUITE\node.json: {"server": "http://10.100.70.101:8180", "enrol_code": "ABCD-1234-EF56"}
// (%ProgramData%\AT-SUIT\node.json, the folder's old name, still works).
// This laptop's own settings are in %APPDATA%\AT-SUIT Node\node.json; it is fine for that file
// to be missing (a new install, or deleted by hand): the app then opens the set-up window.
const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");

// overlay: the last overlay settings ({ on, url, position, size, display,
// opacity, room_id }); an overlay left on comes back when the app starts.
// update_on_launch: when the app starts and finds a newer version on the server, it installs it
// and restarts straight away (before the day's work), instead of waiting for the app to close.
// screens: this laptop feeds its room's caption and timer screens itself (bubble.js).
const DEFAULTS = { server: "", name: "", token_enc: "", token_plain: "", popups: false, overlay: null, update_on_launch: true, screens: false };

function file() {
  return path.join(app.getPath("userData"), "node.json");
}

function presetFiles() {
  if (process.env.ATSUIT_NODE_PRESET) return [process.env.ATSUIT_NODE_PRESET];
  const base = process.env.ProgramData || "C:\\ProgramData";
  // The console and the guide say AT-SUITE; the first laptops were set up with AT-SUIT.
  return [path.join(base, "AT-SUITE", "node.json"), path.join(base, "AT-SUIT", "node.json")];
}

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { return null; }
}

function load() {
  const saved = readJson(file());
  return { ...DEFAULTS, ...(saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {}) };
}

function save(conf) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(conf, null, 2));
  fs.renameSync(tmp, file());
}

function preset() {
  const p = presetFiles().map(readJson).find((j) => j && typeof j === "object") || {};
  return { server: normServer(p.server || ""), enrol_code: String(p.enrol_code || "").trim().toUpperCase(), name: String(p.name || "") };
}

function normServer(s) {
  s = String(s || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch (_) {
    return "";
  }
}

function getToken(conf) {
  if (conf.token_enc && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(conf.token_enc, "base64")); } catch (_) { return ""; }
  }
  return conf.token_plain || "";
}

function setToken(conf, token) {
  if (safeStorage.isEncryptionAvailable()) {
    conf.token_enc = safeStorage.encryptString(token).toString("base64");
    conf.token_plain = "";
  } else {
    conf.token_plain = token;
    conf.token_enc = "";
  }
}

module.exports = { load, save, preset, normServer, getToken, setToken };
