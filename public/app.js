function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "-";
}

function setTxLink(txHash) {
  const link = el("baseTxLink");
  if (!link) return;

  const tx = String(txHash || "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(tx)) {
    link.textContent = "No tx yet";
    link.removeAttribute("href");
    return;
  }

  const url = `https://basescan.org/tx/${tx}`;
  link.textContent = url;
  link.href = url;
}

function shortAddress(addr) {
  const text = String(addr || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) return text || "-";
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

function el(id) {
  return document.getElementById(id);
}

let missionRunning = false;

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text || "{}");
  } catch {
    throw new Error("API JSON return pannala: " + url);
  }

  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }

  return data;
}

function normalizeMarketResponse(payload = {}) {
  if (payload.ok && payload.data) return payload;

  const result = { ok: Boolean(payload.success ?? payload.ok), source: payload.source || "-", data: {} };
  const rows = Array.isArray(payload.market) ? payload.market : [];

  for (const row of rows) {
    const symbol = String(row.symbol || "").replace("USDT", "");
    if (!symbol) continue;

    result.data[symbol] = {
      price: Number(row.lastPrice || row.price || 0),
      change24h: Number(row.priceChangePercent || row.change24h || 0),
    };
  }

  result.updatedAt = payload.updatedAt || new Date().toISOString();
  return result;
}

async function loadMarket() {
  try {
    const market = normalizeMarketResponse(await fetchJson("/api/market"));

    if (!market.ok) {
      setText("statusText", "Live price unavailable");
      return;
    }

    setText("bnbPrice", market.data.BNB ? "$" + market.data.BNB.price.toFixed(2) : "Live price unavailable");
    setText("ethPrice", market.data.ETH ? "$" + market.data.ETH.price.toFixed(2) : "Live price unavailable");
    setText("btcPrice", market.data.BTC ? "$" + market.data.BTC.price.toFixed(2) : "Live price unavailable");

    setText("bnbChange", market.data.BNB ? market.data.BNB.change24h.toFixed(2) + "%" : "-");
    setText("ethChange", market.data.ETH ? market.data.ETH.change24h.toFixed(2) + "%" : "-");
    setText("btcChange", market.data.BTC ? market.data.BTC.change24h.toFixed(2) + "%" : "-");

    setText("priceSource", market.source);
    setText("lastUpdated", new Date(market.updatedAt).toUTCString());
  } catch (err) {
    console.error("Market load failed:", err);
  }
}

function getReport(data) {
  return data?.report || data?.data || data;
}

function formatAmountDisplay(value, fallbackUnit = "") {
  if (value === undefined || value === null || value === "") return "-";

  const text = String(value).trim();
  const hasUsdc = /USDC/i.test(text) || String(fallbackUnit).toUpperCase() === "USDC";
  const hasWeth = /WETH/i.test(text) || String(fallbackUnit).toUpperCase() === "WETH";
  const clean = text.replace(/[A-Za-z]/g, "").replace(/,/g, "").trim();
  const num = Number(clean);

  if (!Number.isFinite(num)) return text;

  // CROO service payment sometimes comes as raw 6-decimal USDC units.
  // Example: 100000 USDC raw units = 0.10 USDC, not 100000 USDC.
  const human = hasUsdc && num >= 1000 ? num / 1_000_000 : num;

  if (hasUsdc) return `${human.toFixed(2)} USDC`;
  if (hasWeth) return `${human.toFixed(8)} WETH`;
  return `${human.toFixed(6)}`;
}

function formatSwapAmountDisplay(report = {}) {
  const input =
    report.amountIn ||
    report.amountUsdc ||
    report.swap?.amountIn ||
    report.swap?.amountUsdc ||
    report.swap?.report?.amountIn ||
    report.swap?.report?.amountUsdc ||
    report.amount;
  const output =
    report.amountOut ||
    report.wethReceived ||
    report.swap?.amountOut ||
    report.swap?.wethReceived ||
    report.swap?.report?.amountOut ||
    report.swap?.report?.wethReceived;

  if (input && output) return `${formatAmountDisplay(input, "USDC")} → ${formatAmountDisplay(output, "WETH")}`;
  if (output) return formatAmountDisplay(output, "WETH");
  if (input) return formatAmountDisplay(input, /USDC/i.test(String(input)) || report.amountUsdc ? "USDC" : "");
  return "-";
}

function extractOrderFields(comment = "") {
  const tokenMatch = comment.match(/Token:\s*([A-Za-z0-9_]+)/i);
  const chainMatch = comment.match(/Chain:\s*([A-Za-z0-9_]+)/i);
  const tokenContractMatch = comment.match(/TokenContract:\s*(0x[a-fA-F0-9]{40})/i);

  return {
    token: tokenMatch?.[1]?.toUpperCase() || "BNB",
    chain: chainMatch?.[1]?.toUpperCase() || "BSC",
    tokenContract: tokenContractMatch?.[1] || "",
  };
}

function isBlockedReport(report = {}, decision = "", riskLevel = "") {
  const text = JSON.stringify(report).toLowerCase();
  const d = String(decision || "").toUpperCase();
  const level = String(riskLevel || "").toUpperCase();

  return (
    d.includes("MISSION BLOCKED") ||
    d.includes("MISSION_BLOCKED") ||
    d.includes("CAUTION") ||
    level === "BLOCK" ||
    level === "CAUTION" ||
    text.includes("confirmed honeypot") ||
    text.includes("honeypot") ||
    report.swap?.swapStatus === "STOPPED_BY_SENTINELX"
  );
}

function getPairDisplay(report = {}, blocked = false) {
  if (blocked && String(report.token || "").toUpperCase() === "HONEYPOT") return "HONEYPOT/USDT";

  if (report.swap?.pair) return report.swap.pair;
  if (report.pair) return report.pair;

  const inputToken =
    report.inputToken ||
    report.swap?.inputToken ||
    report.layers?.market?.inputToken ||
    report.token ||
    "USDC";

  const outputToken =
    report.outputToken ||
    report.swap?.outputToken ||
    report.layers?.market?.outputToken ||
    (String(inputToken).toUpperCase() === "USDC" ? "WETH" : "USDT");

  return `${String(inputToken).toUpperCase()}/${String(outputToken).toUpperCase()}`;
}

function renderLifecycle(lifecycle = ["REQUEST", "ACCEPT", "LOCK", "DELIVER", "RESULT_DECLARED"]) {
  const box = el("lifecycleTimeline");
  if (!box) return;

  box.innerHTML = "";
  lifecycle.forEach((item) => {
    const span = document.createElement("span");
    span.textContent = item;
    box.appendChild(span);
  });
}

function renderReport(data) {
  const report = getReport(data);

  if (!report || report.ok === false) {
    setText("statusText", report?.message || "No report found.");
    return;
  }

  const decision = report.decision || report.clearance || "-";
  const riskScore = report.riskScore ?? report.risk_score ?? "-";
  const safetyScore = report.safetyScore ?? report.safety_score ?? "-";
  const riskLevel = report.riskLevel || report.risk_level || "-";
  const status = report.status || report.swap?.swapStatus || "RESULT_DECLARED";
  const blocked = isBlockedReport(report, decision, riskLevel);

  const requester = report.requesterAgentId || report.requester_agent_id || "AlphaSwap Requester";
  const provider = report.providerAgentId || report.provider_agent_id || "CROO SentinelX";
  const tx = blocked
    ? "No router tx — stopped before execution"
    : report.txHash || report.tx_hash || report.swap?.txHash || report.swap?.report?.txHash || "No tx yet";
  const proofHash = report.proofHash || report.proof_hash || "-";
  const swapSourceWallet = report.swap?.agentWallet || report.swap?.report?.agentWallet || report.agentWallet || "-";
  const destinationWallet =
    report.swap?.recipientAddress ||
    report.swap?.report?.recipientAddress ||
    report.recipientAddress ||
    report.destinationAddress ||
    "-";
  const reportURI = report.reportURI || report.report_uri || "-";

  const amountDisplay = formatSwapAmountDisplay(report);
  const pairDisplay = getPairDisplay(report, blocked);
  const chainDisplay = report.chain || report.swap?.chain || report.swap?.report?.chain || "BSC";

  setText("decision", blocked ? "MISSION BLOCKED" : decision);
  setText("riskScore", blocked ? 100 : riskScore);
  setText("safetyScore", blocked ? 0 : safetyScore);
  setText("paymentStatus", blocked ? "STOPPED_BY_SENTINELX" : status);

  setText("requesterAgent", requester);
  setText("orderId", report.orderId || report.order_id || "-");
  setText("amount", amountDisplay);
  setText("pair", pairDisplay);
  setText("chain", chainDisplay);

  setText("riskLevel", blocked ? "BLOCK" : riskLevel);
  setText("scanRiskScore", blocked ? 100 : riskScore);

  setText("providerAgent", provider);
  setText("reportDecision", blocked ? "MISSION BLOCKED" : decision);
  setText("proofHash", proofHash);
  setText("reportURI", reportURI);

  setText("orderStatus", status);
  setText("txHash", tx);
  setText("swapSourceWallet", shortAddress(swapSourceWallet));
  setText("recipientAddress", shortAddress(destinationWallet));
  setTxLink(tx);

  const scanPill = el("scanPill");
  if (scanPill) {
    scanPill.textContent = blocked ? "BLOCK" : riskLevel;
    scanPill.className = blocked || riskLevel === "HIGH" || riskLevel === "BLOCK" ? "pill danger" : "pill";
  }

  renderLifecycle(report.lifecycle || ["REQUEST", "ACCEPT", "LOCK", "DELIVER", "RESULT_DECLARED"]);

  const raw = el("rawJson");
  if (raw) {
    const displayReport = {
      ...report,
      pair: pairDisplay,
      amount: report.amount ? formatAmountDisplay(report.amount, "USDC") : report.amount,
      amountDisplay,
      crooServicePayment: report.amount ? formatAmountDisplay(report.amount, "USDC") : undefined,
      swapAmount: amountDisplay,
      marketDisplay: report.layers?.market
        ? `${report.layers.market.outputToken || report.layers.market.token}: $${Number(report.layers.market.priceUsd || 0).toFixed(6)}`
        : undefined,
    };
    raw.textContent = JSON.stringify(displayReport, null, 2);
  }

  setText("statusText", "Result declared: " + (blocked ? "swap stopped" : decision));
}

async function loadLatestReport() {
  if (missionRunning) return;

  try {
    const data = await fetchJson("/api/latest-report");
    renderReport(data);
  } catch (err) {
    setText("statusText", err.message);
  }
}

async function runDemoOrder() {
  try {
    setText("statusText", "Running local demo risk check...");
    const data = await fetchJson("/api/run-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    renderReport(data);
  } catch (err) {
    setText("statusText", err.message);
  }
}

function isValidWalletAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test((addr || "").trim());
}

function updateMissionStatus(eventName, data = {}) {
  const messages = {
    mission_started: "AlphaSwap requester started. Hiring SentinelX through CROO...",
    requesting: "AlphaSwap sent SentinelX hire request through CROO...",
    negotiated: "SentinelX negotiation created. Waiting for provider accept...",
    negotiation_status: "Negotiation status: " + (data.status || "-"),
    accepted: "SentinelX accepted. CROO order created: " + (data.orderId || "-"),
    order_waiting_created: "CROO order status: " + (data.status || "-"),
    paid: "CROO payment locked. Waiting for SentinelX report...",
    order_status: "Order status: " + (data.status || "-"),
    delivered: "SentinelX delivered report. Declaring result...",
    result_declared: data.message || "Result declared.",
    swap_started: "SAFE result declared. AlphaSwap is starting real swap...",
    swap_executed: "Real swap executed after SentinelX clearance.",
    swap_ready_not_executed: data.reason || "SAFE, but real swap env flag is disabled.",
    swap_blocked: data.reason || "SentinelX blocked/cautioned. Swap stopped before execution.",
    done: data.swapExecuted ? "Done — report declared and real swap executed." : "Done — report declared; swap not executed.",
    error: "Error: " + (data.error || "unknown error"),
  };

  if (messages[eventName]) setText("executeStatus", messages[eventName]);
  if (messages[eventName]) setText("statusText", messages[eventName]);

  if (eventName === "delivered" && data.delivery) {
    setText("reportDecision", "REPORT DELIVERED");
  }

  if (eventName === "result_declared" && data.report) renderReport({ report: data.report });
  if (eventName === "swap_executed") {
    const tx = data.txHash || data.report?.txHash || "";
    setText("txHash", tx || "No tx yet");
    setText("swapSourceWallet", shortAddress(data.agentWallet || data.report?.agentWallet));
    setText("recipientAddress", shortAddress(data.recipientAddress || data.report?.recipientAddress));
    setTxLink(tx);
  }
  if (eventName === "done" && data.report) renderReport({ report: data.report });
}

function parseSseChunk(chunk) {
  const eventMatch = chunk.match(/^event: (.+)$/m);
  const dataMatch = chunk.match(/^data: (.+)$/m);
  if (!eventMatch || !dataMatch) return null;

  try {
    return {
      eventName: eventMatch[1],
      data: JSON.parse(dataMatch[1]),
    };
  } catch {
    return null;
  }
}

async function startAlphaSwapMission() {
  const walletInput = el("walletInput");
  const destinationInput = el("destinationInput");
  const commentInput = el("commentInput");
  const amountInput = el("amountUsdcInput");
  const startBtn = el("startMissionBtn") || el("executeBtn");

  const walletAddress = walletInput?.value.trim() || "";
  const recipientAddress = destinationInput?.value.trim() || walletAddress;
  const comment = commentInput?.value.trim() || "";
  const orderFields = extractOrderFields(comment);

  if (!isValidWalletAddress(walletAddress)) {
    setText("executeStatus", "Enter a valid wallet address to check (0x + 40 hex chars).");
    return;
  }

  if (!isValidWalletAddress(recipientAddress)) {
    setText("executeStatus", "Enter a valid destination wallet address (0x + 40 hex chars). WETH will be sent there.");
    return;
  }

  missionRunning = true;
  if (startBtn) startBtn.disabled = true;
  setText("executeStatus", `AlphaSwap mission starting for ${orderFields.token} on ${orderFields.chain}. Destination: ${shortAddress(recipientAddress)}...`);
  setText("statusText", "AlphaSwap requester is hiring SentinelX...");

  try {
    const res = await fetch("/api/alphaswap/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress,
        recipientAddress,
        destinationAddress: recipientAddress,
        comment,
        token: orderFields.token,
        chain: orderFields.chain,
        tokenContract: orderFields.tokenContract,
        amountUsdc: amountInput?.value || undefined,
      }),
    });

    if (!res.ok || !res.body) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop();

      for (const chunk of events) {
        const parsed = parseSseChunk(chunk);
        if (!parsed) continue;
        updateMissionStatus(parsed.eventName, parsed.data);
      }
    }
  } catch (err) {
    setText("executeStatus", "Error: " + err.message);
    setText("statusText", "Mission failed: " + err.message);
  } finally {
    missionRunning = false;
    if (startBtn) startBtn.disabled = false;
  }
}

// Backward-compatible name for old inline listeners.
const executeRealOrder = startAlphaSwapMission;

function handleExecuteEvent(eventName, data) {
  updateMissionStatus(eventName, data);
}

document.addEventListener("DOMContentLoaded", () => {
  el("runBtn")?.addEventListener("click", runDemoOrder);
  el("refreshBtn")?.addEventListener("click", loadLatestReport);
  el("startMissionBtn")?.addEventListener("click", startAlphaSwapMission);
  el("executeBtn")?.addEventListener("click", startAlphaSwapMission);

  loadMarket();
  loadLatestReport();
  setInterval(loadMarket, 30000);
  setInterval(loadLatestReport, 5000);
});
