const OpenAI = require("openai");
const AiAuditLog = require("../../models/aiAuditLog");
const {
  OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
} = require("../../config/aiModels");

const DEFAULT_FAST_MODEL =
  process.env.AI_FAST_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
const DEFAULT_REASONING_MODEL =
  process.env.AI_REASONING_MODEL?.trim() ||
  process.env.OPENROUTER_REASONING_MODEL?.trim() ||
  "google/gemini-2.0-flash-001";

let client = null;

function getClient() {
  if (client) return client;
  const apiKey =
    process.env.OPEN_ROUTER_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing OPEN_ROUTER_API_KEY or OPENAI_API_KEY");
  }
  client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": process.env.APP_PUBLIC_URL || "https://broadcast.africa",
      "X-Title": "BroadCast AI",
    },
  });
  return client;
}

function tieredModel(task = "fast") {
  if (task === "reasoning" || task === "generation" || task === "civic") {
    return DEFAULT_REASONING_MODEL;
  }
  return DEFAULT_FAST_MODEL;
}

function sanitizePromptInput(input) {
  return String(input || "")
    .replace(/\b(system|assistant|developer)\s*:/gi, "$1 user text:")
    .replace(/```/g, "'''")
    .slice(0, 12000);
}

function filterModelOutput(text) {
  return String(text || "")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[redacted-api-key]")
    .replace(/OPEN_ROUTER_API_KEY\s*=\s*\S+/gi, "OPEN_ROUTER_API_KEY=[redacted]");
}

function estimateCostUsd(model, usage) {
  if (!usage) return 0;
  const prompt = usage.prompt_tokens || 0;
  const completion = usage.completion_tokens || 0;
  const lower = String(model || "").toLowerCase();
  if (lower.includes("gemini")) {
    return (prompt * 0.000000075) + (completion * 0.0000003);
  }
  return (prompt + completion) * 0.0000002;
}

async function auditCall({
  feature,
  model,
  usage,
  latencyMs,
  userId,
  requestId,
}) {
  try {
    await AiAuditLog.create({
      feature,
      model,
      promptTokens: usage?.prompt_tokens || 0,
      completionTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
      costUsd: estimateCostUsd(model, usage),
      latencyMs,
      userId,
      requestId,
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("AI audit log failed:", error.message);
    }
  }
}

async function completeChat({
  messages,
  model = tieredModel("fast"),
  temperature = 0.2,
  responseFormat,
  feature = "general",
  userId,
  requestId,
}) {
  const startedAt = Date.now();
  const response = await getClient().chat.completions.create({
    model,
    messages,
    temperature,
    ...(responseFormat ? { response_format: responseFormat } : {}),
  });
  const text = filterModelOutput(response.choices?.[0]?.message?.content || "");
  await auditCall({
    feature,
    model,
    usage: response.usage,
    latencyMs: Date.now() - startedAt,
    userId,
    requestId,
  });
  return {
    text,
    raw: response,
    usage: response.usage,
    model,
  };
}

async function completeJson(options) {
  const response = await completeChat({
    ...options,
    responseFormat: { type: "json_object" },
  });
  try {
    return {
      ...response,
      json: JSON.parse(response.text),
    };
  } catch (error) {
    return {
      ...response,
      json: null,
      parseError: error.message,
    };
  }
}

module.exports = {
  completeChat,
  completeJson,
  filterModelOutput,
  sanitizePromptInput,
  tieredModel,
};
