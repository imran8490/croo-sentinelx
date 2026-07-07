require("dotenv").config();

const crypto = require("crypto");
const axios = require("axios");
const { runSafetyCheck } = require("./riskEngine");

// Hide CROO key in terminal logs
function scrubSecret(value) {
  return String(value).replace(/croo_sk_[A-Za-z0-9._-]+/g, "croo_sk_***hidden***");
}

["log", "error", "warn"].forEach((method) => {
  const original = console[method].bind(console);
  console[method] = (...args) => original(...args.map(scrubSecret));
});

function maskKey(key) {
  if (!key) return "missing";
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function nowUTC() {
  return new Date().toISOString();
}

function createHash(data) {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function isPendingNegotiation(status) {
  const s = String(status || "").toLowerCase();
  return ["pending", "created", "requested"].includes(s);
}

function isDeliverableOrder(status) {
  const s = String(status || "").toLowerCase();
  return ["paid", "delivering"].includes(s);
}

/**
 * Extract the real order amount + currency from a payload of unknown shape.
 * Tries common field names CROO might use, plus delivered-order echoes
 * (some SDKs return the order's amount back inside deliverOrder's response).
 * Falls back to "0.10 USDC" only if nothing is found anywhere — and logs
 * a warning so we notice and can fix the field name once we see a real order.
 */
function formatCrooUsdcAmount(value, currency = "USDC") {
  if (value === null || value === undefined || value === "") return "0.10 USDC";

  const rawText = String(value).trim();
  const clean = rawText.replace(/USDC/gi, "").replace(/,/g, "").trim();
  const num = Number(clean);

  if (!Number.isFinite(num)) return rawText;

  // CROO returns USDC in raw 6-decimal units in some order payloads.
  // Example: 100000 raw units = 0.10 USDC.
  const looksLikeRawUsdcUnits = num >= 1000 && String(currency || "USDC").toUpperCase().includes("USDC");
  const human = looksLikeRawUsdcUnits ? num / 1_000_000 : num;

  return `${human.toFixed(2)} USDC`;
}

function extractOrderAmount(order = {}, delivered = {}) {
  const raw = order.raw || order;
  const deliveredOrder = delivered?.order || {};

  const rawAmount =
    raw.amount ?? raw.price ?? raw.totalAmount ?? raw.total_amount ??
    raw.orderAmount ?? raw.order_amount ??
    deliveredOrder.amount ?? deliveredOrder.price ?? null;

  const rawCurrency =
    raw.currency ?? raw.token ?? raw.tokenSymbol ?? raw.token_symbol ??
    deliveredOrder.currency ?? deliveredOrder.token ?? "USDC";

  if (rawAmount === null || rawAmount === undefined) {
    console.log("⚠️ Could not find amount field on order — using fallback '0.10 USDC'. " +
      "Check RAW ORDER PAYLOAD log above for the real field name.");
    return "0.10 USDC";
  }

  const finalAmount = formatCrooUsdcAmount(rawAmount, rawCurrency);
  console.log(`💰 CROO service payment amount: ${finalAmount}`);
  return finalAmount;
}

/**
 * Builds the real safety report for an order by running the risk engine
 * (market + wallet/token layers, with graceful fallback if wallet/token
 * fields aren't present on the order yet).
 *
 * NOTE: the first time a real order comes through CROO, this logs the
 * full raw order JSON under "RAW ORDER PAYLOAD (for field-name check)".
 * Check that log, find where the wallet/token address actually lives,
 * then we tighten up extractTradeParams() in riskEngine.js accordingly.
 */

function extractWalletFromText(text = "") {
  const s = typeof text === "string" ? text : JSON.stringify(text || {});
  const m = s.match(/0x[a-fA-F0-9]{40}/);
  return m ? m[0] : "";
}

function extractRequirementsObject(order = {}) {
  const candidates = [
    order.requirements,
    order.requirement,
    order.raw?.requirements,
    order.data?.requirements,
    order.payload?.requirements,
    order.description,
    order.text,
  ];

  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "object") return c;
    if (typeof c === "string") {
      try {
        const parsed = JSON.parse(c);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {}
    }
  }

  return {};
}

function extractDestinationFromOrder(order = {}) {
  const req = extractRequirementsObject(order);
  const text = JSON.stringify({ ...order, requirementsObject: req });
  const direct =
    order.destinationAddress ||
    order.recipientAddress ||
    order.destinationWallet ||
    req.destinationAddress ||
    req.recipientAddress ||
    req.destinationWallet ||
    req.receiverWallet ||
    "";

  if (direct && /^0x[a-fA-F0-9]{40}$/.test(String(direct).trim())) {
    return String(direct).trim();
  }

  const m = text.match(/(?:DestinationWallet|Destination Wallet|destinationAddress|RecipientAddress|recipientAddress|receiverWallet)\s*[:=]\s*["']?(0x[a-fA-F0-9]{40})/i);
  return m ? m[1] : "";
}

function extractSourceFromOrder(order = {}) {
  const req = extractRequirementsObject(order);
  return (
    order.walletAddress ||
    order.sourceWalletAddress ||
    req.walletAddress ||
    req.sourceWalletAddress ||
    extractWalletFromText(order.requirements || order.text || order.description || "") ||
    ""
  );
}

async function buildRiskReport(order = {}) {
  console.log("🔎 RAW ORDER PAYLOAD (for field-name check):", JSON.stringify(order, null, 2));

  const safety = await runSafetyCheck(order);
  const requirements = extractRequirementsObject(order);
  const sourceWalletAddress = extractSourceFromOrder(order);
  const destinationAddress = extractDestinationFromOrder(order);

  const report = {
    agent: "CROO SentinelX",
    service: "Pre-trade Safety Clearance",
    orderId: order.orderId || order.id || order.order_id || "unknown",
    serviceId: order.serviceId || order.service_id || process.env.CROO_SERVICE_ID || "",
    requirements,
    walletAddress: sourceWalletAddress,
    sourceWalletAddress,
    destinationAddress,
    recipientAddress: destinationAddress,
    inputToken: requirements.inputToken || requirements.token || safety.inputToken || "",
    outputToken: requirements.outputToken || safety.outputToken || "",
    amountUsdc: requirements.amountUsdc || "",
    swapPair: requirements.swapPair || safety.pair || "",
    requesterAgentId:
      order.requesterAgentId || order.requester_agent_id || order.requesterAgentID || "",
    providerAgentId:
      order.providerAgentId || order.provider_agent_id || order.providerAgentID || "",
    decision: safety.decision,
    riskScore: safety.riskScore,
    safetyScore: safety.safetyScore,
    riskLevel: safety.riskLevel,
    explanation: safety.explanation,
    flags: safety.flags,
    layers: safety.layers,
    createdAtUTC: nowUTC(),
  };

  report.proofHash = createHash(report);
  return report;
}

async function syncOrderToLocalDashboard({ orderId, report, delivered, order }) {
  try {
    await fetch("http://localhost:8000/api/croo/order-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId,
        service: "Pre-trade Safety Clearance",
        status:
          delivered?.order?.status ||
          delivered?.status ||
          "completed", // fallback: deliverOrder succeeded, so order should be at least delivered/completed
        decision: report.decision,
        clearance: report.decision,
        riskScore: report.riskScore,
        safetyScore: report.safetyScore,
        riskLevel: report.riskLevel,
        proofHash: report.proofHash,
        // This is CROO delivery/payment proof, not a router swap tx.
        // Keep router txHash empty unless AlphaSwap actually executes the swap.
        txHash: "",
        crooDeliveryTxHash:
          delivered?.txHash ||
          delivered?.deliverTxHash ||
          delivered?.order?.deliverTxHash ||
          delivered?.order?.txHash ||
          "",
        amount: extractOrderAmount(order, delivered),
        amountUsdc: report.amountUsdc || "",
        inputToken: report.inputToken || "",
        outputToken: report.outputToken || "",
        pair: report.swapPair || report.pair || "",
        flags: report.flags || [],
        layers: report.layers || {},
        destinationAddress: report.destinationAddress || "",
        recipientAddress: report.recipientAddress || report.destinationAddress || "",
        sourceWalletAddress: report.sourceWalletAddress || report.walletAddress || "",
        requesterAgentId:
          delivered?.order?.requesterAgentId ||
          order?.requesterAgentId ||
          order?.requester_agent_id ||
          "",
        providerAgentId:
          delivered?.order?.providerAgentId ||
          order?.providerAgentId ||
          order?.provider_agent_id ||
          "",
        lifecycle: ["LOCK", "DELIVER", "CLEAR"],
        createdAtUTC: nowUTC(),
      }),
    });

    console.log("✅ CROO order synced to local dashboard");
  } catch (syncErr) {
    console.log("⚠️ Local dashboard sync failed:", syncErr.message || syncErr);
  }
}

async function main() {
  const sdkKey = String(process.env.CROO_SDK_KEY || process.env.CROO_API_KEY || "").trim();

  if (!sdkKey) {
    console.error("❌ Missing CROO_SDK_KEY or CROO_API_KEY in .env");
    process.exit(1);
  }

  const config = {
    baseURL: process.env.CROO_API_URL || "https://api.croo.network",
    wsURL: process.env.CROO_WS_URL || "wss://api.croo.network/ws",
  };

  console.log("🚀 Starting CROO SentinelX Provider...");
  console.log("API:", config.baseURL);
  console.log("WS :", config.wsURL);
  console.log("Key:", maskKey(sdkKey));

  const sdk = await import("@croo-network/sdk");
  const { AgentClient, DeliverableType, EventTypeName, EventType } = sdk;

  const client = new AgentClient(config, sdkKey);

  const acceptedNegotiations = new Set();
  const deliveredOrders = new Set();
  // Maps orderId -> requirements text, so deliverOrderSafe() can recover the
  // wallet/token info that only exists on the negotiation, not the order event.
  const orderRequirements = new Map();

  async function rawAcceptNegotiation(negotiationId) {
  const url = `${config.baseURL}/backend/v1/orders/negotiate/${negotiationId}/accept`;
  const cleanKey =  String(sdkKey || "").trim();
  const headers = {
    "Content-Type": "application/json",
    "X-sdk-Key": cleanKey,
    "x-SDK-key": cleanKey,
  };

  const response = await axios.post(url, {}, { headers, timeout: 20000 });

  return response.data;
}

async function acceptNegotiationSafe(negotiationId) {
  if (!negotiationId) return;

  if (acceptedNegotiations.has(negotiationId)) {
    return;
  }

  try {
    console.log("🤝 Accepting negotiation via SDK:", negotiationId);

    const accepted = await client.acceptNegotiation(negotiationId);

    acceptedNegotiations.add(negotiationId);

    console.log("✅ Negotiation accepted via SDK:", JSON.stringify(accepted, null, 2));
    return accepted;
  } catch (err) {
    console.log("⚠️ SDK accept failed, trying raw API:", err.message || err);
  }

  try {
    console.log("🤝 Accepting negotiation via raw API:", negotiationId);

    const accepted = await rawAcceptNegotiation(negotiationId);

    acceptedNegotiations.add(negotiationId);

    console.log("✅ Negotiation accepted via raw API:", JSON.stringify(accepted, null, 2));
    return accepted;
  } catch (err) {
    console.log(
      "❌ Raw accept failed:",
      err.response?.status,
      err.response?.data || err.message
    );
    console.log("🔁 Will retry on next WebSocket event / poll.");
  }
}
  async function deliverOrderSafe(orderId, order = {}) {
    if (!orderId) return;
    if (deliveredOrders.has(orderId)) return; // already SUCCEEDED, skip

    try {
      console.log("📦 Delivering order:", orderId);

      // Pull in cached negotiation requirements (wallet/token/chain) if we
      // have them, since order_* events alone don't carry this info.
      const cachedRequirements = orderRequirements.get(orderId);

      const report = await buildRiskReport({
        ...order,
        requirements: order.requirements || cachedRequirements,
        orderId,
      });

      console.log(`🛡️ Verdict for ${orderId}: ${report.riskLevel} (safety score ${report.safetyScore}/100)`);
      if (report.flags?.length) {
        console.log("   Flags:", report.flags.join(" | "));
      }

      const deliverReq = {
        deliverableType: DeliverableType?.Text || "text",
        deliverableText: JSON.stringify(report, null, 2),
        contentHash: report.proofHash,
      };

      const delivered = await client.deliverOrder(orderId, deliverReq);

      // Only mark as delivered AFTER deliverOrder succeeds, so a failed
      // attempt (e.g. order not payable yet on order_created) doesn't
      // permanently block retries on the next order_paid/order_delivering event.
      deliveredOrders.add(orderId);

      console.log("✅ Order delivered:", JSON.stringify(delivered, null, 2));

      await syncOrderToLocalDashboard({
        orderId,
        report,
        delivered,
        order,
      });
    } catch (err) {
      console.log(`⚠️ deliverOrder error for ${orderId} (will retry on next poll/event):`, err.message || err);
    }
  }

  console.log("🔌 Connecting CROO WebSocket...");
  const stream = await client.connectWebSocket();

  console.log("✅ WebSocket connected. Agent should be ONLINE if service setup is complete.");

  if (stream && typeof stream.on === "function") {
    const possibleEvents = [
      ...Object.values(EventTypeName || {}),
      ...Object.values(EventType || {}),
      "negotiation_created",
      "negotiation_updated",
      "order_created",
      "order_paid",
      "order_delivering",
      "order_completed",
      "delivery_created",
      "connected",
      "heartbeat",
      "message",
    ];

    [...new Set(possibleEvents)]
      .filter(Boolean)
      .forEach((eventName) => {
        try {
          stream.on(eventName, async (event) => {
            console.log(`📡 Event: ${eventName}`, JSON.stringify(event, null, 2));

            const raw = event?.raw || event || {};
            const type = event?.type || eventName;

            const negotiationId =
              raw.negotiation_id ||
              raw.negotiationId ||
              event?.negotiation_id ||
              event?.negotiationId;

            const orderId =
              raw.order_id ||
              raw.orderId ||
              event?.order_id ||
              event?.orderId;

            if (
              negotiationId &&
              (
                type === "negotiation_created" ||
                type === "negotiation_updated" ||
                type === "order_negotiation_created" ||
                type === "order_created" ||
                String(type || "").toLowerCase().includes("negotiation")
              )
            ) {
              const accepted = await acceptNegotiationSafe(negotiationId);
              const acceptedOrderId =
                accepted?.orderId || accepted?.order_id || accepted?.order?.orderId || orderId;
              const requirements = raw.requirements || event?.requirements || accepted?.requirements;

              if (acceptedOrderId && requirements && !orderRequirements.has(acceptedOrderId)) {
                orderRequirements.set(acceptedOrderId, requirements);
                console.log(`📋 Cached requirements for order ${acceptedOrderId}`);
              }
            }

            if (
  orderId &&
  (
    type === "order_paid" ||
    type === "order_delivering" ||
    type.includes("paid")
  )
) {
  await deliverOrderSafe(orderId, raw);
}
              // For created orders, delivery may fail until payment/lock is ready.
              // Poll loop will retry later if status becomes deliverable.
             // await deliverOrderSafe(orderId, raw);
            //}
          });
        } catch {
          // Some event names may not exist. Ignore safely.
        }
      });
  }

  async function scanNegotiations() {
    try {
      const negotiations = await client.listNegotiations({ role: "provider" });
      const list = Array.isArray(negotiations) ? negotiations : [];

      for (const n of list) {
        const negotiationId =
          n.negotiationId || n.id || n.negotiation_id || n.uuid;

        if (!negotiationId) continue;

        if (isPendingNegotiation(n.status)) {
          console.log("🤝 Pending negotiation found:", negotiationId);
          await acceptNegotiationSafe(negotiationId);
        } else if (String(n.status).toLowerCase() === "accepted") {
          // Already accepted (possibly in a previous run) — make sure its
          // requirements are still cached against the resulting orderId.
          const orderId = n.orderId || n.order_id;
          const requirements = n.requirements;
          if (orderId && requirements && !orderRequirements.has(orderId)) {
            orderRequirements.set(orderId, requirements);
            console.log(`📋 Cached requirements (from poll) for order ${orderId}`);
          }
        }
      }
    } catch (err) {
      console.log("⚠️ listNegotiations error:", err.message || err);
    }
  }

  async function scanOrders() {
    try {
      const orders = await client.listOrders({ role: "provider" });
      const list = Array.isArray(orders) ? orders : [];

      for (const order of list) {
        const orderId = order.orderId || order.id || order.order_id || order.uuid;

        if (!orderId) continue;

        if (isDeliverableOrder(order.status)) {
          console.log("📦 Deliverable order found:", orderId, "status:", order.status);
          await deliverOrderSafe(orderId, order);
        }
      }
    } catch (err) {
      console.log("⚠️ listOrders error:", err.message || err);
    }
  }

  console.log("🟢 Provider loop started. Waiting for CROO orders...");
  console.log("Do not close this terminal while testing Agent Store orders.");

  await scanNegotiations();
  await scanOrders();

  setInterval(async () => {
    await scanNegotiations();
    await scanOrders();
  }, 15000);
}

main().catch((err) => {
  console.error("❌ Provider crashed:", err);
  process.exit(1);
});
