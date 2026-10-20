"use strict";

/**
 * src/storage/priceAlertsStore.js
 *
 * Persistent storage for price alerts (#1398).
 * Atomic JSON file storage with in-memory Map cache — same pattern as
 * scheduledTransactionStore.js.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "..", "data", "price_alerts.json");
const TMP_FILE = `${DATA_FILE}.tmp`;

/** @type {Map<number, object>} */
const alertsById = new Map();
let lastId = 0;

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const envelope = safeParseJson(raw);
    if (!envelope || typeof envelope !== "object") return;
    if (Array.isArray(envelope.alerts)) {
      for (const alert of envelope.alerts) {
        if (alert && typeof alert.id === "number") {
          alertsById.set(alert.id, alert);
          if (alert.id > lastId) lastId = alert.id;
        }
      }
    }
    if (typeof envelope.lastId === "number") lastId = Math.max(lastId, envelope.lastId);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

function persist() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const envelope = { version: 1, lastId, alerts: [...alertsById.values()] };
  fs.writeFileSync(TMP_FILE, JSON.stringify(envelope), "utf8");
  fs.renameSync(TMP_FILE, DATA_FILE);
}

load();

function nextId() {
  return ++lastId;
}

function add(alert) {
  alertsById.set(alert.id, alert);
  persist();
}

function getByUser(publicKey) {
  return [...alertsById.values()].filter((a) => a.publicKey === publicKey);
}

function getAll() {
  return [...alertsById.values()];
}

function remove(id) {
  const deleted = alertsById.delete(id);
  if (deleted) persist();
  return deleted;
}

function update(id, changes) {
  const alert = alertsById.get(id);
  if (!alert) return null;
  Object.assign(alert, changes);
  persist();
  return alert;
}

module.exports = { nextId, add, getByUser, getAll, remove, update };
