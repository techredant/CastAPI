# BroadCast AI Services

Phase 1 is the Civic Core: RAG assistant, AI feed ranking, moderation, and semantic search.

## Structure

- `providers/`: vendor wrappers for LLM, embeddings, Deepgram, and future media moderation.
- `prompts/`: versioned system prompts. Edit prompts as code and review diffs carefully.
- `rag/`: ingestion and retrieval. `retrieve.js` combines Atlas Vector Search and Mongo text search with reciprocal-rank fusion.
- `civic/`: civic assistant orchestration and tool lookups for politicians/county data.
- `moderation/`: quick preflight, LLM judge, action application, and case persistence.
- `ranking/`: feature extraction, scoring, and diversification for the AI feed.
- `search/`: hybrid search and AI answer synthesis with citations.

## Adding a RAG Source

1. Add a Mongoose post-save hook or background job.
2. Convert the document to `{ entityType, entityId, text, county, topics, metadata }`.
3. Call `enqueueEmbedding()` from `rag/ingest.js`.
4. Include the new `entityType` in retrieval filters where needed.

## Prompt Safety

All LLM entry points use `providers/llm.js` for prompt sanitization, output filtering, model selection, latency/cost logging, and OpenRouter-compatible requests.

## Vector Index

Create `embedding_vector_index` in MongoDB Atlas on `embeddings.embedding`, 1536 dimensions, cosine similarity, with `entityType` and `county` filter fields.
