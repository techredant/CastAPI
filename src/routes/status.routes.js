const express = require("express");
const router = express.Router();
const Status = require("../models/status");
const User = require("../models/user");
const Comment = require("../models/comment");

function pickProfile(user, statusDoc) {
  const s = statusDoc?.toObject?.() ?? statusDoc ?? {};
  return {
    firstName: s.firstName || user?.firstName || "",
    lastName: s.lastName || user?.lastName || "",
    companyName: s.companyName || user?.companyName || "",
    nickName: s.nickName || user?.nickName || "",
    image: s.image || user?.image || "",
  };
}

async function enrichStatuses(statuses) {
  const list = statuses.map((s) => (s.toObject ? s.toObject() : s));
  const userIds = [...new Set(list.map((s) => String(s.userId)).filter(Boolean))];
  const users = await User.find({ clerkId: { $in: userIds } });
  const byClerk = Object.fromEntries(users.map((u) => [String(u.clerkId), u]));

  return list.map((s) => ({
    ...s,
    ...pickProfile(byClerk[String(s.userId)], s),
  }));
}

/* =========================
   📌 CREATE STATUS
========================= */
router.post("/", async (req, res) => {
  try {
    const {
      userId,
      lastName,
      firstName,
      companyName,
      nickName,
      nickname,
      image,
      caption,
      media,
      backgroundColor,
    } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "userId required" });
    }

    const dbUser = await User.findOne({ clerkId: userId });
    const profile = pickProfile(dbUser, {
      firstName,
      lastName,
      companyName,
      nickName: nickName || nickname,
      image,
    });

    const status = await Status.create({
      userId,
      ...profile,
      caption,
      media,
      likes: [],
      comments: [],
      backgroundColor,
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

    res.json(await enrichStatuses(statuses));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/:id/view", async (req, res) => {
  try {
    const { userId, firstName, companyName, nickName, lastName, image } =
      req.body;

    if (!userId) {
      return res.status(400).json({ message: "userId required" });
    }

    const status = await Status.findById(req.params.id);
    if (!status) return res.status(404).json({ message: "Not found" });

    const viewerId = String(userId);
    const authorId = String(status.userId);

    const alreadyViewed = status.views.some(
      (v) => String(v.userId) === viewerId,
    );

    if (!alreadyViewed && authorId !== viewerId) {
      status.views.push({
        userId: viewerId,
        firstName: firstName || "",
        companyName: companyName || "",
        nickName: nickName || "",
        lastName: lastName || "",
        image: image || "",
      });
      await status.save();
    }

    const [enriched] = await enrichStatuses([status]);
    res.json(enriched);
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

    res.json(await enrichStatuses(statuses));
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

    if (!userId) {
      return res.status(400).json({ message: "userId required" });
    }

    const status = await Status.findById(req.params.id);
    if (!status) return res.status(404).json({ message: "Not found" });

    const update = status.likes.includes(userId)
      ? { $pull: { likes: userId } }
      : { $addToSet: { likes: userId } };

    const updated = await Status.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });

    res.json(updated);
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
    if (!userId) {
      return res.status(400).json({ message: "userId required" });
    }
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
    if (!userId) {
      return res.status(400).json({ message: "userId required" });
    }
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
