// models/product.js
const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    price: { type: Number, required: true },
    description: { type: String, required: true },
    images: [{ type: String, required: true }],
    category: { type: String, required: true },
    userId: {
      type: String,
      required: true, // Clerk or Mongo userId
    },
  },
  { timestamps: true }
);

// Re-use model if it exists (for hot reload in dev)
const Product =
  mongoose.models.Product || mongoose.model("Product", productSchema);

module.exports = Product;
