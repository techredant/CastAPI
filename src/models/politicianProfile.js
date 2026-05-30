const mongoose = require("mongoose");
const { enqueueEmbedding } = require("../ai/rag/ingest");

const politicianProfileSchema = new mongoose.Schema(
  {
    clerkId: { type: String, index: true },
    name: { type: String, required: true, index: true },
    party: { type: String, index: true },
    role: { type: String, index: true },
    county: { type: String, index: true },
    constituency: { type: String, index: true },
    ward: { type: String, index: true },
    manifestos: [
      {
        title: String,
        text: String,
        sourceUrl: String,
        publishedAt: Date,
      },
    ],
    promises: [
      {
        text: String,
        status: {
          type: String,
          enum: ["unknown", "promised", "in_progress", "delivered", "broken"],
          default: "unknown",
        },
        evidenceUrl: String,
        lastCheckedAt: Date,
      },
    ],
    controversies: [
      {
        title: String,
        summary: String,
        sourceUrl: String,
        severity: { type: Number, default: 0 },
        recordedAt: Date,
      },
    ],
    sentimentDaily: [
      {
        date: Date,
        score: Number,
        volume: Number,
      },
    ],
    popularityIndex: { type: Number, default: 0, index: true },
    aiSummary: { type: String, default: "" },
  },
  { timestamps: true },
);

politicianProfileSchema.index({
  name: "text",
  party: "text",
  role: "text",
  "manifestos.title": "text",
  "manifestos.text": "text",
  "promises.text": "text",
});

politicianProfileSchema.post("save", function enqueuePoliticianEmbedding(doc) {
  const manifestoText = (doc.manifestos || [])
    .map((item) => [item.title, item.text].filter(Boolean).join("\n"))
    .join("\n\n");
  const promiseText = (doc.promises || []).map((item) => item.text).join("\n");
  const text = [
    doc.name,
    doc.party,
    doc.role,
    doc.county,
    doc.aiSummary,
    manifestoText,
    promiseText,
  ]
    .filter(Boolean)
    .join("\n");

  void enqueueEmbedding({
    entityType: "politician",
    entityId: String(doc._id),
    text,
    county: doc.county,
    metadata: {
      title: doc.name,
      party: doc.party,
      role: doc.role,
      clerkId: doc.clerkId,
    },
  }).catch(() => {});
});

module.exports =
  mongoose.models.PoliticianProfile ||
  mongoose.model("PoliticianProfile", politicianProfileSchema);
