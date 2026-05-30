const { completeChat, sanitizePromptInput, tieredModel } = require("../providers/llm");

async function answerSearch({ query, results, userId }) {
  if (!results.length) {
    return {
      answer: "I could not find enough reliable BroadCast context for that search yet.",
      citations: [],
    };
  }

  const response = await completeChat({
    model: tieredModel("fast"),
    feature: "search_answer",
    userId,
    messages: [
      {
        role: "system",
        content:
          "Answer with a concise neutral summary using only supplied search results. Mention uncertainty when sources are weak.",
      },
      {
        role: "user",
        content: JSON.stringify({
          query: sanitizePromptInput(query),
          results,
        }),
      },
    ],
    temperature: 0.2,
  });

  return {
    answer: response.text,
    citations: results.slice(0, 5).map((item) => item.id),
  };
}

module.exports = {
  answerSearch,
};
