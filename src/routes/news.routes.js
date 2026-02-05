const express = require("express");
const router = express.Router();
const newsController = require("../controllers/newsController");

// GET all news
router.get("/", newsController.getAllNews);

// POST new article
router.post("/", newsController.createNews);

module.exports = router;
