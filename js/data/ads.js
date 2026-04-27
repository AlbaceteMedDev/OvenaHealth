// Mock Meta Marketing data. Six campaigns split across audiences and angles
// so the Ads tab can demonstrate "which audience/angle/campaign wins".
// Daily breakdown per campaign for the last 90 days.

const DAYS = 90;
const SEED = 0xa11c0;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// audience + angle combinations with characteristic performance profiles.
// CPM / CTR / CVR vary so analysis surfaces real differences.
const campaignDefs = [
  {
    id: "cmp-001",
    name: "Wound Care — Clinical Authority",
    audience: "Wound Care Pros",
    angle: "Clinical Authority",
    objective: "Conversions",
    dailyBudget: 220,
    profile: { cpm: 18, ctr: 0.024, cvr: 0.052, aov: 58 },
  },
  {
    id: "cmp-002",
    name: "Compression — Athletic Recovery",
    audience: "Active Compression",
    angle: "Athletic Recovery",
    objective: "Conversions",
    dailyBudget: 180,
    profile: { cpm: 14, ctr: 0.031, cvr: 0.038, aov: 41 },
  },
  {
    id: "cmp-003",
    name: "Caregiver Reassurance",
    audience: "Senior Caregivers",
    angle: "Caregiver Reassurance",
    objective: "Conversions",
    dailyBudget: 160,
    profile: { cpm: 12, ctr: 0.018, cvr: 0.045, aov: 52 },
  },
  {
    id: "cmp-004",
    name: "Diabetic Wellness — Compression",
    audience: "Diabetic Care",
    angle: "Diabetic Wellness",
    objective: "Conversions",
    dailyBudget: 140,
    profile: { cpm: 11, ctr: 0.027, cvr: 0.061, aov: 48 },
  },
  {
    id: "cmp-005",
    name: "Lookalike — Nurses LAL",
    audience: "Nurses Lookalike",
    angle: "Clinical Authority",
    objective: "Traffic",
    dailyBudget: 120,
    profile: { cpm: 9, ctr: 0.022, cvr: 0.029, aov: 44 },
  },
  {
    id: "cmp-006",
    name: "Retention — Existing Customers",
    audience: "Existing Customers",
    angle: "Lifestyle Comfort",
    objective: "Conversions",
    dailyBudget: 80,
    profile: { cpm: 7, ctr: 0.041, cvr: 0.082, aov: 56 },
  },
];

function buildDays(rand, def) {
  const days = [];
  const now = Date.now();
  for (let d = 0; d < DAYS; d++) {
    const dayStart = new Date(now - (DAYS - 1 - d) * 86400000);
    dayStart.setUTCHours(0, 0, 0, 0);

    // Light upward trend + weekend dip + noise.
    const trend = 0.85 + (d / DAYS) * 0.35;
    const dow = dayStart.getUTCDay();
    const weekend = dow === 0 || dow === 6 ? 0.7 : 1;
    const noise = 0.8 + rand() * 0.45;
    const factor = trend * weekend * noise;

    const spend = +(def.dailyBudget * factor).toFixed(2);
    const impressions = Math.round((spend / def.profile.cpm) * 1000);
    const ctrJitter = def.profile.ctr * (0.85 + rand() * 0.3);
    const clicks = Math.round(impressions * ctrJitter);
    const cvrJitter = def.profile.cvr * (0.8 + rand() * 0.4);
    const conversions = Math.round(clicks * cvrJitter);
    const aovJitter = def.profile.aov * (0.9 + rand() * 0.2);
    const revenue = +(conversions * aovJitter).toFixed(2);

    days.push({
      date: dayStart.toISOString(),
      spend,
      impressions,
      clicks,
      conversions,
      revenue,
    });
  }
  return days;
}

function buildCampaigns() {
  const rand = mulberry32(SEED);
  return campaignDefs.map((def) => ({
    id: def.id,
    name: def.name,
    audience: def.audience,
    angle: def.angle,
    objective: def.objective,
    dailyBudget: def.dailyBudget,
    days: buildDays(rand, def),
  }));
}

export const mockCampaigns = buildCampaigns();

export function totalsFor(campaign) {
  return campaign.days.reduce(
    (acc, d) => {
      acc.spend += d.spend;
      acc.impressions += d.impressions;
      acc.clicks += d.clicks;
      acc.conversions += d.conversions;
      acc.revenue += d.revenue;
      return acc;
    },
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
  );
}

export function deriveMetrics(t) {
  const ctr = t.impressions > 0 ? t.clicks / t.impressions : 0;
  const cvr = t.clicks > 0 ? t.conversions / t.clicks : 0;
  const cpc = t.clicks > 0 ? t.spend / t.clicks : 0;
  const cpa = t.conversions > 0 ? t.spend / t.conversions : 0;
  const roas = t.spend > 0 ? t.revenue / t.spend : 0;
  return { ctr, cvr, cpc, cpa, roas };
}
