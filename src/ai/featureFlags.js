const AiFeatureFlag = require("../models/aiFeatureFlag");

const DEFAULT_FLAGS = {
  ai_feed: true,
  ai_search: true,
  ai_moderation_block: false,
  ai_civic_assistant: true,
};

let cache = null;
let cacheUntil = 0;

async function loadFlags() {
  if (cache && cacheUntil > Date.now()) return cache;
  const rows = await AiFeatureFlag.find({}).lean();
  cache = { ...DEFAULT_FLAGS };
  for (const row of rows) {
    cache[row.key] = Boolean(row.enabled);
  }
  cacheUntil = Date.now() + 60_000;
  return cache;
}

async function isEnabled(key) {
  const flags = await loadFlags();
  return Boolean(flags[key]);
}

async function setFlag({ key, enabled, description, updatedBy }) {
  const doc = await AiFeatureFlag.findOneAndUpdate(
    { key },
    { $set: { enabled, description, updatedBy } },
    { upsert: true, new: true },
  );
  cache = null;
  return doc;
}

module.exports = {
  DEFAULT_FLAGS,
  isEnabled,
  loadFlags,
  setFlag,
};
