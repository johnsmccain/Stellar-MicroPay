"use strict";

const pino = require("pino");
const { getConfig } = require("./config/env");

const logger = pino({
  level: getConfig().logLevel,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
