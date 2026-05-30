const mongoose = require("mongoose");

const productReportSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    reporterId: { type: String, required: true },
    reason: {
      type: String,
      enum: [
        "scam",
        "fake_product",
        "wrong_price",
        "prohibited_item",
        "duplicate",
        "other",
      ],
      required: true,
    },
    details: { type: String, maxlength: 500 },
    status: {
      type: String,
      enum: ["pending", "reviewed", "dismissed", "action_taken"],
      default: "pending",
    },
    fraudScore: { type: Number, default: 0 },
  },
  { timestamps: true },
);

productReportSchema.index({ productId: 1, reporterId: 1 }, { unique: true });

module.exports =
  mongoose.models.ProductReport ||
  mongoose.model("ProductReport", productReportSchema);
