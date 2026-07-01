require("dotenv").config();

const providerKey = process.env.CROO_SDK_KEY || process.env.CROO_API_KEY;
const alphaKey = process.env.ALPHASWAP_SDK_KEY;
const targetService = process.env.CROO_TARGET_SERVICE_ID;

console.log({
  providerKey: Boolean(providerKey),
  alphaKey: Boolean(alphaKey),
  targetService: Boolean(targetService),
  sameKey: providerKey === alphaKey,
  providerKeyPreview: providerKey ? providerKey.slice(0, 8) + "..." + providerKey.slice(-4) : "missing",
  alphaKeyPreview: alphaKey ? alphaKey.slice(0, 8) + "..." + alphaKey.slice(-4) : "missing",
});
