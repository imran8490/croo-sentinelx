const { execFile } = require("child_process");

function nowUTC() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRequirementsText({ walletAddress, token, chain, comment, tokenContract }) {
  return JSON.stringify({
    walletAddress,
    token,
    chain,
    tokenContract: tokenContract || "",
    action: comment || `Pre-swap safety check for ${token} to USDT on ${chain}`,
    text: `Wallet: ${walletAddress} Token: ${token} Chain: ${chain} TokenContract: ${tokenContract || "native"} Action: ${comment || `Pre-swap safety check for ${token} to USDT on ${chain}`}`
  });
}


function isValidWallet(addr) {
  return typeof addr === "string" && /^0x[a-fA-F0-9]{40}$/.test(addr.trim());
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

    if (body) {
      args.push("-d", JSON.stringify(body));
    }

    args.push(url);

    execFile("curl", args, { timeout: 90000 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr || error.message));
      }

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

function extractNegotiationId(obj = {}) {
  return (
    obj.negotiationId ||
    obj.negotiation_id ||
    obj.id ||
    obj.uuid ||
    obj.negotiation?.id ||
    obj.negotiation?.negotiationId ||
    obj.data?.negotiationId ||
    obj.data?.id ||
    null
  );
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
    obj.order?.uuid ||
    obj.data?.orderId ||
    obj.data?.order_id ||
    obj.data?.order?.orderId ||
    obj.orders?.[0]?.orderId ||
    obj.orders?.[0]?.id ||
    null
  );
}

async function getNegotiationStatus(client, config, negotiationId, sdkKey) {
  try {
    return await client.getNegotiation(negotiationId);
  } catch {
    return await curlJson(
      "GET",
      `${config.baseURL}/backend/v1/orders/negotiate/${negotiationId}`,
      null,
      sdkKey
    );
  }
}

async function getOrderStatus(client, config, orderId, sdkKey) {
  try {
    return await client.getOrder(orderId);
  } catch {
    return await curlJson(
      "GET",
      `${config.baseURL}/backend/v1/orders/${orderId}`,
      null,
      sdkKey
    );
  }
}

async function payOrder(client, config, orderId, sdkKey) {
  try {
    return await client.payOrder(orderId);
  } catch (err) {
    console.log("⚠️ SDK payOrder failed, trying curl raw API:", err.message || err);

    return await curlJson(
      "POST",
      `${config.baseURL}/backend/v1/orders/${orderId}/pay`,
      {},
      sdkKey
    );
  }
}

async function getDelivery(client, config, orderId, sdkKey) {
  try {
    return await client.getDelivery(orderId);
  } catch {
    return await curlJson(
      "GET",
      `${config.baseURL}/backend/v1/orders/${orderId}/delivery`,
      null,
      sdkKey
    );
  }
}

async function runAlphaSwapOrder({ walletAddress, token, chain, comment }, onUpdate = () => {}) {
  const sdkKey = String(process.env.ALPHASWAP_SDK_KEY || "").trim();
  const targetServiceId = String(process.env.CROO_TARGET_SERVICE_ID || "").trim();

  if (!sdkKey) throw new Error("Missing ALPHASWAP_SDK_KEY in .env");
  if (!targetServiceId) throw new Error("Missing CROO_TARGET_SERVICE_ID in .env");

  const config = {
    baseURL: process.env.CROO_API_URL || "https://api.croo.network",
    wsURL: process.env.CROO_WS_URL || "wss://api.croo.network/ws",
  };

  const sdk = await import("@croo-network/sdk");
  const { AgentClient } = sdk;
  const client = new AgentClient(config, sdkKey);

  const requirementsText = buildRequirementsText({ walletAddress, token, chain, comment });
  onUpdate("requesting", { requirements: requirementsText, startedAtUTC: nowUTC() });

  let negotiation;

  try {
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

  const negotiationId = extractNegotiationId(negotiation);
  if (!negotiationId) {
    throw new Error("No negotiationId returned from negotiate order");
  }

  onUpdate("negotiated", { negotiationId, negotiation });

  let orderId = extractOrderId(negotiation);
  const acceptStart = Date.now();
  const maxAcceptWaitMs = 180000;

  while (!orderId && Date.now() - acceptStart < maxAcceptWaitMs) {
    const status = await getNegotiationStatus(client, config, negotiationId, sdkKey);
    orderId = extractOrderId(status);

    onUpdate("negotiation_status", {
      status: status?.status,
      orderId,
      raw: status,
    });

    const s = String(status?.status || "").toLowerCase();
    if (s.includes("rejected")) {
      throw new Error(`Negotiation rejected: ${status.rejectReason || "no reason given"}`);
    }

    await sleep(3000);
  }

  if (!orderId) {
    throw new Error("Timed out waiting for SentinelX to accept negotiation");
  }

  onUpdate("accepted", { orderId });

  // ---- Step 3: Wait until CROO order becomes CREATED, then pay ----------
  let readyOrder = null;
  const createdStart = Date.now();
  const maxCreatedWaitMs = 180000;

  while (Date.now() - createdStart < maxCreatedWaitMs) {
    const orderStatus = await getOrderStatus(client, config, orderId, sdkKey);
    const statusText = String(orderStatus?.status || "").toLowerCase();

    onUpdate("order_waiting_created", {
      orderId,
      status: orderStatus?.status,
      raw: orderStatus,
    });

    if (statusText === "created" || statusText.includes("created")) {
      readyOrder = orderStatus;
      break;
    }

    if (
      statusText.includes("paid") ||
      statusText.includes("delivering") ||
      statusText.includes("completed")
    ) {
      readyOrder = orderStatus;
      break;
    }

    if (
      statusText.includes("rejected") ||
      statusText.includes("cancelled") ||
      statusText.includes("failed")
    ) {
      throw new Error(`Order ${orderStatus.status} before payment`);
    }

    await sleep(3000);
  }

  if (!readyOrder) {
    throw new Error("Timed out waiting for CROO order status to become created");
  }

  let paid;
  const readyStatus = String(readyOrder?.status || "").toLowerCase();

  if (
    readyStatus.includes("paid") ||
    readyStatus.includes("delivering") ||
    readyStatus.includes("completed")
  ) {
    paid = { skipped: true, reason: `Order already ${readyOrder.status}` };
  } else {
    paid = await payOrder(client, config, orderId, sdkKey);
  }

  onUpdate("paid", { orderId, paid });

  let delivery = null;
  const deliverStart = Date.now();
  const maxDeliverWaitMs = 180000;

  while (Date.now() - deliverStart < maxDeliverWaitMs) {
    const orderStatus = await getOrderStatus(client, config, orderId, sdkKey);
    const s = String(orderStatus?.status || "").toLowerCase();

    onUpdate("order_status", { orderId, status: orderStatus?.status, raw: orderStatus });

    if (s.includes("delivering") || s.includes("completed")) {
      delivery = await getDelivery(client, config, orderId, sdkKey);
      break;
    }

    if (s.includes("rejected") || s.includes("cancelled")) {
      throw new Error(`Order ${orderStatus.status} before delivery`);
    }

    await sleep(3000);
  }

  if (!delivery) {
    throw new Error("Timed out waiting for SentinelX to deliver");
  }

  onUpdate("delivered", { orderId, delivery, finishedAtUTC: nowUTC() });

  return { orderId, negotiationId, delivery };
}

function registerExecuteOrderRoute(app) {
  app.post("/api/execute-order", async (req, res) => {
    const { walletAddress, comment = "", token = "BNB", chain = "BSC" } = req.body || {};

    if (!isValidWallet(walletAddress)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid wallet address. Expected 0x-prefixed 40 hex chars.",
      });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await runAlphaSwapOrder(
        { walletAddress, comment, token, chain },
        (step, data) => send(step, data)
      );

      send("done", { ok: true, ...result });
    } catch (err) {
      send("error", { ok: false, error: err.message || String(err) });
    } finally {
      res.end();
    }
  });
}

module.exports = {
  registerExecuteOrderRoute,
  runAlphaSwapOrder,
  isValidWallet,
};
