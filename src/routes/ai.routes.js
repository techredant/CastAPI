const express = require("express");
const { StreamChat } = require("stream-chat");

const {
  useOpenRouter,
  configureOpenRouterEnv,
  resolveStreamPlatform,
  resolveModel,
  DEFAULT_OPENROUTER_MODEL,
} = require("../config/aiModels");
const { answerCivicQuestion } = require("../ai/civic/assistant");
const { transcribeAudioUrl } = require("../ai/providers/deepgram");

// Map OpenRouter → OpenAI-compatible client for @stream-io/chat-ai-sdk
configureOpenRouterEnv();

const router = express.Router();

const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

const normalizeChannelId = (channelId) => {
  if (typeof channelId !== "string") return "";
  return channelId.trim();
};

const buildAgentUserId = (channelId) => `ai-agent-${channelId}`;

const resolveAiChannelId = (channelId, userId) => {
  if (channelId?.startsWith("ai-assistant-")) return channelId;
  if (userId) return `ai-assistant-${userId}`;
  return channelId;
};

let agentManager = null;
let agentManagerInitError = null;

const getAgentManager = () => {
  if (agentManager) return agentManager;
  if (agentManagerInitError) throw agentManagerInitError;

  if (!process.env.STREAM_API_KEY || !process.env.STREAM_API_SECRET) {
    agentManagerInitError = new Error(
      "Missing required environment variables STREAM_API_KEY or STREAM_API_SECRET",
    );
    throw agentManagerInitError;
  }

  if (useOpenRouter() && !process.env.OPENAI_API_KEY) {
    agentManagerInitError = new Error(
      "OPEN_ROUTER_API_KEY is set but OpenAI provider was not configured",
    );
    throw agentManagerInitError;
  }

  try {
    const { AgentManager } = require("@stream-io/chat-ai-sdk");
    agentManager = new AgentManager({
      agentIdResolver: (channelId) => buildAgentUserId(channelId),
    });
    return agentManager;
  } catch (error) {
    agentManagerInitError = error;
    throw error;
  }
};

/** Ensure Stream channel exists with user + AI agent (Stream AI SDK design) */
async function ensureAiChannel({
  channelId,
  channelType,
  humanUserId,
}) {
  const agentUserId = buildAgentUserId(channelId);

  await serverClient.upsertUsers([
    { id: humanUserId },
    {
      id: agentUserId,
      name: "Broadcast AI",
      image:
        "https://ui-avatars.com/api/?name=AI&background=3797F0&color=fff&bold=true",
      role: "admin",
    },
  ]);

  const channel = serverClient.channel(channelType, channelId, {
    members: [humanUserId, agentUserId],
    created_by_id: humanUserId,
    name: "AI Assistant",
    image:
      "https://ui-avatars.com/api/?name=AI&background=3797F0&color=fff&bold=true",
  });

  try {
    await channel.create({ created_by_id: humanUserId });
  } catch (err) {
    const msg = (err?.message || "").toLowerCase();
    const alreadyExists =
      msg.includes("already exists") ||
      msg.includes("duplicate") ||
      err?.status === 409;

    if (!alreadyExists) throw err;
  }

  await channel.watch();
  return { channel, agentUserId };
}

async function startAiAgentForChannel({
  channelId,
  channelType,
  humanUserId,
  platform,
  model,
}) {
  if (useOpenRouter() && !process.env.OPEN_ROUTER_API_KEY) {
    throw new Error("OPEN_ROUTER_API_KEY is not configured on the server");
  }

  const streamPlatform = resolveStreamPlatform(platform);
  const resolvedModel = resolveModel(streamPlatform, model);

  const { agentUserId } = await ensureAiChannel({
    channelId,
    channelType,
    humanUserId,
  });

  const manager = getAgentManager();

  try {
    await manager.stopAgent(agentUserId);
  } catch {
    /* first start */
  }

  await manager.startAgent({
    userId: agentUserId,
    channelId,
    channelType,
    platform: streamPlatform,
    model: resolvedModel,
    instructions: [
      "You are Broadcast AI, a helpful assistant inside a social app.",
      "Be concise, friendly, and practical.",
      "Use clear steps when explaining how to do something.",
    ],
  });

  return {
    agentUserId,
    streamPlatform,
    resolvedModel,
    provider: useOpenRouter() ? "openrouter" : streamPlatform,
  };
}

/** Public config for mobile app */
router.get("/config", (_req, res) => {
  const streamPlatform = resolveStreamPlatform("openrouter");
  res.json({
    provider: useOpenRouter() ? "openrouter" : streamPlatform,
    platform: useOpenRouter() ? "openrouter" : streamPlatform,
    streamPlatform,
    model: resolveModel(streamPlatform, null),
    defaultModel: DEFAULT_OPENROUTER_MODEL,
  });
});

router.post("/start-ai-agent", async (req, res) => {
  const {
    channel_id,
    channel_type = "messaging",
    platform,
    model,
    user_id,
  } = req.body;

  const humanUserId = normalizeChannelId(user_id || "");
  const channelId = resolveAiChannelId(
    normalizeChannelId(channel_id),
    humanUserId,
  );

  if (!channelId || !humanUserId) {
    return res.status(400).json({
      error: "Missing channel_id or user_id",
    });
  }

  try {
    const result = await startAiAgentForChannel({
      channelId,
      channelType: channel_type,
      humanUserId,
      platform,
      model,
    });

    return res.json({
      message: "AI Agent started",
      channel_id: channelId,
      channel_type,
      agent_user_id: result.agentUserId,
      provider: result.provider,
      platform: result.streamPlatform,
      model: result.resolvedModel,
    });
  } catch (error) {
    console.error("❌ Failed to start AI Agent:", error);
    return res.status(500).json({
      error: "Failed to start AI Agent",
      reason: error?.message || "Unknown error",
    });
  }
});

router.post("/civic/ask", async (req, res) => {
  const { question, message, userId, user_id, county, language, history } =
    req.body || {};
  const prompt = question || message;
  const humanUserId = normalizeChannelId(userId || user_id || "");

  if (!prompt) {
    return res.status(400).json({ error: "Missing question" });
  }

  try {
    const result = await answerCivicQuestion({
      question: prompt,
      userId: humanUserId,
      county,
      language,
      history: Array.isArray(history) ? history : [],
    });

    if (String(req.headers.accept || "").includes("text/event-stream")) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.write(`event: answer\ndata: ${JSON.stringify(result)}\n\n`);
      return res.end();
    }

    return res.json(result);
  } catch (error) {
    console.error("Civic AI failed:", error);
    return res.status(500).json({
      error: "Civic assistant failed",
      reason: error?.message || "Unknown error",
    });
  }
});

router.post("/civic/voice", async (req, res) => {
  const { audioUrl, userId, county, language } = req.body || {};
  if (!audioUrl) {
    return res.status(400).json({ error: "Missing audioUrl" });
  }

  try {
    const transcript = await transcribeAudioUrl(audioUrl, {
      language: language || "multi",
      diarize: false,
    });
    const result = await answerCivicQuestion({
      question: transcript.transcript,
      userId,
      county,
      language,
    });
    return res.json({ transcript: transcript.transcript, ...result });
  } catch (error) {
    console.error("Civic voice failed:", error);
    return res.status(500).json({
      error: "Civic voice failed",
      reason: error?.message || "Unknown error",
    });
  }
});

/** Legacy HTTP chat — prefer Stream Channel + MessageList on the client */
router.post("/chat", async (req, res) => {
  const { channel_id, message, user_id, platform, model } = req.body;

  const humanUserId = normalizeChannelId(user_id || "");
  const channelId = resolveAiChannelId(
    normalizeChannelId(channel_id),
    humanUserId,
  );

  if (!channelId || !message) {
    return res.status(400).json({ error: "Missing channel_id or message" });
  }

  try {
    if (humanUserId) {
      await startAiAgentForChannel({
        channelId,
        channelType: "messaging",
        humanUserId,
        platform,
        model,
      });
    }

    const manager = getAgentManager();
    const response = await manager.sendMessage({ channelId, text: message });

    return res.json({
      reply: response?.text || "No response from AI",
    });
  } catch (error) {
    console.error("❌ Chat error:", error);
    return res.status(500).json({
      error: "Chat failed",
      reason: error?.message,
    });
  }
});

router.post("/stop-ai-agent", async (req, res) => {
  const channelId = resolveAiChannelId(
    normalizeChannelId(req.body?.channel_id || ""),
    normalizeChannelId(req.body?.user_id || ""),
  );

  if (!channelId) {
    return res.status(400).json({ error: "Missing or invalid channel_id" });
  }

  try {
    const manager = getAgentManager();
    await manager.stopAgent(buildAgentUserId(channelId));
    return res.json({ message: "AI Agent stopped" });
  } catch (error) {
    console.error("❌ Failed to stop AI Agent:", error);
    return res.status(500).json({
      error: "Failed to stop AI Agent",
      reason: error?.message || "Unknown error",
    });
  }
});

router.post("/register-tools", (req, res) => {
  const { channel_id, tools, user_id } = req.body || {};

  const channelId = resolveAiChannelId(
    normalizeChannelId(channel_id),
    normalizeChannelId(user_id || ""),
  );

  if (!channelId) {
    return res.status(400).json({ error: "Missing or invalid channel_id" });
  }

  if (!Array.isArray(tools)) {
    return res.status(400).json({ error: "Missing or invalid tools array" });
  }

  try {
    const manager = getAgentManager();
    manager.registerClientTools(channelId, tools);
    return res.json({
      message: "Client tools registered",
      count: tools.length,
    });
  } catch (error) {
    console.error("❌ Failed to register tools for AI Agent:", error);
    return res.status(500).json({
      error: "Failed to register tools",
      reason: error?.message || "Unknown error",
    });
  }
});

module.exports = router;
