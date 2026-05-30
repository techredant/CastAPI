const express = require("express");
const { hybridSearch } = require("../ai/search/hybrid");
const { answerSearch } = require("../ai/search/answer");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    if (!query) return res.status(400).json({ message: "q is required" });
    const results = await hybridSearch({
      query,
      type: req.query.type || "auto",
      county: req.query.county,
      limit: Number(req.query.limit) || 10,
      userId: req.query.userId,
    });

    if (req.query.mode === "answer") {
      const answer = await answerSearch({
        query,
        results,
        userId: req.query.userId,
      });
      return res.json({ results, ...answer });
    }

    return res.json({ results });
  } catch (error) {
    console.error("AI search failed:", error);
    return res.status(500).json({ message: "AI search failed" });
  }
});

module.exports = router;
