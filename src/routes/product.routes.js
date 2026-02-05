// routes/productRoutes.js
const express = require("express");
const Product = require("../models/product");

const router = express.Router();

// ------------------- Create Product -------------------
router.post("/", async (req, res) => {
  try {
    const { title, price, description, images, category, userId } = req.body;

    if (!title || !price || !description || !images || !category || !userId) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const newProduct = await Product.create({
      title,
      price,
      description,
      images,
      category,
      userId,
    });

    res.status(201).json(newProduct);
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------- Get All Products -------------------
router.get("/", async (_req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------- Get Single Product -------------------
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);

    if (!product) return res.status(404).json({ message: "Product not found" });

    res.json(product);
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------- Update Product -------------------
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, price, description, images, category } = req.body;

    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      { title, price, description, images, category },
      { new: true, runValidators: true }
    );

    if (!updatedProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(updatedProduct);
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------- Delete Product -------------------
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deletedProduct = await Product.findByIdAndDelete(id);

    if (!deletedProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
