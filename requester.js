require("dotenv").config();

const { execFile } = require("child_process");

function nowUTC() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskKey(key) {
  if (!key) return "missing";
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function curlJson(method, url, body, sdkKey) {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "-X", method,
      "-H", `x-sdk-key: ${sdkKey}`,
      "-H", `X-SDK-Key: ${sdkKey}`,
      "-H", "Content-Type: application/json",
    ];

    if (body) args.push("-d", JSON.stringify(body));
    args.push(url);

    execFile("curl", args, { timeout: 90000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));

      try {
        const data = JSON.parse(stdout || "{}");
        if (data && Number(data.code) >= 400) {
          return reject(new Error(data.message || data.reason || JSON.stringify(data)));
        }
        resolve(data);
      } catch {
        reject(new Error(stdout || "curl returned invalid JSON"));
      }
    });
  });
}

function buildRequirementsText({ walletAddress, token, chain }) {
  return JSON.stringify({
    walletAddress,
    token,
    chain,
    action: `Pre-swap safety check for ${token} to USDT`,
    text: `Wallet: ${walletAddress} Token: ${token} Chain: ${chain} Action: Pre-swap safety check for ${token} to USDT`
  });
}

function extractNegotiationId(obj = {}) {
  return obj.negotiationId || obj.negotiation_id || obj.id || obj.uuid || null;
}

function extractOrderId(obj = {}) {
  return (
    obj.orderId ||
    obj.order_id ||
    obj.id ||
    obj.uuid ||
    obj.order?.orderId ||
    obj.order?.order_id ||
    obj.order?.id ||
    obj.orders?.[0]?.orderId ||
    obj.orders?.[0]?.id ||
    null
  );
}

async function main() {
  const sdkKey = String(process.env.ALPHASWAP_SDK_KEY || "").trim();
  const targetServiceId = String(process.env.CROO_TARGET_SERVICE_ID || "").trim();

  if (!sdkKey) {
    console.error("❌ Missing ALPHASWAP_SDK_KEY in .env");
    process.exit(1);
  }

  if (!targetServiceId) {
    console.error("❌ Missing CROO_TARGET_SERVICE_ID in .env");
    process.exit(1);
  }

  const config = {
    baseURL: process.env.CROO_API_URL || "https://api.croo.network",
    wsURL: process.env.CROO_WS_URL || "wss://api.croo.network/ws",
  };

  console.log("🚀 Starting AlphaSwap Requester...");
  console.log("API:", config.baseURL);
  console.log("Key:", maskKey(sdkKey));
  console.log("Target Service (SentinelX):", targetServiceId);

  const sdk = await import("@croo-network/sdk");
  const { AgentClient } = sdk;
  const client = new AgentClient(config, sdkKey);

  const swapRequest = {
    walletAddress: process.env.DEMO_WALLET_ADDRESS || "0x08e391A5ea432DB8a38d4a3155fF386146cE6c94",
    token: process.env.DEMO_TOKEN || "BNB",
    chain: process.env.DEMO_CHAIN || "BSC",
  };

  const requirementsText = buildRequirementsText(swapRequest);
  console.log("📋 Requesting clearance for:", requirementsText);

  let negotiation;

  try {
    console.log("🤝 Sending NegotiateOrder via SDK...");
    negotiation = await client.negotiateOrder({
      serviceId: targetServiceId,
      requirements: requirementsText,
    });
  } catch (err) {
    console.log("⚠️ SDK negotiate failed, trying curl raw API:", err.message || err);

    negotiation = await curlJson(
      "POST",
      `${config.baseURL}/backend/v1/orders/negotiate`,
      {
        serviceId: targetServiceId,
        requirements: requirementsText,
      },
      sdkKey
    );
  }

  console.log("✅ Negotiation created:", JSON.stringify(negotiation, null, 2));

  const negotiationId = extractNegotiationId(negotiation);
  if (!negotiationId) throw new Error("No negotiationId returned");

  console.log("⏳ Waiting for SentinelX to accept negotiation...");

  let orderId = extractOrderId(negotiation);
  const acceptStart = Date.now();

  while (!orderId && Date.now() - acceptStart < 180000) {
    let status;

    try {
      status = await client.getNegotiation(negotiationId);
    } catch {
      status = await curlJson(
        "GET",
        `${config.baseURL}/backend/v1/orders/negotiate/${negotiationId}`,
        null,
        sdkKey
      );
    }

    console.log("   negotiation status:", status?.status || "-");

    orderId = extractOrderId(status);

    if (String(status?.status || "").toLowerCase().includes("rejected")) {
      throw new Error(`Negotiation rejected: ${status.rejectReason || "no reason given"}`);
    }

    if (!orderId) await sleep(3000);
  }

  if (!orderId) throw new Error("Timed out waiting for SentinelX to accept negotiation");

  console.log("✅ Negotiation accepted. Order:", orderId);

  console.log("⏳ Waiting until order status becomes created...");

  const createdStart = Date.now();
  let orderStatus;

  while (Date.now() - createdStart < 180000) {
    try {
      orderStatus = await client.getOrder(orderId);
    } catch {
      orderStatus = await curlJson(
        "GET",
        `${config.baseURL}/backend/v1/orders/${orderId}`,
        null,
        sdkKey
      );
    }

    console.log("   order status:", orderStatus?.status || "-");

    const s = String(orderStatus?.status || "").toLowerCase();

    if (s.includes("created") || s.includes("paid") || s.includes("delivering") || s.includes("completed")) {
      break;
    }

    await sleep(3000);
  }

  const currentStatus = String(orderStatus?.status || "").toLowerCase();

  if (!currentStatus.includes("paid") && !currentStatus.includes("delivering") && !currentStatus.includes("completed")) {
    console.log("💳 Paying order / locking escrow...");

    try {
      const paid = await client.payOrder(orderId);
      console.log("✅ Paid via SDK:", JSON.stringify(paid, null, 2));
    } catch (err) {
      console.log("⚠️ SDK pay failed, trying curl raw API:", err.message || err);

      const paid = await curlJson(
        "POST",
        `${config.baseURL}/backend/v1/orders/${orderId}/pay`,
        {},
        sdkKey
      );

      console.log("✅ Paid via curl:", JSON.stringify(paid, null, 2));
    }
  } else {
    console.log("✅ Order already paid/delivering/completed. Skipping pay.");
  }

  console.log("⏳ Waiting for SentinelX delivery...");

  const deliverStart = Date.now();
  let delivery = null;

  while (Date.now() - deliverStart < 180000) {
    let latest;

    try {
      latest = await client.getOrder(orderId);
    } catch {
      latest = await curlJson(
        "GET",
        `${config.baseURL}/backend/v1/orders/${orderId}`,
        null,
        sdkKey
      );
    }

    console.log("   order status:", latest?.status || "-");

    const s = String(latest?.status || "").toLowerCase();

    if (s.includes("delivering") || s.includes("completed")) {
      try {
        delivery = await client.getDelivery(orderId);
      } catch {
        delivery = await curlJson(
          "GET",
          `${config.baseURL}/backend/v1/orders/${orderId}/delivery`,
          null,
          sdkKey
        );
      }
      break;
    }

    await sleep(3000);
  }

  if (!delivery) throw new Error("Timed out waiting for SentinelX delivery");

  console.log("\n🎉 SentinelX delivered:");
  console.log(JSON.stringify(delivery, null, 2));
  console.log("Completed at:", nowUTC());
}

main().catch((err) => {
  console.error("❌ AlphaSwap requester failed:", err.message || err);
  process.exit(1);
});
