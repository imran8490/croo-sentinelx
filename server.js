require("dotenv").config();


const express = require("express");
const { registerExecuteOrderRoute } = require("./executeOrderRoute");
const cors = require("cors");
const axios = require("axios");
const { ethers } = require("ethers");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");


const app = express();
const PORT = process.env.PORT || 8000;


app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));


// Demo memory storage
const proofLogs = [];
const agentCallLogs = [];
const capOrders = [];


// Local CROO real-order sync storage
const DATA_DIR = path.join(__dirname, "data");
const CROO_ORDERS_FILE = path.join(DATA_DIR, "croo-orders.json");
const { runSafetyCheck } = require("./riskEngine");


if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}


function readCrooOrders() {
  try {
    if (!fs.existsSync(CROO_ORDERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(CROO_ORDERS_FILE, "utf8"));
  } catch {
    return [];
  }
}


function saveCrooOrders(orders) {
  fs.writeFileSync(CROO_ORDERS_FILE, JSON.stringify(orders, null, 2));
}


// -----------------------------
// CROO / CAP Config Status
// -----------------------------
function getCrooConfigStatus() {
  const sdkKey = process.env.CROO_SDK_KEY || process.env.CROO_API_KEY || "";


  return {
    apiUrl: process.env.CROO_API_URL || "https://api.croo.network",
    wsUrl: process.env.CROO_WS_URL || "wss://api.croo.network/ws",
    sdkKeyConfigured: Boolean(sdkKey),
    agentWallet: process.env.CROO_AGENT_WALLET || "",
    agentId: process.env.CROO_AGENT_ID || "",
    serviceId: process.env.CROO_SERVICE_ID || "",
    mode: "Live CROO CAP provider + local dashboard",
    liveSettlementEnabled: true,
    note:
      "SentinelX runs as a CROO provider agent. The local dashboard visualizes risk checks and synced CROO order proofs.",
  };
}


// -----------------------------
// Helpers
// -----------------------------
function nowUTC() {
  return new Date().toISOString();
}


function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}


function normalizeToken(token) {
  const t = String(token || "bnb").toLowerCase();


  const map = {
    bnb: "binancecoin",
    eth: "ethereum",
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
    BTC: 65000,
    SOL: 145,
    USDT: 1,
    USDC: 1,
  };


  const changes = {
    BNB: 2.4,
    ETH: -1.8,
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


function calculateRiskScore({ priceChange24h, walletAddress, action }) {
  let score = 25;


  const volatility = Math.abs(Number(priceChange24h || 0));


  if (volatility >= 10) score += 35;
  else if (volatility >= 6) score += 25;
  else if (volatility >= 3) score += 15;
  else score += 5;


  if (!walletAddress || !ethers.isAddress(walletAddress)) {
    score += 20;
  }


  if (String(action || "").toLowerCase().includes("swap")) {
    score += 10;
  }


  if (score > 100) score = 100;


  let status = "CLEARANCE GRANTED";
  let level = "SAFE";


  if (score >= 70) {
    status = "MISSION BLOCKED";
    level = "BLOCK";
  } else if (score >= 45) {
    status = "CAUTION REQUIRED";
    level = "CAUTION";
  }


  return { score, status, level };
}


function buildExplanation({ token, priceChange24h, score, status, action }) {
  const change = Number(priceChange24h || 0).toFixed(2);


  if (status === "CLEARANCE GRANTED") {
    return `SentinelX scanned ${token}. Market movement is ${change}% in 24h and the risk score is ${score}/100. The action "${action}" looks acceptable for a pre-trade clearance check.`;
  }


  if (status === "CAUTION REQUIRED") {
    return `SentinelX detected moderate risk for ${token}. The 24h movement is ${change}%, so the agent suggests caution before continuing with "${action}".`;
  }


  return `SentinelX blocked this mission because ${token} shows high risk conditions. The action "${action}" should be reviewed manually before any on-chain execution.`;
}


function createProofHash(data) {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}


// -----------------------------
// Routes
// -----------------------------
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    project: "CROO SentinelX",
    status: "online",
    port: PORT,
    timeUTC: nowUTC(),
    crooConfigured: Boolean(process.env.CROO_SDK_KEY || process.env.CROO_API_KEY),
  });
});


app.get("/api/croo/config", (req, res) => {
  res.json({
    success: true,
    croo: getCrooConfigStatus(),
  });
});


// Real CROO completed order sync from provider.js
app.post("/api/croo/order-sync", (req, res) => {
  const orders = readCrooOrders();


  const order = {
    id: req.body.orderId || createId("croo_order"),
    status: req.body.status || "completed",
    service: req.body.service || "Pre-trade Safety Clearance",
    requesterAgentId: req.body.requesterAgentId || "",
    providerAgentId: req.body.providerAgentId || "",
    riskScore: req.body.riskScore ?? 40,
    clearance: req.body.clearance || "CLEARANCE GRANTED",
    proofHash: req.body.proofHash || "",
    txHash: req.body.txHash || "",
    amount: req.body.amount || "0.10 USDC",
    lifecycle: req.body.lifecycle || ["LOCK", "DELIVER", "CLEAR"],
    source: "Real CROO CAP order",
    createdAtUTC: req.body.createdAtUTC || nowUTC(),
  };


  const filtered = orders.filter((o) => o.id !== order.id);
  filtered.unshift(order);


  saveCrooOrders(filtered.slice(0, 20));


  res.json({
    success: true,
    order,
  });
});


app.get("/api/croo/orders", (req, res) => {
  res.json({
    success: true,
    total: readCrooOrders().length,
    orders: readCrooOrders(),
  });
});


app.get("/api/market/:token", async (req, res) => {
  const market = await getMarketData(req.params.token);


  res.json({
    success: true,
    market,
  });
});


// Local dashboard risk check
app.post("/api/risk-check", async (req, res) => {
  try {
    const {
      walletAddress = "",
      token = "BNB",
      chain = "BSC",
      tokenContract = "",
      action = "Pre-swap safety check",
    } = req.body || {};

    const scan = await runSafetyCheck({
      walletAddress,
      token,
      chain,
      tokenContract,
      tokenAddress: tokenContract,
      contractAddress: tokenContract,
      action,
      requirements: JSON.stringify({
        walletAddress,
        token,
        chain,
        tokenContract,
        action,
      }),
    });

    const proof = {
      proofId: createId("proof"),
      requestId: createId("risk"),
      callerType: "human_user",
      serviceAgent: "CROO SentinelX",
      walletAddress,
      token,
      chain,
      tokenContract: tokenContract || null,
      action,

      riskScore: scan.riskScore,
      safetyScore: scan.safetyScore,
      clearanceStatus: scan.decision,
      riskLevel: scan.riskLevel,
      explanation: scan.explanation,
      flags: scan.flags || [],

      layers: scan.layers || {},
      market: scan.layers?.market || {},
      walletLayer: scan.layers?.wallet || {},
      tokenLayer: scan.layers?.token || {},

      crooMode: getCrooConfigStatus().mode,
      createdAtUTC: nowUTC(),
    };

    proof.proofHash = createProofHash(proof);
    proofLogs.unshift(proof);

    res.json({
      success: true,
      result: proof,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Risk check failed",
      error: error.message,
    });
  }
});

app.post("/api/agent/risk-check", async (req, res) => {
  try {
    const {
      callerAgent = "AlphaSwap Bot",
      walletAddress,
      token = "BNB",
      action = "Agent requests pre-swap risk clearance",
      serviceFee = "0.1 USDC",
    } = req.body;


    const market = await getMarketData(token);


    const risk = calculateRiskScore({
      priceChange24h: market.priceChange24h,
      walletAddress,
      action,
    });


    const explanation = buildExplanation({
      token: market.token,
      priceChange24h: market.priceChange24h,
      score: risk.score,
      status: risk.status,
      action,
    });


    const agentCall = {
      callId: createId("a2a"),
      callerAgent,
      serviceAgent: "CROO SentinelX",
      walletAddress,
      token: market.token,
      action,
      serviceFee,
      riskScore: risk.score,
      clearanceStatus: risk.status,
      riskLevel: risk.level,
      explanation,
      crooMode: getCrooConfigStatus().mode,
      createdAtUTC: nowUTC(),
    };


    agentCallLogs.unshift(agentCall);


    const capOrder = {
      orderId: createId("cap"),
      buyerAgent: callerAgent,
      sellerAgent: "CROO SentinelX",
      service: "Pre-trade on-chain safety clearance",
      price: serviceFee,
      lifecycle: ["POST", "LOCK", "DELIVER", "CLEAR"],
      status: "CLEARED",
      deliveryProof: agentCall.callId,
      liveSettlementEnabled: false,
      crooNote:
        "Local dashboard CAP visualization. Real CROO orders are shown in the Real CROO Execution panel.",
      createdAtUTC: nowUTC(),
    };


    capOrders.unshift(capOrder);


    const proof = {
      proofId: createId("proof"),
      requestId: agentCall.callId,
      callerType: "agent_to_agent",
      callerAgent,
      serviceAgent: "CROO SentinelX",
      walletAddress,
      token: market.token,
      action,
      riskScore: risk.score,
      clearanceStatus: risk.status,
      riskLevel: risk.level,
      explanation,
      market,
      capOrder,
      crooIntegration: getCrooConfigStatus(),
      createdAtUTC: nowUTC(),
    };


    proof.proofHash = createProofHash(proof);
    proofLogs.unshift(proof);


    res.json({
      success: true,
      message: "A2A SentinelX mission completed",
      result: proof,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "A2A risk check failed",
      error: error.message,
    });
  }
});


app.get("/api/agent/calls", (req, res) => {
  res.json({
    success: true,
    total: agentCallLogs.length,
    calls: agentCallLogs,
  });
});


app.get("/api/cap/orders", (req, res) => {
  res.json({
    success: true,
    total: capOrders.length,
    orders: capOrders,
  });
});


app.get("/api/proofs", (req, res) => {
  res.json({
    success: true,
    total: proofLogs.length,
    proofs: proofLogs,
  });
});


// ---- Latest report (dashboard) ---------------------------------------
// app.js calls this on load + every 5s. Returns whichever order is most
// recent: a real CROO order (synced via provider.js) if one exists,
// otherwise the most recent local /api/agent/risk-check style proof.
app.get("/api/latest-report", (req, res) => {
  const crooOrders = readCrooOrders();
  const latestCroo = crooOrders[0];
  const latestProof = proofLogs[0];

  const useCroo =
    latestCroo &&
    (!latestProof ||
      new Date(latestCroo.createdAtUTC) >= new Date(latestProof.createdAtUTC));

  if (useCroo && latestCroo) {
    return res.json({
      success: true,
      report: {
        source: "real-croo-order",
        orderId: latestCroo.id,
        decision: latestCroo.clearance,
        riskScore: latestCroo.riskScore,
        safetyScore:
          typeof latestCroo.riskScore === "number" ? 100 - latestCroo.riskScore : "-",
        riskLevel: latestCroo.riskScore >= 55 ? "HIGH" : latestCroo.riskScore >= 30 ? "MEDIUM" : "LOW",
        status: latestCroo.status,
        amount: latestCroo.amount,
        requesterAgentId: latestCroo.requesterAgentId || "AlphaSwap Requester",
        providerAgentId: latestCroo.providerAgentId || "CROO SentinelX",
        proofHash: latestCroo.proofHash,
        reportURI: latestCroo.reportURI || "-",
        txHash: latestCroo.txHash,
        lifecycle: latestCroo.lifecycle,
        pair: latestCroo.pair || "-",
        chain: latestCroo.chain || "BSC",
        createdAtUTC: latestCroo.createdAtUTC,
        syncedAtUTC: nowUTC(),
      },
    });
  }

  if (latestProof) {
    return res.json({
      success: true,
      report: {
        source: "local-simulation",
        orderId: latestProof.capOrder?.orderId || latestProof.proofId,
        decision: latestProof.clearanceStatus,
        riskScore: latestProof.riskScore,
        safetyScore:
          typeof latestProof.riskScore === "number" ? 100 - latestProof.riskScore : "-",
        riskLevel: latestProof.riskLevel,
        status: latestProof.capOrder?.status || "CLEARED",
        amount: latestProof.capOrder?.price || "0.10 USDC",
        requesterAgentId: latestProof.callerAgent || "AlphaSwap Requester",
        providerAgentId: latestProof.serviceAgent || "CROO SentinelX",
        proofHash: latestProof.proofHash,
        reportURI: "-",
        txHash: "",
        lifecycle: latestProof.capOrder?.lifecycle || ["LOCK", "DELIVER", "CLEAR"],
        pair: latestProof.token ? `${latestProof.token}/USDT` : "-",
        chain: "BSC",
        createdAtUTC: latestProof.createdAtUTC,
        syncedAtUTC: nowUTC(),
      },
    });
  }

  res.json({
    success: true,
    report: {
      ok: false,
      message: "No A2A report yet. Click 'Send A2A Clearance Request' to run one.",
    },
  });
});

// ---- Run order (dashboard "Send A2A Clearance Request" button) -------
// Triggers the same local simulation as /api/agent/risk-check, then
// returns it in the same { report: {...} } shape /api/latest-report uses,
// so app.js's renderReport() works identically for both endpoints.
app.post("/api/run-order", async (req, res) => {
  try {
    const {
      callerAgent = "AlphaSwap Requester",
      walletAddress = "",
      token = "BNB",
      action = "Agent requests pre-swap risk clearance",
      serviceFee = "0.10 USDC",
    } = req.body || {};

    const market = await getMarketData(token);

    const risk = calculateRiskScore({
      priceChange24h: market.priceChange24h,
      walletAddress,
      action,
    });

    const explanation = buildExplanation({
      token: market.token,
      priceChange24h: market.priceChange24h,
      score: risk.score,
      status: risk.status,
      action,
    });

    const agentCall = {
      callId: createId("a2a"),
      callerAgent,
      serviceAgent: "CROO SentinelX",
      walletAddress,
      token: market.token,
      action,
      serviceFee,
      riskScore: risk.score,
      clearanceStatus: risk.status,
      riskLevel: risk.level,
      explanation,
      crooMode: getCrooConfigStatus().mode,
      createdAtUTC: nowUTC(),
    };
    agentCallLogs.unshift(agentCall);

    const capOrder = {
      orderId: createId("cap"),
      buyerAgent: callerAgent,
      sellerAgent: "CROO SentinelX",
      service: "Pre-trade on-chain safety clearance",
      price: serviceFee,
      lifecycle: ["LOCK", "DELIVER", "CLEAR"],
      status: "CLEARED",
      deliveryProof: agentCall.callId,
      createdAtUTC: nowUTC(),
    };
    capOrders.unshift(capOrder);

    const proof = {
      proofId: createId("proof"),
      requestId: agentCall.callId,
      callerType: "agent_to_agent",
      callerAgent,
      serviceAgent: "CROO SentinelX",
      walletAddress,
      token: market.token,
      action,
      riskScore: risk.score,
      clearanceStatus: risk.status,
      riskLevel: risk.level,
      explanation,
      market,
      capOrder,
      crooIntegration: getCrooConfigStatus(),
      createdAtUTC: nowUTC(),
    };
    proof.proofHash = createProofHash(proof);
    proofLogs.unshift(proof);

    res.json({
      success: true,
      report: {
        source: "local-simulation",
        orderId: capOrder.orderId,
        decision: risk.status,
        riskScore: risk.score,
        safetyScore: 100 - risk.score,
        riskLevel: risk.level,
        status: capOrder.status,
        amount: serviceFee,
        requesterAgentId: callerAgent,
        providerAgentId: "CROO SentinelX",
        proofHash: proof.proofHash,
        reportURI: "-",
        txHash: "",
        lifecycle: capOrder.lifecycle,
        pair: `${market.token}/USDT`,
        chain: "BSC",
        createdAtUTC: proof.createdAtUTC,
        syncedAtUTC: nowUTC(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Run order failed",
      error: error.message,
    });
  }
});


app.get("/api/agent/profile", (req, res) => {
  res.json({
    success: true,
    agent: {
      name: "CROO SentinelX",
      title: "AI Agent Command Center for On-chain Trade Safety",
      category: "DeFi / On-chain Ops Agent",
      tagline: "Autonomous pre-swap safety clearance for Web3 agents.",
      description:
        "CROO SentinelX checks wallet risk, token risk, market conditions, and swap safety before another agent executes an on-chain trade.",
      serviceEndpoint: "/api/agent/risk-check",
      priceExample: "0.1 USDC per risk check",
      responseTime: "Usually under 10 seconds in demo. Agent Store SLA: 5 minutes.",
      capFlow: ["LOCK", "DELIVER", "CLEAR"],
      deliverable:
        "Risk score, clearance status, AI explanation, proof hash, and Risk Passport.",
      realCrooProof:
        "A real CROO order was completed: AlphaSwap Requester hired SentinelX, 0.10 USDC was locked, SentinelX delivered the safety report, and payment cleared.",
      crooIntegration: getCrooConfigStatus(),
    },
  });
});


// Frontend fallback
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


registerExecuteOrderRoute(app);

app.listen(PORT, () => {
  console.log(`🚀 CROO SentinelX running on http://localhost:${PORT}`);
  console.log(
    `🔐 CROO configured: ${Boolean(
      process.env.CROO_SDK_KEY || process.env.CROO_API_KEY
    )}`
  );
});
