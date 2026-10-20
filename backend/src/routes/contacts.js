"use strict";

const express = require("express");
const { verifyJWT } = require("../middleware/auth");
const controller = require("../controllers/contactController");

const router = express.Router();

const STELLAR_KEY_RE = /^G[A-Z2-7]{55}$/;

function validateContactBody(req, res, next) {
  const { name, publicKey } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim())
    return res.status(400).json({ success: false, error: "name is required" });
  if (!STELLAR_KEY_RE.test(String(publicKey || "")))
    return res.status(400).json({ success: false, error: "publicKey must be a valid Stellar public key" });
  next();
}

router.use(verifyJWT);
router.get("/", controller.list);
router.post("/", validateContactBody, controller.create);
router.delete("/:id", controller.remove);

module.exports = router;
