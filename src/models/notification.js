const mongoose = require("mongoose");

const NOTIFICATION_TYPES = [
  "follow",
  "like",
  "comment",
  "reply",
  "mention",
  "repost",
  "share",
  "story_reaction",
  "message",
  "group_message",
  "media_message",
  "voice_note",
  "product_like",
  "new_order",
  "order_update",
  "delivery_update",
  "seller_response",
  "livestream_started",
  "live_join_request",
  "live_invite",
  "live_reaction",
  "verification_approved",
  "payment_successful",
  "security_alert",
  "incoming_call",
  "missed_call",
  "system",
  "poll_created",
  "poll_ending",
  "poll_ended",
  "live_poll",
];

const NOTIFICATION_CATEGORIES = [
  "social",
  "messages",
  "marketplace",
  "livestreams",
  "system",
  "calls",
];

const TYPE_TO_CATEGORY = {
  follow: "social",
  like: "social",
  comment: "social",
  reply: "social",
  mention: "social",
  repost: "social",
  share: "social",
  story_reaction: "social",
  message: "messages",
  group_message: "messages",
  media_message: "messages",
  voice_note: "messages",
  product_like: "marketplace",
  new_order: "marketplace",
  order_update: "marketplace",
  delivery_update: "marketplace",
  seller_response: "marketplace",
  livestream_started: "livestreams",
  live_join_request: "livestreams",
  live_invite: "livestreams",
  live_reaction: "livestreams",
  verification_approved: "system",
  payment_successful: "system",
  security_alert: "system",
  incoming_call: "calls",
  missed_call: "calls",
  system: "system",
  poll_created: "social",
  poll_ending: "social",
  poll_ended: "social",
  live_poll: "livestreams",
};

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    actor: {
      userId: String,
      name: String,
      image: String,
    },
    entityId: { type: String, default: null },
    entityType: { type: String, default: null },
    mediaPreview: { type: String, default: null },
    groupKey: { type: String, index: true },
    groupCount: { type: Number, default: 1 },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    pushSent: { type: Boolean, default: false },
    dedupeKey: { type: String, sparse: true },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, category: 1, createdAt: -1 });
notificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);

notificationSchema.statics.categoryForType = function categoryForType(type) {
  return TYPE_TO_CATEGORY[type] || "system";
};

const Notification =
  mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema);

module.exports = Notification;
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
module.exports.NOTIFICATION_CATEGORIES = NOTIFICATION_CATEGORIES;
module.exports.TYPE_TO_CATEGORY = TYPE_TO_CATEGORY;
