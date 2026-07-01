/**
 * orderOrchestrator.js
 * --------------------
 * SentinelX Order Orchestrator
 *
 * Purpose:
 * 1. Accept an incoming agent/order request
 * 2. Run SentinelX riskEngine
 * 3. Build proof hash + report
 * 4. Optionally deliver report to SentinelXEscrow smart contract
 * 5. Sync result to local dashboard
 *
 * Note:
 * CROO real Agent Store flow is handled by provider.js.
 * This file is the extra orchestrator layer for architecture/demo/future on-chain escrow flow.
 */

require("dotenv").config();

const crypto = require("crypto");
const axios = require("axios");
const { ethers } = require("ethers");
const { runSafetyCheck, extractTradeParams } = require("./riskEngine");

const ESCROW_ABI = [
  "function deliverReport(uint256 orderId, uint8 verdict, bytes32 reportHash, string reportURI) external",
  "function getOrder(uint256 orderId) external view returns (tuple(address requester, address provider, uint256 amount, uint256 createdAt, uint256 deadline, uint8 status, uint8 verdict, bytes32 reportHash, string reportURI))",
];

const VERDICT_ENUM = {
  CLEARANCE_GRANTED: 0,
  CAUTION_REQUIRED: 1,
  MISSION_BLOCKED: 2,
};

function nowUTC() {
  return new Date().toISOString();
}

function createHash(data) {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function toBytes32(hexHash) {
  return "0x" + String(hexHash).replace(/^0x/, "").slice(0, 64).padEnd(64, "0");
}

function mapDecisionToVerdict(decision) {
  const d = String(decision || "").toUpperCase();

  if (d.includes("BLOCK")) {
    return VERDICT_ENUM.MISSION_BLOCKED;
  }

  if (d.includes("CAUTION")) {
    return VERDICT_ENUM.CAUTION_REQUIRED;
  }

  return VERDICT_ENUM.CLEARANCE_GRANTED;
}

function getEscrowConfig() {
  return {
    rpcUrl: process.env.ESCROW_RPC_URL || process.env.RPC_URL || "",
    privateKey: process.env.ESCROW_PRIVATE_KEY || process.env.PRIVATE_KEY || "",
    contractAddress:
      process.env.SENTINELX_ESCROW_ADDRESS ||
      process.env.ESCROW_CONTRACT_ADDRESS ||
      "",
  };
}

function canUseEscrow() {
  const cfg = getEscrowConfig();

  return Boolean(
    cfg.rpcUrl &&
      cfg.privateKey &&
      cfg.contractAddress &&
      ethers.isAddress(cfg.contractAddress)
  );
}

async function deliverToEscrowContract({ orderId, verdict, reportHash, reportURI }) {
  const cfg = getEscrowConfig();

  if (!canUseEscrow()) {
    return {
      enabled: false,
      delivered: false,
      reason:
        "Escrow contract delivery skipped. ESCROW_RPC_URL, ESCROW_PRIVATE_KEY, or SENTINELX_ESCROW_ADDRESS is missing.",
    };
  }

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const wallet = new ethers.Wallet(cfg.privateKey, provider);
  const escrow = new ethers.Contract(cfg.contractAddress, ESCROW_ABI, wallet);

  const tx = await escrow.deliverReport(
    BigInt(orderId),
    verdict,
    reportHash,
    reportURI
  );

  const receipt = await tx.wait();

  return {
    enabled: true,
    delivered: true,
    contractAddress: cfg.contractAddress,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
  };
}

async function syncToDashboard(result) {
  try {
    await axios.post("http://localhost:8000/api/croo/order-sync", {
      orderId: result.orderId,
      service: "Pre-trade Safety Clearance",
      status: "completed",
      riskScore: result.riskScore,
      clearance: result.decision,
      proofHash: result.proofHash,
      txHash: result.escrowDelivery?.txHash || "",
      amount: result.amount || "0.10 USDC",
      requesterAgentId: result.requesterAgentId || "",
      providerAgentId: result.providerAgentId || "",
      lifecycle: ["REQUEST", "RISK_CHECK", "DELIVER", "CLEAR"],
      createdAtUTC: result.createdAtUTC,
    });

    return {
      synced: true,
    };
  } catch (err) {
    return {
      synced: false,
      error: err.message,
    };
  }
}

async function orchestrateOrder(input = {}) {
  const orderId =
    input.orderId ||
    input.order_id ||
    input.id ||
    Math.floor(Date.now() / 1000).toString();

  const params = extractTradeParams(input);
  const safety = await runSafetyCheck(input);

  const report = {
    agent: "CROO SentinelX",
    module: "Order Orchestrator",
    service: "Pre-trade Safety Clearance",
    orderId,
    requesterAgentId:
      input.requesterAgentId || input.requester_agent_id || "AlphaSwap Requester",
    providerAgentId:
      input.providerAgentId || input.provider_agent_id || "CROO SentinelX",
    walletAddress: params.walletAddress || "",
    tokenAddress: params.tokenAddress || "",
    tokenSymbol: params.tokenSymbol || "BNB",
    chain: params.chain || "bsc",
    action: params.action || "Pre-swap safety clearance",
    decision: safety.decision,
    riskScore: safety.riskScore,
    safetyScore: safety.safetyScore,
    riskLevel: safety.riskLevel,
    explanation: safety.explanation,
    flags: safety.flags,
    layers: safety.layers,
    amount: input.amount || "0.10 USDC",
    createdAtUTC: nowUTC(),
  };

  report.proofHash = createHash(report);

  const verdict = mapDecisionToVerdict(report.decision);
  const reportHashBytes32 = toBytes32(report.proofHash);

  const reportURI =
    input.reportURI ||
    `sentinelx://order/${orderId}/proof/${report.proofHash}`;

  let escrowDelivery;

  try {
    escrowDelivery = await deliverToEscrowContract({
      orderId,
      verdict,
      reportHash: reportHashBytes32,
      reportURI,
    });
  } catch (err) {
    escrowDelivery = {
      enabled: true,
      delivered: false,
      error: err.message,
    };
  }

  const result = {
    ...report,
    verdict,
    reportHashBytes32,
    reportURI,
    escrowDelivery,
  };

  result.dashboardSync = await syncToDashboard(result);

  return result;
}

async function runCliDemo() {
  const demoOrder = {
    orderId: process.argv[2] || "1001",
    requesterAgentId: "AlphaSwap Requester",
    providerAgentId: "CROO SentinelX",
    walletAddress:
      process.env.DEMO_WALLET ||
      process.env.CROO_AGENT_WALLET ||
      "0x08e391A5ea432DB8a38d4a3155fF386146cE6c94",
    token: "BNB",
    chain: "bsc",
    action: "Pre-swap safety check for BNB to USDT",
    amount: "0.10 USDC",
  };

  console.log("🚀 Running SentinelX Order Orchestrator...");
  console.log("Order:", demoOrder.orderId);

  const result = await orchestrateOrder(demoOrder);

  console.log("✅ Orchestration completed");
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  runCliDemo().catch((err) => {
    console.error("❌ Orchestrator failed:", err.message || err);
    process.exit(1);
  });
}

module.exports = {
  orchestrateOrder,
  mapDecisionToVerdict,
  deliverToEscrowContract,
};
