const express = require("express");
const { handleStkCallback } = require("../services/mpesaCallback.service");
const { verifyMpesaCredentials } = require("../../services/mpesa.service");

module.exports = (io) => {
  const router = express.Router();

  /** GET /api/mpesa/status — OAuth health (no secrets returned) */
  router.get("/status", async (_req, res) => {
    const status = await verifyMpesaCredentials();
    res.status(status.ok ? 200 : 503).json(status);
  });

  /** POST /api/mpesa/callback — unified STK callback (Daraja Lipa Na M-Pesa) */
  router.post("/callback", async (req, res) => {
    try {
      await handleStkCallback(req.body, io);
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    } catch (err) {
      console.error("mpesa unified callback:", err);
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }
  });

  return router;
};
