const { execFile } = require("child_process");

function nowUTC() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRequirementsText({
  walletAddress,
  recipientAddress,
  destinationAddress,
  token,
  chain,
  comment,
  tokenContract,
  outputToken,
  amountUsdc,
}) {
  const receiver = String(recipientAddress || destinationAddress || walletAddress || "").trim();
  const inputToken = String(token || "USDC").toUpperCase();
  const outToken = String(outputToken || (inputToken === "USDC" && String(chain).toUpperCase() === "BASE" ? "WETH" : "USDT")).toUpperCase();
  const amount = String(amountUsdc || process.env.DEFAULT_SWAP_USDC_AMOUNT || "0.05").trim();
  const action =
    comment ||
    `AlphaSwap wants to swap ${inputToken} to ${outToken}. SentinelX must return CLEARANCE_GRANTED before AlphaSwap executes the real swap.`;

  return JSON.stringify({
    requesterAgent: "AlphaSwap",
    providerAgent: "CROO SentinelX",
    walletAddress,
    sourceWalletAddress: walletAddress,
    destinationAddress: receiver,
    recipientAddress: receiver,
    inputToken,
    outputToken: outToken,
    token: inputToken,
    chain,
    tokenContract: tokenContract || "",
    amountUsdc: amount,
    swapPair: `${inputToken}/${outToken}`,
    swapRoute: `${inputToken} -> ${outToken}`,
    action,
    executionRule:
      "Do not execute swap until SentinelX report is delivered and result is declared CLEARANCE_GRANTED. Send the swap output only to destinationAddress.",
    text:
      `Wallet: ${walletAddress} SourceWallet: ${walletAddress} DestinationWallet: ${receiver} ` +
      `RecipientAddress: ${receiver} AmountUSDC: ${amount} Token: ${inputToken} OutputToken: ${outToken} ` +
      `Chain: ${chain} TokenContract: ${tokenContract || "native"} SwapRoute: ${inputToken}->${outToken} Action: ${action}`,
  });
}

function isValidWallet(addr) {
  return typeof addr === "string" && /^0x[a-fA-F0-9]{40}$/.test(addr.trim());
}

function curlJson(method, url, body, sdkKey) {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "-X",
      method,
      "-H",
      `x-sdk-key: ${sdkKey}`,
      "-H",
      `X-SDK-Key: ${sdkKey}`,
      "-H",
      "Content-Type: application/json",
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
    return await curlJson("GET", `${config.baseURL}/backend/v1/orders/${orderId}`, null, sdkKey);
  }
}

async function payOrder(client, config, orderId, sdkKey) {
  try {
    return await client.payOrder(orderId);
  } catch (err) {
    console.log("⚠️ SDK payOrder failed, trying curl raw API:", err.message || err);
    return await curlJson("POST", `${config.baseURL}/backend/v1/orders/${orderId}/pay`, {}, sdkKey);
  }
}

async function getDelivery(client, config, orderId, sdkKey) {
  try {
    return await client.getDelivery(orderId);
  } catch {
    return await curlJson("GET", `${config.baseURL}/backend/v1/orders/${orderId}/delivery`, null, sdkKey);
  }
}

async function runAlphaSwapOrder(
  {
    walletAddress,
    recipientAddress = "",
    destinationAddress = "",
    token = "BNB",
    chain = "BSC",
    comment = "",
    tokenContract = "",
    outputToken = "",
    amountUsdc = "",
  },
  onUpdate = () => {}
) {
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

  const requirementsText = buildRequirementsText({
    walletAddress,
    recipientAddress,
    destinationAddress,
    token,
    chain,
    comment,
    tokenContract,
    outputToken,
    amountUsdc,
  });

  onUpdate("requesting", {
    requester: "AlphaSwap Requester",
    provider: "CROO SentinelX",
    requirements: requirementsText,
    startedAtUTC: nowUTC(),
  });

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
  if (!negotiationId) throw new Error("No negotiationId returned from negotiate order");

  onUpdate("negotiated", { negotiationId, negotiation });

  let orderId = extractOrderId(negotiation);
  const acceptStart = Date.now();
  const maxAcceptWaitMs = Number(process.env.CROO_ACCEPT_TIMEOUT_MS || 180000);

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

  if (!orderId) throw new Error("Timed out waiting for SentinelX to accept negotiation");

  onUpdate("accepted", {
    orderId,
    message: "SentinelX accepted AlphaSwap mission through CROO.",
  });

  let readyOrder = null;
  const createdStart = Date.now();
  const maxCreatedWaitMs = Number(process.env.CROO_CREATED_TIMEOUT_MS || 180000);

  while (Date.now() - createdStart < maxCreatedWaitMs) {
    const orderStatus = await getOrderStatus(client, config, orderId, sdkKey);
    const statusText = String(orderStatus?.status || "").toLowerCase();

    onUpdate("order_waiting_created", {
      orderId,
      status: orderStatus?.status,
      raw: orderStatus,
    });

    if (
      statusText.includes("created") ||
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

  if (!readyOrder) throw new Error("Timed out waiting for CROO order status to become created");

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

  onUpdate("paid", {
    orderId,
    paid,
    message: "CROO payment locked. AlphaSwap is waiting for SentinelX report.",
  });

  let delivery = null;
  const deliverStart = Date.now();
  const maxDeliverWaitMs = Number(process.env.CROO_DELIVERY_TIMEOUT_MS || 180000);

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

  if (!delivery) throw new Error("Timed out waiting for SentinelX to deliver");

  onUpdate("delivered", { orderId, delivery, finishedAtUTC: nowUTC() });
  return { orderId, negotiationId, delivery };
}

function tryParseJson(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findReportCandidate(value, depth = 0) {
  if (!value || depth > 8) return null;

  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    return parsed ? findReportCandidate(parsed, depth + 1) : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findReportCandidate(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    const hasDecision =
      value.decision || value.clearance || value.riskLevel || value.riskScore || value.safetyScore;
    const looksLikeSentinelX =
      String(value.agent || value.service || value.providerAgent || "").toLowerCase().includes("sentinel") ||
      String(value.deliverableText || value.text || "").toLowerCase().includes("sentinelx");

    if (hasDecision && (looksLikeSentinelX || value.proofHash || value.layers || value.flags)) {
      return value;
    }

    const priorityKeys = [
      "deliverableText",
      "deliveryText",
      "content",
      "text",
      "report",
      "data",
      "result",
      "delivery",
      "deliverable",
      "order",
    ];

    for (const key of priorityKeys) {
      if (key in value) {
        const found = findReportCandidate(value[key], depth + 1);
        if (found) return found;
      }
    }

    for (const item of Object.values(value)) {
      const found = findReportCandidate(item, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function extractSentinelXReport(delivery, fallback = {}) {
  const report = findReportCandidate(delivery) || {};

  return {
    source: "real-croo-order",
    requesterAgentId: "AlphaSwap Requester",
    providerAgentId: "CROO SentinelX",
    orderId: fallback.orderId || report.orderId || report.order_id || "-",
    status: "RESULT_DECLARED",
    lifecycle: ["REQUEST", "ACCEPT", "LOCK", "DELIVER", "RESULT_DECLARED"],
    ...report,
    deliveryRaw: delivery,
    resultDeclaredAtUTC: nowUTC(),
  };
}

function normalizeDecisionText(report = {}) {
  return String(report.decision || report.clearance || report.riskLevel || "").toUpperCase();
}

function isBlockedOrRisky(report = {}) {
  const text = JSON.stringify(report).toUpperCase();
  const decision = normalizeDecisionText(report);

  return (
    decision.includes("MISSION BLOCKED") ||
    decision.includes("MISSION_BLOCKED") ||
    decision === "BLOCK" ||
    decision.includes("CAUTION") ||
    Number(report.safetyScore) < 70 ||
    Number(report.riskScore) >= 31 ||
    text.includes("HONEYPOT") ||
    text.includes("PHISHING")
  );
}

function isClearanceGranted(report = {}) {
  const decision = normalizeDecisionText(report);
  const riskLevel = String(report.riskLevel || "").toUpperCase();

  return (
    !isBlockedOrRisky(report) &&
    (decision.includes("CLEARANCE GRANTED") ||
      decision.includes("CLEARANCE_GRANTED") ||
      riskLevel === "SAFE")
  );
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function executeSwapAfterDeclaredReport({ report, walletAddress, recipientAddress, amountUsdc, minWethOut }) {
  if (!isClearanceGranted(report)) {
    return {
      ok: true,
      swapExecuted: false,
      swapStatus: "STOPPED_BY_SENTINELX",
      reason: `Result declared: ${report.decision || report.riskLevel || "not safe"}. AlphaSwap stopped before router execution.`,
    };
  }

  if (String(process.env.EXECUTE_REAL_SWAP_AFTER_SENTINELX || "").toLowerCase() !== "true") {
    return {
      ok: true,
      swapExecuted: false,
      swapStatus: "READY_BUT_ENV_DISABLED",
      reason:
        "SentinelX returned CLEARANCE GRANTED. Set EXECUTE_REAL_SWAP_AFTER_SENTINELX=true in .env to execute the real swap.",
    };
  }

  const { executeUsdcToWethAfterClearance } = require("./safeSwapExecutor");
  if (typeof executeUsdcToWethAfterClearance !== "function") {
    throw new Error("safeSwapExecutor.js not loaded");
  }

  return await executeUsdcToWethAfterClearance({
    recipientAddress: recipientAddress || walletAddress,
    amountUsdc: amountUsdc || process.env.DEFAULT_SWAP_USDC_AMOUNT || "0.05",
    minWethOut: minWethOut || process.env.DEFAULT_MIN_WETH_OUT || "0",
  });
}

function buildRequestPayload(body = {}) {
  const comment = String(body.comment || "").trim();
  const tokenFromComment = comment.match(/Token:\s*([A-Za-z0-9_]+)/i)?.[1];
  const chainFromComment = comment.match(/Chain:\s*([A-Za-z0-9_]+)/i)?.[1];
  const tokenContractFromComment = comment.match(/TokenContract:\s*(0x[a-fA-F0-9]{40})/i)?.[1];
  const outputTokenFromComment =
    comment.match(/(?:OutputToken|Output Token|ToToken|To Token):\s*([A-Za-z0-9._-]+)/i)?.[1] ||
    comment.match(/(?:swap|convert|exchange)\s+[A-Za-z0-9._-]+\s+(?:to|for|into|->)\s+([A-Za-z0-9._-]+)/i)?.[1] ||
    comment.match(/to\s+(WETH|ETH|WBTC|BTC|USDC|USDT|BNB|SOL)\b/i)?.[1];

  return {
    walletAddress: String(body.walletAddress || "").trim(),
    recipientAddress: String(body.recipientAddress || body.destinationAddress || body.walletAddress || "").trim(),
    token: String(body.token || tokenFromComment || "BNB").toUpperCase(),
    chain: String(body.chain || chainFromComment || "BSC").toUpperCase(),
    tokenContract: String(body.tokenContract || tokenContractFromComment || "").trim(),
    outputToken: String(body.outputToken || outputTokenFromComment || (String(body.token || tokenFromComment || "").toUpperCase() === "USDC" && String(body.chain || chainFromComment || "").toUpperCase() === "BASE" ? "WETH" : "")).toUpperCase(),
    comment,
    amountUsdc: String(body.amountUsdc || process.env.DEFAULT_SWAP_USDC_AMOUNT || "0.05"),
    minWethOut: String(body.minWethOut || process.env.DEFAULT_MIN_WETH_OUT || "0"),
  };
}

function createAlphaSwapMissionHandler(options = {}) {
  return async (req, res) => {
    const payload = buildRequestPayload(req.body || {});

    if (!isValidWallet(payload.walletAddress)) {
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

    try {
      sendSse(res, "mission_started", {
        ok: true,
        message: "AlphaSwap requester started. SentinelX will be hired before any swap.",
        payload,
        createdAtUTC: nowUTC(),
      });

      const orderResult = await runAlphaSwapOrder(payload, (step, data) => sendSse(res, step, data));

      const report = extractSentinelXReport(orderResult.delivery, {
        orderId: orderResult.orderId,
      });

      report.orderId = orderResult.orderId;
      report.negotiationId = orderResult.negotiationId;
      report.walletAddress = report.walletAddress || payload.walletAddress;
      report.token = report.token || payload.token;
      report.chain = report.chain || payload.chain;
      report.tokenContract = report.tokenContract || payload.tokenContract;
      report.destinationAddress = report.destinationAddress || payload.recipientAddress;
      report.recipientAddress = report.recipientAddress || payload.recipientAddress;
      report.sourceWalletAddress = report.sourceWalletAddress || payload.walletAddress;
      report.amountUsdc = report.amountUsdc || payload.amountUsdc;
      report.inputToken = report.inputToken || payload.token;
      report.outputToken = report.outputToken || payload.outputToken || "WETH";
      report.pair = report.pair || `${report.inputToken}/${report.outputToken}`;

      if (typeof options.onReport === "function") options.onReport(report);

      sendSse(res, "result_declared", {
        ok: true,
        report,
        decision: report.decision || report.riskLevel || "RESULT_DECLARED",
        message: `Result declared: ${report.decision || report.riskLevel || "UNKNOWN"}`,
      });

      if (!isClearanceGranted(report)) {
        const stopped = await executeSwapAfterDeclaredReport({ report, ...payload });
        const finalReport = {
          ...report,
          decision: "MISSION BLOCKED",
          riskLevel: "BLOCK",
          riskScore: 100,
          safetyScore: 0,
          swap: stopped,
          lifecycle: [...(report.lifecycle || []), "SWAP_STOPPED"],
          txHash: "",
          baseExplorerUrl: "",
          routerTxSubmitted: false,
          swapStatus: "STOPPED_BY_SENTINELX",
        };

        if (typeof options.onReport === "function") options.onReport(finalReport);

        sendSse(res, "swap_blocked", stopped);
        sendSse(res, "done", {
          ok: true,
          orderId: orderResult.orderId,
          negotiationId: orderResult.negotiationId,
          report: finalReport,
          swapExecuted: false,
        });
        return;
      }

      sendSse(res, "swap_started", {
        ok: true,
        message: "SentinelX returned CLEARANCE GRANTED. AlphaSwap can execute the real swap now.",
      });

      const swapResult = await executeSwapAfterDeclaredReport({ report, ...payload });
      const swapExecuted = Boolean(
        swapResult?.txHash || swapResult?.report?.txHash || swapResult?.swapStatus === "EXECUTED_AFTER_CLEARANCE"
      );

      const finalReport = {
        ...report,
        swap: swapResult,
        lifecycle: [...(report.lifecycle || []), swapExecuted ? "REAL_SWAP_EXECUTED" : "SWAP_READY"],
        txHash: swapResult?.txHash || swapResult?.report?.txHash || report.txHash || "",
        baseExplorerUrl: swapResult?.baseExplorerUrl || (swapResult?.txHash ? `https://basescan.org/tx/${swapResult.txHash}` : ""),
        recipientAddress: swapResult?.recipientAddress || payload.recipientAddress,
        agentWallet: swapResult?.agentWallet || "",
        inputToken: swapResult?.inputToken || report.inputToken || payload.token || "USDC",
        outputToken: swapResult?.outputToken || report.outputToken || payload.outputToken || "WETH",
        pair: swapResult?.pair || report.pair || `${payload.token || "USDC"}/${payload.outputToken || "WETH"}`,
        amountIn: swapResult?.amountIn || `${payload.amountUsdc || process.env.DEFAULT_SWAP_USDC_AMOUNT || "0.05"} USDC`,
        amountOut: swapResult?.amountOut || "",
      };

      if (typeof options.onReport === "function") options.onReport(finalReport);

      sendSse(res, swapExecuted ? "swap_executed" : "swap_ready_not_executed", swapResult);
      sendSse(res, "done", {
        ok: true,
        orderId: orderResult.orderId,
        negotiationId: orderResult.negotiationId,
        report: finalReport,
        swapExecuted,
      });
    } catch (err) {
      sendSse(res, "error", { ok: false, error: err.message || String(err) });
    } finally {
      res.end();
    }
  };
}

function registerAlphaSwapMissionRoute(app, options = {}) {
  app.post("/api/alphaswap/start", createAlphaSwapMissionHandler(options));
}

function registerExecuteOrderRoute(app, options = {}) {
  const handler = createAlphaSwapMissionHandler(options);

  app.post("/api/alphaswap/start", handler);
  app.post("/api/execute-order", handler);
  app.post("/api/execute-real-order", handler);
}

module.exports = {
  registerExecuteOrderRoute,
  registerAlphaSwapMissionRoute,
  runAlphaSwapOrder,
  isValidWallet,
  extractSentinelXReport,
  isClearanceGranted,
  isBlockedOrRisky,
};
