const { createWorker } = require("./queue");
const { moderateTextTarget } = require("../ai/moderation/pipeline");

function startModerationWorker() {
  return createWorker("ai-moderation", async (job) => {
    return moderateTextTarget(job.data);
  });
}

if (require.main === module) {
  startModerationWorker();
}

module.exports = {
  startModerationWorker,
};
