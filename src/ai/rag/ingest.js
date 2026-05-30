const { queues } = require("../../workers/queue");

function postToEmbeddingDoc(post) {
  const userName = [
    post.user?.firstName,
    post.user?.lastName,
    post.user?.nickName,
    post.user?.companyName,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    entityType: "post",
    entityId: String(post._id),
    text: [post.caption, post.quote].filter(Boolean).join("\n"),
    county: post.levelType === "county" ? post.levelValue : undefined,
    topics: post.aiTopics || [],
    metadata: {
      title: post.caption?.slice(0, 80),
      author: userName,
      levelType: post.levelType,
      levelValue: post.levelValue,
      createdAt: post.createdAt,
    },
  };
}

function commentToEmbeddingDoc(comment) {
  return {
    entityType: "comment",
    entityId: String(comment._id),
    text: comment.text,
    metadata: {
      postId: String(comment.postId),
      authorId: comment.userId,
      createdAt: comment.createdAt,
    },
  };
}

function newsToEmbeddingDoc(news) {
  return {
    entityType: "news",
    entityId: String(news._id),
    text: [news.title, news.content].filter(Boolean).join("\n"),
    metadata: {
      title: news.title,
      createdAt: news.createdAt,
    },
  };
}

async function enqueueEmbedding(doc) {
  if (!doc?.text?.trim()) return null;
  return queues.embeddings.add("embed", doc, {
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
  });
}

module.exports = {
  commentToEmbeddingDoc,
  enqueueEmbedding,
  newsToEmbeddingDoc,
  postToEmbeddingDoc,
};
