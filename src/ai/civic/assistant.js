const fs = require("fs");
const path = require("path");
const { completeChat, sanitizePromptInput, tieredModel } = require("../providers/llm");
const { retrieveContext } = require("../rag/retrieve");
const { findPoliticians, getCountyInfo } = require("./tools");

const systemPrompt = fs.readFileSync(
  path.join(__dirname, "../prompts/civic.system.md"),
  "utf8",
);

function formatSources(items) {
  return items.map((item, index) => ({
    id: `${item.entityType}:${item.entityId}`,
    title: item.metadata?.title || `${item.entityType} source ${index + 1}`,
    entityType: item.entityType,
    entityId: item.entityId,
    excerpt: String(item.text || "").slice(0, 500),
    county: item.county,
    score: item.rrfScore || item.vectorScore || item.score || 0,
  }));
}

async function answerCivicQuestion({
  question,
  userId,
  county,
  language,
  history = [],
}) {
  const cleanQuestion = sanitizePromptInput(question);
  const contextItems = await retrieveContext({
    query: cleanQuestion,
    county,
    entityTypes: ["news", "politician", "manifesto", "post"],
    limit: 8,
  });
  const sources = formatSources(contextItems);
  const [politicians, countyInfo] = await Promise.all([
    findPoliticians({ query: cleanQuestion, county, limit: 5 }),
    Promise.resolve(getCountyInfo(county)),
  ]);

  const response = await completeChat({
    model: tieredModel("civic"),
    feature: "civic_assistant",
    userId,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          question: cleanQuestion,
          preferredLanguage: language || "auto",
          county,
          conversationMemory: history.slice(-8),
          retrievedSources: sources,
          civicTools: {
            politicians,
            countyInfo,
          },
        }),
      },
    ],
    temperature: 0.25,
  });

  return {
    answer: response.text,
    sources,
    model: response.model,
  };
}

module.exports = {
  answerCivicQuestion,
  formatSources,
};
