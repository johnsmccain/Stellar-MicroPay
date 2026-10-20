"use strict";

/**
 * src/storage/webhookStore.js
 *
 * Persistent storage for webhook registrations (#1399).
 * Atomic JSON file storage with in-memory Map cache.
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "..", "data", "webhooks.json");
const TMP_FILE = `${DATA_FILE}.tmp`;

/** @type {Map<string, object>} */
const webhooksById = new Map();

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
    if (!envelope || !Array.isArray(envelope.webhooks)) return;
    for (const wh of envelope.webhooks) {
      if (wh && typeof wh.id === "string") {
        webhooksById.set(wh.id, wh);
      }
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

function persist() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const envelope = { version: 1, webhooks: [...webhooksById.values()] };
  fs.writeFileSync(TMP_FILE, JSON.stringify(envelope), "utf8");
  fs.renameSync(TMP_FILE, DATA_FILE);
}

load();

function set(id, webhook) {
  webhooksById.set(id, webhook);
  persist();
}

function get(id) {
  return webhooksById.get(id) ?? null;
}

function remove(id) {
  const deleted = webhooksById.delete(id);
  if (deleted) persist();
  return deleted;
}

function getAll() {
  return [...webhooksById.values()];
}

module.exports = { set, get, remove, getAll };
