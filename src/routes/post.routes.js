const express = require("express");
const mongoose = require("mongoose");
const Post = require("../models/post");
const Comment = require("../models/comment");
const User = require("../models/user");
const InteractionLog = require("../models/interactionLog");
const moderationGate = require("../middleware/moderationGate");
const { queues } = require("../workers/queue");
const {
  getRoomName,
  getBroadcastRoomsForPost,
} = require("../utils/feedRooms");
const { getRelatedLevels } = require("../utils/feedLevels");
const {
  isNonPersonalAccount,
  isNewsFeedPost,
} = require("../utils/accountType");

module.exports = (io) => {
  const router = express.Router();
  const { notify } = require("../services/notificationEngine.service");

  const broadcastToFeedRooms = (post, eventName, payload) => {
    const rooms = getBroadcastRoomsForPost(post.levelType, post.levelValue);
    for (const room of rooms) {
      io.to(room).emit(eventName, payload);
    }
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[socket] ${eventName} → ${rooms.length} room(s) post=${payload?._id}`,
        rooms,
      );
    }
  };

  const serializePost = (post) => {
    const raw =
      post && typeof post.toObject === "function"
        ? post.toObject({ virtuals: true })
        : { ...post };
    if (raw._id != null) raw._id = String(raw._id);
    if (raw.originalPostId != null) {
      raw.originalPostId = String(raw.originalPostId);
    }
    return raw;
  };

  /** Likes, edits, recasts — clients listen to updatePost and/or postUpdated. */
  const emitPostChange = (post) => {
    const payload = serializePost(post);
    broadcastToFeedRooms(post, "updatePost", payload);
    broadcastToFeedRooms(post, "postUpdated", payload);
  };

  const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const findUsersByMentionHandles = async (handles) => {
    if (!handles?.length) return [];

    const nicknames = handles
      .map((m) =>
        typeof m === "string"
          ? m
          : m?.nickName || m?.userId || m?.nickname || "",
      )
      .filter(Boolean)
      .map((n) => String(n).replace(/^@/, "").trim())
      .filter(Boolean);

    if (!nicknames.length) return [];

    const mentionRegexes = [...new Set(nicknames)].map(
      (n) => new RegExp(`^@?${escapeRegex(n)}$`, "i"),
    );

    return User.find({
      nickName: { $in: mentionRegexes },
    });
  };

  /** Walk recast/recite chain to the root cast for shares. */
  const resolveRootOriginalPost = async (postId) => {
    let current = await Post.findById(postId);
    if (!current) return null;

    let depth = 0;
    while (
      depth < 10 &&
      (current.type === "recast" || current.type === "recite") &&
      current.originalPostId
    ) {
      const parent = await Post.findById(current.originalPostId);
      if (!parent) break;
      current = parent;
      depth += 1;
    }

    return current;
  };

  const resolveMentions = async (rawMentions) => {
    if (!rawMentions?.length) return [];

    const handles = rawMentions
      .map((m) =>
        typeof m === "string"
          ? m
          : m?.nickName || m?.nickname || "",
      )
      .filter(Boolean)
      .map((n) => String(n).replace(/^@+/, "").trim())
      .filter(Boolean);

    if (!handles.length) return [];

    const users = await findUsersByMentionHandles(handles);
    const byNick = new Map(
      users.map((u) => [
        String(u.nickName || "")
          .replace(/^@+/, "")
          .toLowerCase(),
        u,
      ]),
    );

    const seen = new Set();
    const resolved = [];

    for (const handle of handles) {
      const key = handle.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const user = byNick.get(key);
      if (!user?.clerkId) continue;

      resolved.push({
        userId: user.clerkId,
        nickName: String(user.nickName || handle).replace(/^@+/, ""),
      });
    }

    return resolved;
  };

  // ✅ Get posts
  const kenyaData = require("../assets/iebc.json"); // adjust path if needed
  const FEED_SORT = { createdAt: -1, _id: -1 };
  const DEFAULT_POST_LIMIT = 10;

  const hasQueryParam = (query, key) =>
    Object.prototype.hasOwnProperty.call(query, key);

  const toPositiveInt = (value, fallback = DEFAULT_POST_LIMIT) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  const createCursorError = () => {
    const error = new Error("Invalid cursor");
    error.statusCode = 400;
    return error;
  };

  const parsePostCursor = (cursor) => {
    if (cursor == null || cursor === "") return null;

    const rawCursor = String(cursor);
    const separatorIndex = rawCursor.lastIndexOf("_");
    if (separatorIndex <= 0 || separatorIndex === rawCursor.length - 1) {
      throw createCursorError();
    }

    const createdAt = new Date(rawCursor.slice(0, separatorIndex));
    const id = rawCursor.slice(separatorIndex + 1);

    if (
      Number.isNaN(createdAt.getTime()) ||
      !mongoose.Types.ObjectId.isValid(id)
    ) {
      throw createCursorError();
    }

    return {
      createdAt,
      id: new mongoose.Types.ObjectId(id),
    };
  };

  const encodePostCursor = (post) => {
    if (!post?.createdAt || !post?._id) return null;

    const createdAt =
      post.createdAt instanceof Date ? post.createdAt : new Date(post.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;

    return `${createdAt.toISOString()}_${post._id.toString()}`;
  };

  const appendQuoteCounts = async (posts) => {
    if (!posts.length) return [];

    const postIds = posts.map((post) => post._id).filter(Boolean);
    const [quoteCounts, commentCounts] = await Promise.all([
      Post.aggregate([
        {
          $match: {
            originalPostId: { $in: postIds },
            quote: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: "$originalPostId",
            count: { $sum: 1 },
          },
        },
      ]),
      Comment.aggregate([
        {
          $match: {
            postId: { $in: postIds.map((id) => String(id)) },
          },
        },
        {
          $group: {
            _id: "$postId",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const quoteCountsByPostId = new Map(
      quoteCounts.map((row) => [String(row._id), row.count]),
    );
    const commentCountsByPostId = new Map(
      commentCounts.map((row) => [String(row._id), row.count]),
    );

    return posts.map((post) => {
      const raw =
        post && typeof post.toObject === "function"
          ? post.toObject()
          : { ...post };

      return {
        ...raw,
        commentsCount: commentCountsByPostId.get(String(raw._id)) || 0,
        quoteCount: quoteCountsByPostId.get(String(raw._id)) || 0,
      };
    });
  };

  // ✅ Create post
  router.post("/", moderationGate({ textField: "caption", targetType: "post" }), async (req, res) => {
    try {
      const {
        userId,
        caption,
        media,
        mentions,
        quote,
        originalPostId,
        levelType,
        levelValue,
        linkPreview,
        type,
      } = req.body;
      if (!userId)
        return res.status(400).json({ message: "userId is required" });

      const user = await User.findOne({ clerkId: userId });
      if (!user) return res.status(404).json({ message: "User not found" });

      let originalPost = null;
      let rootOriginalPostId = originalPostId || null;
      if (originalPostId) {
        originalPost = await resolveRootOriginalPost(originalPostId);
        if (!originalPost)
          return res.status(404).json({ message: "Original post not found" });
        rootOriginalPostId = originalPost._id;
      }

      const resolvedMentions = await resolveMentions(
        mentions ?? originalPost?.mentions ?? [],
      );

      const newPost = new Post({
        userId,
        caption: caption || originalPost?.caption || "",
        linkPreview: linkPreview
          ? Array.isArray(linkPreview)
            ? linkPreview
            : [linkPreview] // ✅ convert object → array
          : originalPost?.linkPreview || [],
        media: media || originalPost?.media || [],
        mentions: resolvedMentions,
        reciteMedia: originalPost?.media || [],
        levelType: originalPost?.levelType || levelType,
        levelValue: originalPost?.levelValue || levelValue,
        quote: quote || originalPost?.quote || null,
        originalPostId: rootOriginalPostId,
        type: type || "post",
        user: {
          clerkId: user.clerkId,
          firstName: user.firstName,
          lastName: user.lastName,
          nickName: user.nickName,
          companyName: user.companyName,
          image: user.image,
          accountType: user.accountType,
          isVerified: !!user.isVerified,
          verificationType: user.verificationType || "",
        },
        reciteUserId: originalPost?.user?.clerkId || "",
        reciteFirstName: originalPost?.user?.firstName || "",
        reciteLastName: originalPost?.user?.lastName || "",
        reciteNickName: originalPost?.user?.nickName || "",
        reciteCompanyName: originalPost?.user?.companyName || "",
        reciteImage: originalPost?.user?.image || "",
      });

      await newPost.save();
      void queues.moderation.add("moderate-post", {
        targetType: "post",
        targetId: String(newPost._id),
        authorId: userId,
        text: newPost.caption || newPost.quote || "",
      }).catch(() => {});

      const payload = serializePost(newPost);
      broadcastToFeedRooms(newPost, "newPost", payload);
      emitPostChange(newPost);

      const authorName =
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.nickName ||
        user.companyName ||
        "Someone";
      const postId = newPost._id.toString();

      // Push + in-app notifications must not block the live feed socket broadcast.
      void (async () => {
        try {
          if (isNonPersonalAccount(user.accountType)) {
            const followers = await User.find({
              clerkId: { $in: user.followers || [] },
            });
            const isRecast = type === "recast" || type === "recite";
            for (const follower of followers) {
              if (follower.clerkId === user.clerkId) continue;

              await notify({
                userId: follower.clerkId,
                type: isRecast ? "share" : "post",
                title: authorName,
                body: isRecast
                  ? "Shared a post"
                  : "Published a new update",
                actor: {
                  userId: user.clerkId,
                  name: authorName,
                  image: user.image,
                },
                entityId: postId,
                entityType: "post",
                data: {
                  screen: "post",
                  postId,
                  authorId: user.clerkId,
                  category: "social",
                  accountType: user.accountType,
                },
                io,
                dedupeWindowMs: 60_000,
              });
            }
          }

          const mentionedUsers = await findUsersByMentionHandles(
            newPost.mentions,
          );

          for (const mentionedUser of mentionedUsers) {
            if (mentionedUser.clerkId === userId) continue;

            await notify({
              userId: mentionedUser.clerkId,
              type: "mention",
              title: "You were mentioned",
              body: `${user.nickName || user.firstName} mentioned you in a post`,
              actor: {
                userId: user.clerkId,
                name: user.nickName || user.firstName,
                image: user.image,
              },
              entityId: postId,
              entityType: "post",
              io,
            });
          }
        } catch (notifyErr) {
          console.error("Post notification dispatch failed:", notifyErr);
        }
      })();

      return res.status(201).json(newPost);
    } catch (err) {
      console.error("❌ Error creating post:", err);
      return res.status(500).json({ message: "Server error", err });
    }
  });

  // ✅ Edit post
  router.put("/:id", async (req, res) => {
    try {
      const { caption, media, quote, userId } = req.body;

      const post = await Post.findById(req.params.id);

      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      if (post.userId !== userId) {
        return res.status(403).json({
          message: "Unauthorized to edit this post",
        });
      }

      // ✅ update all editable fields safely
      if (caption !== undefined) post.caption = caption;
      if (media !== undefined) post.media = media;
      if (quote !== undefined) post.quote = quote;

      await post.save();

      emitPostChange(post);

      res.status(200).json(post);
    } catch (err) {
      console.error("❌ Error editing post:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.get("/", async (req, res) => {
    try {
      const {
        levelType,
        levelValue,
        limit = 10,
        feed,
        viewerId,
      } = req.query;
      const hasPageParam = hasQueryParam(req.query, "page");
      const hasCursorParam = hasQueryParam(req.query, "cursor");
      const isCursorRequest = hasCursorParam && !hasPageParam;
      const requestedLimit = toPositiveInt(limit);

      // ✅ Include posts that are not deleted
      const filter = {
        isDeleted: { $ne: true },
      };

      const { levelTypes, levelValues } = getRelatedLevels(
        levelType,
        levelValue,
      );

      const query = {
        ...filter,
        levelType: { $in: levelTypes },
      };

      if (levelValues) {
        query.levelValue = { $in: levelValues };
      }

      if (isCursorRequest) {
        const cursor = parsePostCursor(req.query.cursor);
        if (cursor) {
          query.$or = [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
          ];
        }

        const rawPosts = await Post.find(query)
          .sort(FEED_SORT)
          .limit(requestedLimit + 1);

        let visiblePosts = rawPosts;
        if (feed === "news" && viewerId) {
          const viewer = await User.findOne({
            clerkId: String(viewerId),
          }).select("following");
          const followingIds = new Set(viewer?.following || []);
          visiblePosts = rawPosts.filter((post) =>
            isNewsFeedPost(post, followingIds),
          );
        }

        const hasMore = rawPosts.length > requestedLimit;
        const postsPage = visiblePosts.slice(0, requestedLimit);
        const cursorAnchor =
          postsPage[postsPage.length - 1] ||
          rawPosts[Math.min(rawPosts.length, requestedLimit) - 1] ||
          null;
        const postsWithCounts = await appendQuoteCounts(postsPage);

        return res.status(200).json({
          posts: postsWithCounts,
          nextCursor: hasMore ? encodePostCursor(cursorAnchor) : null,
          hasMore,
        });
      }

      const page = toPositiveInt(req.query.page, 1);
      const posts = await Post.find(query)
        .sort(FEED_SORT)
        .skip((page - 1) * requestedLimit)
        .limit(requestedLimit);

      let postsWithCounts = await appendQuoteCounts(posts);

      if (feed === "news" && viewerId) {
        const viewer = await User.findOne({ clerkId: String(viewerId) }).select(
          "following",
        );
        const followingIds = new Set(viewer?.following || []);
        postsWithCounts = postsWithCounts.filter((post) =>
          isNewsFeedPost(post, followingIds),
        );
      }

      res.status(200).json(postsWithCounts);
    } catch (err) {
      console.error("❌ Error fetching posts:", err);
      res.status(err.statusCode || 500).json({
        message: err.statusCode === 400 ? err.message : "Server error",
      });
    }
  });

  router.get("/media", async (req, res) => {
    try {
      const { levelType, levelValue, page = 1, limit = 10 } = req.query;


      // ✅ Include posts that are not deleted
      const filter = {
        $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }],
      };

      const { levelTypes, levelValues } = getRelatedLevels(
        levelType,
        levelValue,
      );

      const query = {
        ...filter,
        levelType: { $in: levelTypes },
      };

      if (levelValues) {
        query.levelValue = { $in: levelValues };
      }

      // ✅ MEDIA ONLY
      query.media = { $exists: true, $ne: [] };

      const posts = await Post.find(query)
        .sort(FEED_SORT)
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit));

      const postsWithCounts = await appendQuoteCounts(posts);

      res.status(200).json(postsWithCounts);
    } catch (err) {
      console.error("❌ Error fetching posts:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.get("/item/:postId", async (req, res) => {
    try {
      const { postId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(postId)) {
        return res.status(400).json({ message: "Invalid post id" });
      }

      const post = await Post.findById(postId);
      if (!post || post.isDeleted) {
        return res.status(404).json({ message: "Post not found" });
      }

      const [postWithCounts] = await appendQuoteCounts([post]);
      res.status(200).json(postWithCounts);
    } catch (err) {
      console.error("❌ Error fetching post:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  /** Batch check which post ids are deleted/hidden — for feed polling on serverless. */
  router.post("/visible", async (req, res) => {
    try {
      const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
      const ids = [
        ...new Set(
          rawIds
            .map((id) => String(id ?? "").trim())
            .filter((id) => mongoose.Types.ObjectId.isValid(id)),
        ),
      ];

      if (!ids.length) {
        return res.status(200).json({ removedIds: [] });
      }

      const visible = await Post.find({
        _id: { $in: ids },
        isDeleted: { $ne: true },
      }).select("_id");

      const visibleSet = new Set(visible.map((row) => String(row._id)));
      const removedIds = ids.filter((id) => !visibleSet.has(id));

      res.status(200).json({ removedIds });
    } catch (err) {
      console.error("❌ Error checking post visibility:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const { levelType, levelValue } = req.query;
      const { id } = req.params; // this is the clerkId from frontend

      // Base filter: include only posts not deleted
      const filter = {
        userId: id,
        $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }],
      };

      // DEBUG logs
      const totalPosts = await Post.countDocuments({ userId: id });
      console.log(`🟢 Total posts in DB for clerkId ${id}:`, totalPosts);

      if (levelType === "home") {
        const posts = await Post.find(filter).sort({ createdAt: -1 });
        console.log(`🟢 Posts returned for HOME:`, posts.length);
        const postsWithCounts = await appendQuoteCounts(posts);
        return res.status(200).json(postsWithCounts);
      }

      const { levelTypes, levelValues } = getRelatedLevels(
        levelType,
        levelValue,
      );

      const profileQuery = {
        ...filter,
        levelType: { $in: levelTypes },
      };
      if (levelValues?.length) {
        profileQuery.levelValue = { $in: levelValues };
      }

      const posts = await Post.find(profileQuery).sort({ createdAt: -1 });

      console.log(`🟢 Posts returned for ${levelType}:`, posts.length);

      const postsWithCounts = await appendQuoteCounts(posts);
      res.status(200).json(postsWithCounts);
    } catch (err) {
      console.error("❌ Error fetching posts:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // ✅ Like / Unlike
  router.post("/:id/like", async (req, res) => {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ message: "Missing userId" });
      }

      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: "Invalid post id" });
      }

      const post = await Post.findById(req.params.id);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      const alreadyLiked = post.likes.some((id) => id.toString() === userId);

      // toggle like
      if (alreadyLiked) {
        post.likes = post.likes.filter((id) => id.toString() !== userId);
      } else {
        post.likes.push(userId);
        void InteractionLog.create({
          userId,
          postId: post._id,
          action: "like",
          county: post.levelValue,
          topics: post.aiTopics || [],
        }).catch(() => {});

        const postAuthorId = post.userId || post.user?.clerkId;
        if (postAuthorId && postAuthorId !== userId) {
          const liker = await User.findOne({ clerkId: userId });
          const likerName =
            [liker?.firstName, liker?.lastName].filter(Boolean).join(" ") ||
            liker?.nickName ||
            liker?.companyName ||
            "Someone";

          await notify({
            userId: postAuthorId,
            type: "like",
            title: "New like",
            body: `${likerName} liked your post`,
            actor: {
              userId,
              name: likerName,
              image: liker?.image,
            },
            entityId: post._id.toString(),
            entityType: "post",
            data: {
              screen: "post",
              postId: post._id.toString(),
              authorId: userId,
              category: "social",
            },
            io,
            dedupeWindowMs: 120_000,
          });
        }
      }

      await post.save();

      emitPostChange(post);

      res.status(200).json(post);
    } catch (err) {
      console.error("❌ Error liking post:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  //   // ✅ Increment views
  router.post("/:id/view", async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: "Invalid post id" });
      }

      const post = await Post.findByIdAndUpdate(
        req.params.id,
        { $inc: { views: 1 } },
        { new: true },
      );
      const userId = req.body?.userId || req.query?.userId;
      if (post && userId) {
        void InteractionLog.create({
          userId,
          postId: post._id,
          action: "view",
          county: post.levelValue,
          topics: post.aiTopics || [],
        }).catch(() => {});
      }
      res.json(post);
    } catch (err) {
      res.status(500).json({ error: "Failed to increment views" });
    }
  });

  // recastCount
  router.post("/:id/recastCount", async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: "Invalid post id" });
      }

      const post = await Post.findByIdAndUpdate(
        req.params.id,
        { $inc: { recastCount: 1 } },
        { new: true },
      );
      res.json(post);
    } catch (err) {
      res.status(500).json({ error: "Failed to increment views" });
    }
  });
  // reciteCount
  router.post("/:id/reciteCount", async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ error: "Invalid post id" });
      }

      const post = await Post.findByIdAndUpdate(
        req.params.id,
        { $inc: { reciteCount: 1 } },
        { new: true },
      );
      res.json(post);
    } catch (err) {
      res.status(500).json({ error: "Failed to increment views" });
    }
  });

  //   // ✅ Delete post (with ownership check)
  router.delete("/:id", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: "Invalid post id" });
      }

      const post = await Post.findById(req.params.id);

      if (!post) return res.status(404).json({ message: "Post not found" });

      if (post.userId !== userId) {
        return res
          .status(403)
          .json({ message: "Unauthorized to delete this post" });
      }

      post.isDeleted = true;
      await post.save();

      broadcastToFeedRooms(post, "deletePost", String(post._id));

      res.status(200).json({ message: "Post hidden", postId: req.params.id });
    } catch (err) {
      console.error("❌ Error deleting post:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // router.put("/restore/:id", async (req, res) => {
  //   try {
  //     const post = await Post.findByIdAndUpdate(
  //       req.params.id,
  //       { isDeleted: false },
  //       { new: true }
  //     );
  //     res.json(post);
  //   } catch (err) {
  //     res.status(500).json({ message: err.message });
  //   }
  // });

  //   // POST /posts/:id/recast
  //   // ✅ Clean single Recast Route
  router.post("/:id/recast", async (req, res) => {
    try {
      const { id } = req.params;
      const { userId, nickname } = req.body;

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      const post = await Post.findById(id);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      if (!Array.isArray(post.recasts)) post.recasts = [];

      const existingIndex = post.recasts.findIndex(
        (r) => r.userId === userId && !r.quote,
      );

      if (existingIndex >= 0) {
        post.recasts.splice(existingIndex, 1); // toggle off
      } else {
        post.recasts.push({
          userId,
          nickname: nickname || "Anonymous",
          recastedAt: new Date(),
        });
      }

      await post.save();

      emitPostChange(post);

      return res.status(200).json(post);
    } catch (error) {
      console.error("🔥 recast error:", error);
      return res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};
