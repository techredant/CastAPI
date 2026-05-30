const express = require("express");
const Product = require("../models/product");
const User = require("../models/user");
const ProductFavorite = require("../models/productFavorite");
const {
  enrichProducts,
  sortByRank,
  detectFraudWarnings,
} = require("../services/productRanking.service");
const { canCreateFreeListing, applyFraudCheckToProduct } = require("../services/marketplace.service");

const router = express.Router();

function buildProductQuery(filters) {
  const query = {};

  if (filters.userId) {
    query.userId = filters.userId;
  } else {
    query.status = { $in: ["active", "flagged"] };
  }

  if (filters.category) query.category = filters.category;
  if (filters.condition) query.condition = filters.condition;
  if (filters.minPrice != null || filters.maxPrice != null) {
    query.price = {};
    if (filters.minPrice != null) query.price.$gte = Number(filters.minPrice);
    if (filters.maxPrice != null) query.price.$lte = Number(filters.maxPrice);
  }
  if (filters.county) query["location.county"] = filters.county;
  if (filters.status) query.status = filters.status;
  if (filters.promoted === "true") {
    query.isPromoted = true;
    query.boostExpiresAt = { $gt: new Date() };
  }
  if (filters.q) {
    query.$text = { $search: filters.q };
  }

  return query;
}

/** GET /api/products/feed — paginated marketplace feed */
router.get("/feed", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
    const skip = (page - 1) * limit;
    const sort = req.query.sort || "relevance";
    const verifiedOnly = req.query.verifiedOnly === "true";

    const filters = {
      q: req.query.q,
      category: req.query.category,
      condition: req.query.condition,
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
      county: req.query.county,
      promoted: req.query.promoted,
      userId: req.query.userId,
    };

    let query = buildProductQuery(filters);
    const projection = filters.q ? { score: { $meta: "textScore" } } : {};
    const dbSort =
      filters.q && sort === "relevance"
        ? { score: { $meta: "textScore" }, createdAt: -1 }
        : { createdAt: -1 };
    let products = await Product.find(query, projection).sort(dbSort).lean();

    let enriched = await enrichProducts(
      products.map((p) => ({ ...p, toObject: () => p })),
    );

    if (verifiedOnly) {
      enriched = enriched.filter((p) => p.seller?.isVerified);
    }

    enriched = sortByRank(enriched, filters.q && sort === "relevance" ? "text_relevance" : sort);
    const total = enriched.length;
    const pageItems = enriched.slice(skip, skip + limit);

    res.json({
      products: pageItems,
      page,
      limit,
      total,
      hasMore: skip + limit < total,
      filters: {
        q: filters.q || "",
        category: filters.category || "",
        condition: filters.condition || "",
        minPrice: filters.minPrice || "",
        maxPrice: filters.maxPrice || "",
        county: filters.county || "",
        verifiedOnly,
        sort,
      },
    });
  } catch (error) {
    console.error("Feed error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/** GET /api/products/promoted */
router.get("/promoted", async (req, res) => {
  try {
    const products = await Product.find({
      status: "active",
      isPromoted: true,
      boostExpiresAt: { $gt: new Date() },
    })
      .sort({ boostRankWeight: -1, createdAt: -1 })
      .limit(12)
      .lean();

    const enriched = await enrichProducts(
      products.map((p) => ({ ...p, toObject: () => p })),
    );
    res.json(enriched);
  } catch (error) {
    console.error("Promoted error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/** GET /api/products/trending */
router.get("/trending", async (req, res) => {
  try {
    const products = await Product.find({ status: "active" })
      .sort({ viewCount: -1, favoriteCount: -1, createdAt: -1 })
      .limit(15)
      .lean();

    const enriched = await enrichProducts(
      products.map((p) => ({ ...p, toObject: () => p })),
    );
    res.json(enriched);
  } catch (error) {
    console.error("Trending error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/** GET /api/products/related/:id */
router.get("/related/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Not found" });

    const related = await Product.find({
      _id: { $ne: product._id },
      status: "active",
      category: product.category,
    })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean();

    const enriched = await enrichProducts(
      related.map((p) => ({ ...p, toObject: () => p })),
    );
    res.json(enriched);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

/** GET /api/products/favorites/:userId */
router.get("/favorites/:userId", async (req, res) => {
  try {
    const favs = await ProductFavorite.find({
      userId: req.params.userId,
    }).sort({ createdAt: -1 });
    const ids = favs.map((f) => f.productId);
    const products = await Product.find({ _id: { $in: ids }, status: "active" });
    const enriched = await enrichProducts(products);
    res.json(enriched);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

/** GET /api/products/:id/favorite-status?userId= */
router.get("/:id/favorite-status", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.json({ favorited: false });
    const existing = await ProductFavorite.findOne({
      userId,
      productId: req.params.id,
    });
    res.json({ favorited: !!existing });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

/** GET /api/products — legacy list */
router.get("/", async (req, res) => {
  try {
    const products = await Product.find({ status: { $ne: "hidden" } })
      .sort({ createdAt: -1 })
      .lean();
    const enriched = await enrichProducts(
      products.map((p) => ({ ...p, toObject: () => p })),
    );
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/** POST /api/products */
router.post("/", async (req, res) => {
  try {
    const {
      title,
      price,
      phoneNumber,
      description,
      media,
      category,
      userId,
      condition,
      location,
    } = req.body;

    if (!title || price == null || !description || !media || !category || !userId) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const quota = await canCreateFreeListing(userId);
    if (!quota.allowed) {
      return res.status(403).json({
        message: `Free listing limit reached (${quota.limit}). Upgrade to Premium Seller or boost existing listings.`,
        quota,
      });
    }

    const fraud = detectFraudWarnings({
      title,
      price,
      description,
      phoneNumber,
    });

    const newProduct = await Product.create({
      title,
      price,
      description,
      media,
      category,
      userId,
      phoneNumber,
      condition: condition || "used",
      location: location || {},
      fraudFlags: fraud,
      status: fraud.score >= 40 ? "flagged" : "active",
    });

    const [enriched] = await enrichProducts([newProduct]);
    res.status(201).json(enriched);
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/** GET /api/products/:id */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (["feed", "promoted", "trending", "search", "related"].includes(id)) {
      return res.status(404).json({ message: "Not found" });
    }

    const product = await Product.findByIdAndUpdate(
      id,
      { $inc: { viewCount: 1 } },
      { new: true },
    );

    if (!product) return res.status(404).json({ message: "Product not found" });

    const [enriched] = await enrichProducts([product]);
    const seller = await User.findOne({ clerkId: product.userId }).select(
      "clerkId firstName lastName nickName image isVerified verificationType county constituency ward ratingAvg ratingCount",
    );

    res.json({
      ...enriched,
      seller: seller
        ? {
            clerkId: seller.clerkId,
            name:
              seller.nickName ||
              [seller.firstName, seller.lastName].filter(Boolean).join(" ") ||
              "Seller",
            image: seller.image,
            isVerified: !!seller.isVerified,
            county: seller.county,
            constituency: seller.constituency,
            ward: seller.ward,
            ratingAvg: seller.ratingAvg || 0,
            ratingCount: seller.ratingCount || 0,
          }
        : enriched.seller,
      fraudWarning:
        enriched.fraudFlags?.score >= 25
          ? "This listing was flagged for review. Proceed with caution."
          : null,
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/** PUT /api/products/:id */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, title, price, description, media, category, phoneNumber, condition, location, status } =
      req.body;

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (!userId) {
      return res.status(403).json({ message: "userId required" });
    }
    if (product.userId !== userId) {
      return res.status(403).json({ message: "Only the listing owner can edit this product" });
    }

    if (title != null) product.title = title;
    if (price != null) product.price = price;
    if (description != null) product.description = description;
    if (media != null) product.media = media;
    if (category != null) product.category = category;
    if (phoneNumber != null) product.phoneNumber = phoneNumber;
    if (condition != null) product.condition = condition;
    if (location != null) product.location = location;
    if (status != null) product.status = status;

    applyFraudCheckToProduct(product, req.body);
    await product.save();

    const [enriched] = await enrichProducts([product]);
    res.json(enriched);
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/** DELETE /api/products/:id */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (!userId) {
      return res.status(403).json({ message: "userId required" });
    }
    if (product.userId !== userId) {
      return res.status(403).json({ message: "Only the listing owner can delete this product" });
    }

    await Product.findByIdAndDelete(id);
    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/** POST /api/products/:id/favorite */
router.post("/:id/favorite", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: "userId required" });

    const existing = await ProductFavorite.findOne({
      userId,
      productId: req.params.id,
    });

    if (existing) {
      await existing.deleteOne();
      await Product.findByIdAndUpdate(req.params.id, {
        $inc: { favoriteCount: -1 },
      });
      return res.json({ favorited: false });
    }

    await ProductFavorite.create({ userId, productId: req.params.id });
    await Product.findByIdAndUpdate(req.params.id, {
      $inc: { favoriteCount: 1 },
    });
    res.json({ favorited: true });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
