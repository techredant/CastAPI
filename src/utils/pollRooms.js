const {
  getRoomName,
  getFeedRoomsForViewer,
  getBroadcastRoomsForPost,
} = require("./feedRooms");

const NATIONAL_POLL_ROOM = "poll-national-Kenya";

function pollRoomName(levelType, levelValue) {
  return `poll-${levelType}-${levelValue || "all"}`;
}

/** Rooms clients join for real-time poll updates at this geography. */
function getPollRoomsForViewer(levelType, levelValue) {
  const rooms = new Set([NATIONAL_POLL_ROOM]);
  for (const room of getFeedRoomsForViewer(levelType, levelValue)) {
    const [, type, ...rest] = room.split("-");
    if (type) {
      const value = rest.join("-");
      rooms.add(pollRoomName(type, value));
    }
  }
  if (levelType) {
    rooms.add(pollRoomName(levelType, levelValue));
  }
  return [...rooms];
}

/** Rooms that receive a new/updated poll (mirrors post visibility + national). */
function getPollBroadcastRooms(levelType, levelValue) {
  const rooms = new Set([NATIONAL_POLL_ROOM]);
  for (const room of getBroadcastRoomsForPost(levelType, levelValue)) {
    const parts = room.replace(/^level-/, "").split("-");
    const type = parts[0];
    const value = parts.slice(1).join("-");
    rooms.add(pollRoomName(type, value));
  }
  rooms.add(pollRoomName(levelType, levelValue));
  if (levelType === "national") {
    rooms.add(NATIONAL_POLL_ROOM);
  }
  return [...rooms];
}

function livePollRoom(callId) {
  return callId ? `poll-live-${callId}` : null;
}

module.exports = {
  NATIONAL_POLL_ROOM,
  pollRoomName,
  getPollRoomsForViewer,
  getPollBroadcastRooms,
  livePollRoom,
};
