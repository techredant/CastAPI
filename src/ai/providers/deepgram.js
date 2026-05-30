async function transcribeAudioUrl(audioUrl, options = {}) {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not configured");
  }

  const params = new URLSearchParams({
    model: options.model || "nova-2",
    smart_format: "true",
    paragraphs: "true",
    diarize: options.diarize ? "true" : "false",
    language: options.language || "multi",
  });

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: audioUrl }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Deepgram failed: ${response.status} ${body}`);
  }

  const data = await response.json();
  const transcript =
    data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  return { transcript, raw: data };
}

module.exports = {
  transcribeAudioUrl,
};
