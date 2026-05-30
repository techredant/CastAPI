const User = require("../../models/user");
const PoliticianProfile = require("../../models/politicianProfile");
const kenyaData = require("../../assets/iebc.json");

async function findPoliticians({ query, county, limit = 5 }) {
  const filters = {};
  if (county) filters.county = county;
  if (query) filters.$text = { $search: query };

  const profiles = await PoliticianProfile.find(filters)
    .sort(query ? { score: { $meta: "textScore" } } : { popularityIndex: -1 })
    .limit(limit)
    .lean();

  if (profiles.length) return profiles;

  return User.find({
    accountType: { $in: ["politician", "government", "official"] },
    ...(county ? { county } : {}),
    ...(query
      ? {
          $or: [
            { firstName: new RegExp(query, "i") },
            { lastName: new RegExp(query, "i") },
            { nickName: new RegExp(query, "i") },
            { companyName: new RegExp(query, "i") },
          ],
        }
      : {}),
  })
    .select("clerkId firstName lastName nickName companyName county constituency ward isVerified verificationType")
    .limit(limit)
    .lean();
}

function getCountyInfo(countyName) {
  if (!countyName) return null;
  const county = kenyaData.counties.find(
    (item) => item.name.toLowerCase() === String(countyName).toLowerCase(),
  );
  if (!county) return null;
  return {
    name: county.name,
    constituencies: county.constituencies.map((item) => ({
      name: item.name,
      wards: item.wards.map((ward) => ward.name),
    })),
  };
}

module.exports = {
  findPoliticians,
  getCountyInfo,
};
