function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "-";
}


async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();


  try {
    return JSON.parse(text);
  } catch {
    throw new Error("API JSON return pannala: " + url);
  }
}


function getReport(data) {
  return data?.report || data?.data || data;
}


function renderLifecycle(lifecycle = ["LOCK", "DELIVER", "CLEAR"]) {
  const box = document.getElementById("lifecycleTimeline");
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
  const status = report.status || "completed";


  const requester =
    report.requesterAgentId ||
    report.requester_agent_id ||
    report.order?.requesterAgent ||
    "AlphaSwap Requester";


  const provider =
    report.providerAgentId ||
    report.provider_agent_id ||
    report.order?.providerAgent ||
    "CROO SentinelX";


  const tx =
    report.txHash ||
    report.tx_hash ||
    "No tx yet";


  const proofHash =
    report.proofHash ||
    report.proof_hash ||
    "-";


  const reportURI =
    report.reportURI ||
    report.report_uri ||
    "-";


  setText("decision", decision);
  setText("riskScore", riskScore);
  setText("safetyScore", safetyScore);
  setText("paymentStatus", status);


  setText("requesterAgent", requester);
  setText("orderId", report.orderId || report.order_id || "-");
  setText("amount", report.amount || "-");
  setText("pair", report.pair || "BNB/USDT");
  setText("chain", report.chain || "BSC");


  setText("riskLevel", riskLevel);
  setText("scanRiskScore", riskScore);


  setText("providerAgent", provider);
  setText("reportDecision", decision);
  setText("proofHash", proofHash);
  setText("reportURI", reportURI);


  setText("orderStatus", status);
  setText("txHash", tx);


  const scanPill = document.getElementById("scanPill");
  if (scanPill) {
    scanPill.textContent = riskLevel;
    scanPill.className = riskLevel === "HIGH" ? "pill danger" : "pill";
  }


  renderLifecycle(report.lifecycle || ["LOCK", "DELIVER", "CLEAR"]);


  const raw = document.getElementById("rawJson");
  if (raw) raw.textContent = JSON.stringify(report, null, 2);


  setText(
    "statusText",
    "A2A lifecycle updated: " +
      (report.syncedAtUTC || report.createdAtUTC || new Date().toISOString())
  );
}


async function loadLatestReport() {
  try {
    setText("statusText", "Loading latest A2A report...");
    const data = await fetchJson("/api/latest-report");
    renderReport(data);
  } catch (err) {
    setText("statusText", err.message);
  }
}


async function runDemoOrder() {
  try {
    setText("statusText", "Sending A2A clearance request...");


    const data = await fetchJson("/api/run-order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });


    renderReport(data);
  } catch (err) {
    setText("statusText", err.message);
  }
}


function isValidWalletAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test((addr || "").trim());
}


async function executeRealOrder() {
  const walletInput = document.getElementById("walletInput");
  const commentInput = document.getElementById("commentInput");
  const executeStatus = document.getElementById("executeStatus");
  const executeBtn = document.getElementById("executeBtn");

  const walletAddress = walletInput?.value.trim() || "";
  const comment = commentInput?.value.trim() || "";

  if (!isValidWalletAddress(walletAddress)) {
    if (executeStatus) executeStatus.textContent = "Enter a valid wallet address (0x + 40 hex chars).";
    return;
  }

  if (executeBtn) executeBtn.disabled = true;
  if (executeStatus) executeStatus.textContent = "Sending NegotiateOrder to CROO...";

  try {
    const res = await fetch("/api/execute-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress, comment, token: "BNB", chain: "BSC" }),
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
      buffer = events.pop(); // keep any incomplete trailing chunk

      for (const chunk of events) {
        const eventMatch = chunk.match(/^event: (.+)$/m);
        const dataMatch = chunk.match(/^data: (.+)$/m);
        if (!eventMatch || !dataMatch) continue;

        const eventName = eventMatch[1];
        let data;
        try {
          data = JSON.parse(dataMatch[1]);
        } catch {
          continue;
        }

        handleExecuteEvent(eventName, data);
      }
    }
  } catch (err) {
    if (executeStatus) executeStatus.textContent = "Error: " + err.message;
  } finally {
    if (executeBtn) executeBtn.disabled = false;
  }
}


function handleExecuteEvent(eventName, data) {
  const executeStatus = document.getElementById("executeStatus");

  const messages = {
    requesting: "Negotiation requirements sent to SentinelX...",
    negotiated: "Negotiation created (id: " + (data.negotiationId || "-") + "). Waiting for SentinelX to accept...",
    negotiation_status: "Negotiation status: " + (data.status || "-"),
    accepted: "SentinelX accepted. Order created (id: " + (data.orderId || "-") + "). Paying into escrow...",
    paid: "Payment locked in CROO escrow. Waiting for SentinelX to deliver...",
    order_status: "Order status: " + (data.status || "-"),
    delivered: "SentinelX delivered the safety report!",
    done: "Done — real order completed.",
    error: "Error: " + (data.error || "unknown error"),
  };

  if (executeStatus && messages[eventName]) {
    executeStatus.textContent = messages[eventName];
  }

  // Once delivered, render the final JSON the same way the rest of the
  // dashboard renders /api/latest-report — same renderReport() function,
  // same fields, so this slots into the existing UI without duplicating logic.
  if (eventName === "delivered" && data.delivery) {
    renderReport({ report: data.delivery });
  }

  if (eventName === "done") {
    // Pull the freshest persisted copy too, in case provider.js's own
    // sync (via /api/croo/order-sync) saved a richer version.
    loadLatestReport();
  }
}


document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("runBtn")?.addEventListener("click", runDemoOrder);
  document.getElementById("refreshBtn")?.addEventListener("click", loadLatestReport);
  document.getElementById("executeBtn")?.addEventListener("click", executeRealOrder);


  loadLatestReport();
  setInterval(loadLatestReport, 5000);
});