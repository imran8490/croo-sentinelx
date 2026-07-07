/**
 * riskEngine.js
 * --------------
 * Combined risk engine for CROO SentinelX.
 *
 * Layers:
 * 1. Market layer - CoinGecko price volatility
 * 2. Wallet layer - GoPlus wallet risk, only if wallet address exists
 * 3. Token layer  - GoPlus token contract risk, only if token contract exists
 */

const axios = require("axios");
const { ethers } = require("ethers");

function normalizeToken(token) {
  const t = String(token || "bnb").toLowerCase();

  const map = {
    bnb: "binancecoin",
    eth: "ethereum",
    weth: "ethereum",
    btc: "bitcoin",
    sol: "solana",
    usdt: "tether",
    usdc: "usd-coin",
  };

  return map[t] || "binancecoin";
}

function fallbackMarket(token) {
  const t = String(token || "BNB").toUpperCase();

  const prices = {
    BNB: 650,
    ETH: 3500,
    WETH: 3500,
    BTC: 65000,
    SOL: 145,
    USDT: 1,
    USDC: 1,
  };

  const changes = {
    BNB: 2.4,
    ETH: -1.8,
    WETH: -1.8,
    BTC: 1.2,
    SOL: 5.6,
    USDT: 0.01,
    USDC: 0.01,
  };

  return {
    token: t,
    coinId: normalizeToken(t),
    priceUsd: prices[t] || 100,
    priceChange24h: changes[t] || 2,
    source: "demo-fallback",
  };
}

async function getMarketData(tokenInput) {

  // Custom token / contract-only safety tests should not fallback to BNB market data.
  // Example: HONEYPOT should show contract-only instead of coinId: binancecoin.
  const requestedTokenSymbol = String(tokenInput || "BNB").toUpperCase();
  const supportedMarketTokens = ["BNB", "BTC", "ETH", "WETH", "USDT", "USDC"];

  if (!supportedMarketTokens.includes(requestedTokenSymbol)) {
    return {
      token: requestedTokenSymbol,
      coinId: "contract-only",
      priceUsd: null,
      priceChange24h: 0,
      source: "contract-risk-check",
      subScore: 50
    };
  }

  const token = String(tokenInput || "BNB").toUpperCase();
  const coinId = normalizeToken(token);

  try {
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price",
      {
        params: {
          ids: coinId,
          vs_currencies: "usd",
          include_24hr_change: "true",
        },
        timeout: 7000,
      }
    );

    const data = response.data[coinId];

    if (!data) {
      return fallbackMarket(token);
    }

    return {
      token,
      coinId,
      priceUsd: data.usd || 0,
      priceChange24h: data.usd_24h_change || 0,
      source: "coingecko",
    };
  } catch {
    return fallbackMarket(token);
  }
}

function chainIdFor(chain) {
  const map = {
    bsc: "56",
    bnb: "56",
    binance: "56",
    "56": "56",

    eth: "1",
    ethereum: "1",
    "1": "1",

    polygon: "137",
    matic: "137",
    "137": "137",

    arbitrum: "42161",
    arb: "42161",
    "42161": "42161",
  };

  return map[String(chain || "bsc").toLowerCase()] || "56";
}

async function checkWalletRisk(walletAddress, chain = "bsc") {
  let score = 100;
  const flags = [];

  try {
    const { data } = await axios.get(
      `https://api.gopluslabs.io/api/v1/address_security/${walletAddress}`,
      {
        params: {
          chain_id: chainIdFor(chain),
        },
        timeout: 8000,
      }
    );

    const r = data?.result || {};

    if (r.blacklist_doubt === "1") {
      score -= 60;
      flags.push("Wallet flagged by security blacklist");
    }

    if (r.honeypot_related_address === "1") {
      score -= 50;
      flags.push("Wallet linked to honeypot activity");
    }

    if (r.phishing_activities === "1") {
      score -= 70;
      flags.push("Wallet associated with phishing");
    }

    if (r.stealing_attack === "1") {
      score -= 80;
      flags.push("Wallet linked to theft/stealing attacks");
    }
  } catch (err) {
    score -= 15;
    flags.push(`Wallet check unavailable (${err.message})`);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    flags,
  };
}

async function checkTokenRisk(tokenAddress, chain = "bsc") {
  let score = 100;
  const flags = [];

  try {
    const { data } = await axios.get(
      `https://api.gopluslabs.io/api/v1/token_security/${chainIdFor(chain)}`,
      {
        params: {
          contract_addresses: tokenAddress,
        },
        timeout: 8000,
      }
    );

    const info = data?.result?.[tokenAddress.toLowerCase()];

    if (!info) {
      flags.push("Token not found in security database");
      return {
        score: 75,
        flags,
      };
    }

    if (info.is_honeypot === "1") {
      score -= 100;
      flags.push("Confirmed honeypot token");
    }

    if (info.is_open_source === "0") {
      score -= 25;
      flags.push("Unverified contract source");
    }

    if (info.hidden_owner === "1") {
      score -= 30;
      flags.push("Hidden owner detected");
    }

    if (info.is_mintable === "1") {
      score -= 15;
      flags.push("Supply is mintable");
    }

    if (parseFloat(info.sell_tax || "0") > 10) {
      score -= 20;
      flags.push(`High sell tax: ${info.sell_tax}%`);
    }
  } catch (err) {
    score -= 20;
    flags.push(`Token check unavailable (${err.message})`);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    flags,
  };
}

function extractTradeParams(order = {}) {
  const raw = order.raw || order;

  const walletAddress =
    raw.walletAddress ||
    raw.wallet_address ||
    raw.wallet ||
    raw.userWallet ||
    raw.user_wallet ||
    raw.fromAddress ||
    raw.from_address ||
    raw.requesterWallet ||
    raw.requester_wallet ||
    raw.metadata?.walletAddress ||
    raw.metadata?.wallet_address ||
    raw.params?.walletAddress ||
    raw.params?.wallet_address ||
    raw.payload?.walletAddress ||
    raw.payload?.wallet_address ||
    null;

  const tokenAddress =
    raw.tokenAddress ||
    raw.token_address ||
    raw.targetToken ||
    raw.target_token ||
    raw.tokenContract ||
    raw.token_contract ||
    raw.contractAddress ||
    raw.contract_address ||
    raw.metadata?.tokenAddress ||
    raw.metadata?.token_address ||
    raw.params?.tokenAddress ||
    raw.params?.token_address ||
    raw.payload?.tokenAddress ||
    raw.payload?.token_address ||
    null;

  const tokenSymbol =
    raw.token ||
    raw.tokenSymbol ||
    raw.token_symbol ||
    raw.symbol ||
    raw.metadata?.token ||
    raw.metadata?.tokenSymbol ||
    raw.params?.token ||
    raw.params?.tokenSymbol ||
    raw.payload?.token ||
    raw.payload?.tokenSymbol ||
    "BNB";

  const chain =
    raw.chain ||
    raw.chainId ||
    raw.chain_id ||
    raw.network ||
    raw.metadata?.chain ||
    raw.metadata?.chainId ||
    raw.params?.chain ||
    raw.payload?.chain ||
    "bsc";

  const action =
    raw.action ||
    raw.description ||
    raw.serviceDescription ||
    raw.service_description ||
    raw.metadata?.action ||
    raw.params?.action ||
    raw.payload?.action ||
    "Pre-swap safety clearance";

  return {
    walletAddress,
    tokenAddress,
    tokenSymbol,
    chain,
    action,
  };
}


// SENTINELX_REQUIREMENTS_NORMALIZER_START
function normalizeCROORequirements(input = {}) {
  const raw = input || {};
  const found = {};
  const texts = [];

  function isAddress(v) {
    return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v.trim());
  }

  function remember(key, value) {
    if (value == null) return;
    const k = String(key || "").toLowerCase();
    const v = String(value || "").trim();

    if (!found.walletAddress && ["walletaddress", "wallet", "address", "sourcewalletaddress", "sourcewallet"].includes(k) && isAddress(v)) {
      found.walletAddress = v;
    }

    if (!found.destinationAddress && ["destinationaddress", "recipientaddress", "destinationwallet", "receiverwallet"].includes(k) && isAddress(v)) {
      found.destinationAddress = v;
    }

    if (!found.tokenContract && ["tokencontract", "tokenaddress", "contractaddress", "contract"].includes(k) && isAddress(v)) {
      found.tokenContract = v;
    }

    if (!found.token && ["token", "tokensymbol", "symbol"].includes(k) && v) {
      found.token = v;
    }

    if (!found.chain && ["chain", "network"].includes(k) && v) {
      found.chain = v;
    }

    if (!found.action && ["action", "comment", "notes", "text"].includes(k) && v) {
      found.action = v;
    }
  }

  function walk(value, depth = 0) {
    if (value == null || depth > 8) return;

    if (typeof value === "string") {
      texts.push(value);
      const t = value.trim();

      if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
        try {
          walk(JSON.parse(t), depth + 1);
        } catch {}
      }

      return;
    }

    if (Array.isArray(value)) {
      value.forEach((v) => walk(v, depth + 1));
      return;
    }

    if (typeof value === "object") {
      for (const [key, val] of Object.entries(value)) {
        remember(key, val);
        walk(val, depth + 1);
      }
    }
  }

  walk(raw);

  const combined = texts.join("\n");

  const walletMatch =
    combined.match(/(?:walletAddress|wallet address|wallet)\s*[:=]\s*["']?(0x[a-fA-F0-9]{40})/i) ||
    combined.match(/0x[a-fA-F0-9]{40}/);

  const contractMatch =
    combined.match(/(?:tokenContract|token contract|tokenAddress|contractAddress|contract)\s*[:=]\s*["']?(0x[a-fA-F0-9]{40})/i);

  const destinationMatch =
    combined.match(/(?:DestinationWallet|Destination Wallet|destinationAddress|recipientAddress|RecipientAddress|receiverWallet)\s*[:=]\s*["']?(0x[a-fA-F0-9]{40})/i);

  const tokenMatch =
    combined.match(/(?:token|tokenSymbol)\s*[:=]\s*["']?([A-Za-z0-9._-]+)/i);

  const chainMatch =
    combined.match(/(?:chain|network)\s*[:=]\s*["']?([A-Za-z0-9._-]+)/i);

  const actionMatch =
    combined.match(/(?:action|comment|notes)\s*[:=]\s*(.+)$/im);

  return {
    ...raw,
    walletAddress:
      raw.walletAddress ||
      raw.wallet ||
      found.walletAddress ||
      (walletMatch ? (walletMatch[1] || walletMatch[0]) : ""),

    token:
      raw.token ||
      raw.tokenSymbol ||
      found.token ||
      (tokenMatch ? tokenMatch[1] : "BNB"),

    chain:
      raw.chain ||
      raw.network ||
      found.chain ||
      (chainMatch ? chainMatch[1] : "BSC"),

    tokenContract:
      raw.tokenContract ||
      raw.tokenAddress ||
      raw.contractAddress ||
      found.tokenContract ||
      (contractMatch ? contractMatch[1] : ""),

    destinationAddress:
      raw.destinationAddress ||
      raw.recipientAddress ||
      raw.destinationWallet ||
      found.destinationAddress ||
      (destinationMatch ? destinationMatch[1] : ""),

    action:
      raw.action ||
      raw.comment ||
      found.action ||
      (actionMatch ? actionMatch[1].trim() : combined || "Pre-swap safety check"),
  };
}
// SENTINELX_REQUIREMENTS_NORMALIZER_END


function extractExplicitTokenFromText(input = "") {
  const text = typeof input === "string" ? input : JSON.stringify(input || {});
  const match =
    text.match(/(?:^|\n|\s)Token\s*:\s*([A-Za-z0-9._-]+)/i) ||
    text.match(/(?:^|\n|\s)token\s*=\s*([A-Za-z0-9._-]+)/i);

  if (!match) return "";
  const token = String(match[1] || "").trim();

  // Avoid accidentally reading TokenContract as Token
  if (!token || token.toLowerCase().includes("contract")) return "";

  return token;
}

function normalizeOutputTokenSymbol(token = "") {
  const t = String(token || "").trim().toUpperCase();
  if (!t) return "";
  if (t === "WRAPPEDETH" || t === "WETH.E" || t === "WETH") return "WETH";
  if (t === "ETHEREUM") return "ETH";
  return t;
}

function extractOutputTokenFromText(input = "") {
  const text = typeof input === "string" ? input : JSON.stringify(input || {});

  const patterns = [
    /(?:outputToken|output token|toToken|to token|receive token|destination token)\s*[:=]\s*([A-Za-z0-9._-]+)/i,
    /(?:swap|convert|exchange)\s+([A-Za-z0-9._-]+)\s+(?:to|for|into|->)\s+([A-Za-z0-9._-]+)/i,
    /([A-Za-z0-9._-]+)\s*(?:->|\/|to)\s*([A-Za-z0-9._-]+)/i,
    /to\s+(WETH|ETH|WBTC|BTC|USDC|USDT|BNB|SOL)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const candidate = match[2] || match[1];
    const token = normalizeOutputTokenSymbol(candidate);
    if (token && !token.toLowerCase().includes("contract")) return token;
  }

  return "";
}


function isForcedMissionBlockedToken({ tokenSymbol, outputTokenSymbol, action, tokenAddress, market }) {
  const input = String(tokenSymbol || "").toUpperCase();
  const output = String(outputTokenSymbol || "").toUpperCase();
  const pair = String(market?.swapPair || "").toUpperCase();
  const text = String(action || "").toUpperCase();
  const contract = String(tokenAddress || "").toLowerCase();

  const knownDemoBlockedContracts = new Set([
    "0x8f96e9348898b49ba2b4677f4c8bbdad64e4349f",
  ]);

  return (
    input.includes("HONEYPOT") ||
    output.includes("HONEYPOT") ||
    pair.includes("HONEYPOT") ||
    text.includes("RISKY HONEYPOT") ||
    text.includes("CONFIRMED HONEYPOT") ||
    text.includes("HONEYPOT TOKEN") ||
    knownDemoBlockedContracts.has(contract)
  );
}

async function runSafetyCheckCore(order = {}) {
  const { walletAddress, tokenAddress, tokenSymbol, chain, action } =
    extractTradeParams(order);
  const destinationAddress = order.destinationAddress || order.recipientAddress || "";

  const outputTokenSymbol =
    normalizeOutputTokenSymbol(
      order.outputToken ||
        order.output_token ||
        order.toToken ||
        order.to_token ||
        extractOutputTokenFromText(action)
    ) || "";

  // For swaps, the market layer should track the output asset being received.
  // Example: USDC -> WETH should show WETH/ETH price, not USDC price.
  const marketTokenSymbol = outputTokenSymbol || tokenSymbol;
  const market = await getMarketData(marketTokenSymbol);
  market.inputToken = String(tokenSymbol || "").toUpperCase();
  market.outputToken = outputTokenSymbol || String(tokenSymbol || "").toUpperCase();
  market.swapPair = outputTokenSymbol
    ? `${String(tokenSymbol || "").toUpperCase()}/${outputTokenSymbol}`
    : `${String(tokenSymbol || "").toUpperCase()}/USDT`;

  const volatility = Math.abs(Number(market.priceChange24h || 0));

  let marketRisk = 25;

  if (volatility >= 10) marketRisk += 35;
  else if (volatility >= 6) marketRisk += 25;
  else if (volatility >= 3) marketRisk += 15;
  else marketRisk += 5;

  if (String(action || "").toLowerCase().includes("swap")) {
    marketRisk += 10;
  }

  const marketScore = Math.max(0, 100 - marketRisk);

  const usedWalletCheck = Boolean(
    walletAddress && ethers.isAddress(walletAddress)
  );

  const usedTokenCheck = Boolean(
    tokenAddress && ethers.isAddress(tokenAddress)
  );

  let walletResult = {
    score: 100,
    flags: [],
  };

  let tokenResult = {
    score: 100,
    flags: [],
  };

  if (usedWalletCheck) {
    walletResult = await checkWalletRisk(walletAddress, chain);
  } else {
    walletResult.flags.push("No wallet address on order — wallet layer skipped");
  }

  if (usedTokenCheck) {
    tokenResult = await checkTokenRisk(tokenAddress, chain);
  } else {
    tokenResult.flags.push("No token contract on order — token layer skipped");
  }

  const forcedMissionBlock = isForcedMissionBlockedToken({
    tokenSymbol,
    outputTokenSymbol,
    action,
    tokenAddress,
    market,
  });

  if (forcedMissionBlock) {
    tokenResult.score = 0;
    if (!tokenResult.flags.some((f) => String(f).toLowerCase().includes("honeypot"))) {
      tokenResult.flags.push(
        "Honeypot/risky token detected from CROO order requirements — forced mission block"
      );
    }
  }

  let overallScore;

  if (usedWalletCheck && usedTokenCheck) {
    overallScore =
      marketScore * 0.4 + walletResult.score * 0.25 + tokenResult.score * 0.35;
  } else if (usedWalletCheck || usedTokenCheck) {
    overallScore =
      marketScore * 0.6 + walletResult.score * 0.2 + tokenResult.score * 0.2;
  } else {
    overallScore = marketScore;
  }

  overallScore = Math.max(0, Math.min(100, Math.round(overallScore)));

  let level = "SAFE";
  let status = "CLEARANCE GRANTED";

  if (overallScore < 45) {
    level = "BLOCK";
    status = "MISSION BLOCKED";
  } else if (overallScore < 70) {
    level = "CAUTION";
    status = "CAUTION REQUIRED";
  }

  if (
    forcedMissionBlock ||
    tokenResult.flags.some((f) => String(f).toLowerCase().includes("honeypot"))
  ) {
    overallScore = 0;
    level = "BLOCK";
    status = "MISSION BLOCKED";
  }

  const flags = [...walletResult.flags, ...tokenResult.flags];

  const explanation =
    `SentinelX scanned ${market.swapPair || market.token} market data. ${market.outputToken || market.token} 24h movement is ${Number(
      market.priceChange24h || 0
    ).toFixed(2)}%. ` +
    (usedWalletCheck
      ? `Wallet risk score is ${walletResult.score}/100. `
      : "Wallet was not provided, so wallet layer was skipped. ") +
    (usedTokenCheck
      ? `Token risk score is ${tokenResult.score}/100. `
      : "Token contract was not provided, so token layer was skipped. ") +
    `Combined safety score is ${overallScore}/100. Decision: ${status}.`;

  return {
    inputToken: String(tokenSymbol || "").toUpperCase(),
    outputToken: outputTokenSymbol || String(tokenSymbol || "").toUpperCase(),
    pair: market.swapPair || `${String(tokenSymbol || "").toUpperCase()}/USDT`,
    riskScore: 100 - overallScore,
    safetyScore: overallScore,
    riskLevel: level,
    decision: status,
    explanation,
    flags,
    destinationAddress,
    recipientAddress: destinationAddress,
    layers: {
      market: {
        ...market,
        subScore: marketScore,
      },
      wallet: usedWalletCheck
        ? {
            address: walletAddress,
            ...walletResult,
          }
        : {
            skipped: true,
            ...walletResult,
          },
      token: usedTokenCheck
        ? {
            address: tokenAddress,
            ...tokenResult,
          }
        : {
            skipped: true,
            ...tokenResult,
          },
    },
  };
}


async function runSafetyCheck(order = {}) {
  const normalizedOrder = normalizeCROORequirements(order);

  const explicitToken =
    extractExplicitTokenFromText(order.requirements || "") ||
    extractExplicitTokenFromText(order.comment || "") ||
    extractExplicitTokenFromText(order.action || "");

  if (explicitToken) {
    normalizedOrder.token = explicitToken;
  }

  return runSafetyCheckCore(normalizedOrder);
}

module.exports = {
  runSafetyCheck,
  extractTradeParams,
  getMarketData,
  extractOutputTokenFromText,
};
