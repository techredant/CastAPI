const express = require("express");
const router = express.Router();
const Status = require("../models/status");
const Comment = require("../models/comment"); // assuming you have this

/* =========================
   📌 CREATE STATUS
========================= */
router.post("/", async (req, res) => {
  try {
    const {
      userId,
      lastName,
      firstName,
      nickname,
      caption,
      media,
      backgroundColor,
    } = req.body;

    const status = await Status.create({
      userId,
      lastName,
      firstName,
      nickname,
      caption,
      media,
      likes: [],
      comments: [],
      backgroundColor
    });

    res.status(201).json(status);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* =========================
   📌 GET ALL STATUSES
========================= */
router.get("/", async (req, res) => {
  try {
    const statuses = await Status.find()
      .sort({ createdAt: -1 })
      .populate("comments");

    res.json(statuses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/:id/view", async (req, res) => {
  try {
    const { userId } = req.body;

    const status = await Status.findById(req.params.id);

    if (!status) {
      return res.status(404).json({ message: "Status not found" });
    }

    const alreadyViewed = status.views.some((v) => v.userId === userId);

    if (!alreadyViewed) {
      status.views.push({ userId });
      await status.save();
    }

    res.json(status);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* =========================
   📌 GET USER STATUSES
========================= */
router.get("/user/:userId", async (req, res) => {
  try {
    const statuses = await Status.find({
      userId: req.params.userId,
    }).sort({ createdAt: -1 });

    res.json(statuses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* =========================
   📌 LIKE / UNLIKE STATUS
========================= */
router.put("/:id/like", async (req, res) => {
  try {
    const { userId } = req.body;

    const status = await Status.findById(req.params.id);

    if (!status) {
      return res.status(404).json({ message: "Status not found" });
    }

    if (status.likes.includes(userId)) {
      // unlike
      status.likes = status.likes.filter((id) => id !== userId);
    } else {
      // like
      status.likes.push(userId);
    }

    await status.save();

    res.json(status);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* =========================
   📌 ADD COMMENT (basic)
========================= */
router.post("/:id/comment", async (req, res) => {
  try {
    const { userId, text } = req.body;

    const comment = await Comment.create({
      userId,
      text,
    });

    const status = await Status.findById(req.params.id);

    if (!status) {
      return res.status(404).json({ message: "Status not found" });
    }

    status.comments.push(comment._id);
    await status.save();

    res.json(comment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* =========================
   📌 DELETE STATUS
========================= */
router.delete("/:id", async (req, res) => {
  try {
    const { userId } = req.body;

    const status = await Status.findById(req.params.id);

    if (!status) {
      return res.status(404).json({ message: "Status not found" });
    }

    if (status.userId !== userId) {
      return res.status(403).json({ message: "Not allowed" });
    }

    await status.deleteOne();

    res.json({ message: "Status deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
