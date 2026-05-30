/** OpenRouter (OpenAI-compatible) — used when OPEN_ROUTER_API_KEY is set */
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";

const DEFAULT_OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL?.trim() || "google/gemini-2.0-flash-001";

/** Direct Gemini fallback when not using OpenRouter */
const DEFAULT_GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";

function useOpenRouter() {
  return Boolean(process.env.OPEN_ROUTER_API_KEY?.trim());
}

/**
 * Stream @stream-io/chat-ai-sdk only supports openai | anthropic | gemini | xai.
 * OpenRouter is wired via the OpenAI provider + OPENAI_BASE_URL.
 */
function configureOpenRouterEnv() {
  if (!useOpenRouter()) return;

  process.env.OPENAI_API_KEY = process.env.OPEN_ROUTER_API_KEY.trim();

  if (!process.env.OPENAI_BASE_URL?.trim()) {
    process.env.OPENAI_BASE_URL = OPENROUTER_BASE_URL;
  }
}

function resolveStreamPlatform(clientPlatform) {
  const p =
    typeof clientPlatform === "string" ? clientPlatform.trim().toLowerCase() : "";

  if (p === "openrouter") return "openai";

  if (p === "node" || p === "mobile" || p === "web" || p === "") {
    return useOpenRouter() ? "openai" : "gemini";
  }

  if (["openai", "anthropic", "gemini", "xai"].includes(p)) {
    return p;
  }

  return useOpenRouter() ? "openai" : "gemini";
}

function resolveModel(streamPlatform, modelFromClient) {
  if (typeof modelFromClient === "string" && modelFromClient.trim()) {
    return modelFromClient.trim();
  }

  if (useOpenRouter() && streamPlatform === "openai") {
    return DEFAULT_OPENROUTER_MODEL;
  }

  if (streamPlatform === "gemini") {
    return DEFAULT_GEMINI_MODEL;
  }

  return undefined;
}

module.exports = {
  OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_GEMINI_MODEL,
  useOpenRouter,
  configureOpenRouterEnv,
  resolveStreamPlatform,
  resolveModel,
};
