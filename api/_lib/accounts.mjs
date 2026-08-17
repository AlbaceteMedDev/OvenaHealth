// Which Catchr sources the sync job pulls from.
//
// These ids come from the Catchr workspace (Sources → each connection).
// They are not secret — the API key is the only credential — so they live
// in code where they're reviewable, with env overrides for when accounts
// change or a second workspace is added.
//
// NOTE: Amazon Ads is currently authorized twice in Catchr (authorization
// 50417 and 50731, identical account lists). We pull from 50731 only.
// Pulling both would double-count every dollar of spend. Delete the spare
// in Catchr → Sources; see docs/CATCHR_GOOGLE_ADS.md.

function envList(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Only US is synced by default. CA / MX / BR are authorized in Catchr but
// have no sales yet, and mixing currencies into one table without an FX
// step would silently corrupt revenue totals. Add them here once there is
// something to report — and add a currency conversion when you do.
export const SELLER_ACCOUNTS = envList("CATCHR_SELLER_ACCOUNTS", [
  { id: "ATVPDKIKX0DER", authorization_id: 50416, marketplace: "ATVPDKIKX0DER", currency: "USD", label: "Amazon.com" },
]);

export const AMAZON_ADS_ACCOUNTS = envList("CATCHR_AMAZON_ADS_ACCOUNTS", [
  { id: "1629425962343035", authorization_id: 50731, currency: "USD", label: "Ovena Health - US" },
]);

export const FACEBOOK_ADS_ACCOUNTS = envList("CATCHR_FACEBOOK_ADS_ACCOUNTS", [
  { id: "2350121318816690", authorization_id: 50732, currency: "USD", label: "Ovenahealth's ad account" },
  { id: "1551121706379904", authorization_id: 50732, currency: "USD", label: "Ovena H" },
]);

// Connected 2026-08-12. Verified returning data: 4 campaigns
// (Generic | Wound Care, Generic | Compression, Competitor, Brand).
export const GOOGLE_ADS_ACCOUNTS = envList("CATCHR_GOOGLE_ADS_ACCOUNTS", [
  { id: "3661776495", authorization_id: 50769, currency: "USD", label: "Ovena Health" },
]);

// Merchant Center. Connected 2026-08-12. Feed health is pulled so the
// Google tab can't show ad spend without showing whether Shopping is
// actually able to serve — this account was suspended when it was hooked up.
export const MERCHANT_CENTER_ACCOUNTS = envList("CATCHR_MERCHANT_CENTER_ACCOUNTS", [
  { id: "5787103589", authorization_id: 50771, label: "Ovena Health" },
]);

// Google Search Console. Empty until the property is authorised in Catchr
// (Sources -> Google Search Console); the sync reports that plainly rather
// than failing. Set CATCHR_SEARCH_CONSOLE_ACCOUNTS once connected:
//   [{"id":"sc-domain:ovenahealth.com","authorization_id":00000}]
export const SEARCH_CONSOLE_ACCOUNTS = envList("CATCHR_SEARCH_CONSOLE_ACCOUNTS", []);

export const AD_PLATFORMS = [
  { platform: "amazon-ads", accounts: AMAZON_ADS_ACCOUNTS, perSku: true },
  { platform: "facebook-ads", accounts: FACEBOOK_ADS_ACCOUNTS, perSku: false },
  { platform: "google-ads", accounts: GOOGLE_ADS_ACCOUNTS, perSku: false },
];
