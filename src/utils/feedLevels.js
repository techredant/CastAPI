const kenyaData = require("../assets/iebc.json");

function findConstituency(constituencyName) {
  for (const county of kenyaData.counties || []) {
    const constituency = county.constituencies?.find(
      (c) => c.name === constituencyName,
    );
    if (constituency) return { county, constituency };
  }
  return null;
}

function findWard(wardName) {
  for (const county of kenyaData.counties || []) {
    for (const constituency of county.constituencies || []) {
      const ward = constituency.wards?.find((w) => w.name === wardName);
      if (ward) return { county, constituency, ward };
    }
  }
  return null;
}

/**
 * Which post levelTypes/levelValues appear in a viewer's feed.
 * National (home): home + county only.
 * County: county + constituencies in that county (no wards).
 * Constituency: constituency + wards in that constituency.
 * Ward: ward only.
 */
function getRelatedLevels(levelType, levelValue) {
  switch (levelType) {
    case "home":
      return {
        levelTypes: ["home", "county"],
        levelValues: null,
      };

    case "county": {
      const county = kenyaData.counties?.find((c) => c.name === levelValue);
      if (!county) return { levelTypes: [], levelValues: [] };
      const constituencyNames = (county.constituencies || []).map((c) => c.name);
      return {
        levelTypes: ["county", "constituency"],
        levelValues: [county.name, ...constituencyNames],
      };
    }

    case "constituency": {
      const found = findConstituency(levelValue);
      if (!found) return { levelTypes: [], levelValues: [] };
      const wardNames = (found.constituency.wards || []).map((w) => w.name);
      return {
        levelTypes: ["constituency", "ward"],
        levelValues: [found.constituency.name, ...wardNames],
      };
    }

    case "ward":
      return {
        levelTypes: ["ward"],
        levelValues: [levelValue],
      };

    default:
      return {
        levelTypes: [levelType],
        levelValues: levelValue ? [levelValue] : [],
      };
  }
}

module.exports = {
  getRelatedLevels,
  findConstituency,
  findWard,
};
