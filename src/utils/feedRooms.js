const kenyaData = require("../assets/iebc.json");

const getRoomName = (levelType, levelValue) =>
  `level-${levelType}-${levelValue || "all"}`;

function findCountyByConstituency(constituencyName) {
  for (const county of kenyaData.counties || []) {
    const match = county.constituencies?.find((c) => c.name === constituencyName);
    if (match) return { county, constituency: match };
  }
  return null;
}

function findParentsForWard(wardName) {
  for (const county of kenyaData.counties || []) {
    for (const constituency of county.constituencies || []) {
      const ward = constituency.wards?.find((w) => w.name === wardName);
      if (ward) {
        return { county, constituency, ward };
      }
    }
  }
  return null;
}

/** Rooms a viewer at this feed level should join (matches GET /posts scope). */
function getFeedRoomsForViewer(levelType, levelValue) {
  const rooms = new Set();

  if (!levelType) return [];

  if (levelType === "organization") {
    rooms.add(getRoomName("organization", levelValue));
    return [...rooms];
  }

  rooms.add(getRoomName(levelType, levelValue));

  switch (levelType) {
    case "home":
      rooms.add(getRoomName("home", "all"));
      break;

    case "county": {
      const county = kenyaData.counties?.find((c) => c.name === levelValue);
      if (county?.constituencies) {
        for (const constituency of county.constituencies) {
          rooms.add(getRoomName("constituency", constituency.name));
        }
      }
      break;
    }

    case "constituency": {
      for (const county of kenyaData.counties || []) {
        const constituency = county.constituencies?.find(
          (c) => c.name === levelValue,
        );
        if (constituency?.wards) {
          for (const ward of constituency.wards) {
            rooms.add(getRoomName("ward", ward.name));
          }
          break;
        }
      }
      break;
    }

    default:
      break;
  }

  return [...rooms];
}

/** Rooms that should receive a new/updated post (inverse of feed visibility). */
function getBroadcastRoomsForPost(levelType, levelValue) {
  const rooms = new Set();

  if (!levelType) return [];

  rooms.add(getRoomName(levelType, levelValue));

  if (levelType === "home" || levelType === "county") {
    rooms.add(getRoomName("home", "all"));
  }

  if (levelType === "constituency") {
    const found = findCountyByConstituency(levelValue);
    if (found?.county) {
      rooms.add(getRoomName("county", found.county.name));
      rooms.add(getRoomName("home", "all"));
    }
  }

  if (levelType === "ward") {
    const parents = findParentsForWard(levelValue);
    if (parents?.constituency) {
      rooms.add(getRoomName("constituency", parents.constituency.name));
    }
    if (parents?.county) {
      rooms.add(getRoomName("county", parents.county.name));
      rooms.add(getRoomName("home", "all"));
    }
  }

  return [...rooms];
}

module.exports = {
  getRoomName,
  getFeedRoomsForViewer,
  getBroadcastRoomsForPost,
};
