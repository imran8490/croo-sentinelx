const API_BASE = "";

const $ = (id) => document.getElementById(id);

const demoWallet = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

function shortText(text, start = 10, end = 8) {
  if (!text) return "--";
  if (text.length <= start + end) return text;
  return `${text.slice(0, start)}...${text.slice(-end)}`;
}

function formatUSD(value) {
  const num = Number(value || 0);
  if (num >= 1000) {
    return `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  return `$${num.toFixed(4)}`;
}

function formatChange(value) {
  const num = Number(value || 0);
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
}

function setButtonLoading(button, loadingText, isLoading) {
  if (!button.dataset.originalText) {
    button.dataset.originalText = button.innerText;
  }

  button.disabled = isLoading;
  button.innerText = isLoading ? loadingText : button.dataset.originalText;
}

function resetTimeline() {
  ["stepPost", "stepLock", "stepDeliver", "stepClear"].forEach((id) => {
    $(id).classList.remove("active");
  });
}

function activateTimeline() {
  const steps = ["stepPost", "stepLock", "stepDeliver", "stepClear"];

  resetTimeline();

  steps.forEach((id, index) => {
    setTimeout(() => {
      $(id).classList.add("active");
    }, index * 350);
  });
}

function setStatus(level, text) {
  const badge = $("statusBadge");

  badge.className = "status-badge";

  if (level === "SAFE") badge.classList.add("safe");
  else if (level === "CAUTION") badge.classList.add("caution");
  else if (level === "BLOCK") badge.classList.add("block");
  else badge.classList.add("neutral");

  badge.innerText = level || "WAITING";
  $("clearanceText").innerText = text || "No mission scanned yet";
}

function updateRiskResult(result) {
  $("riskScore").innerText = result.riskScore ?? "--";
  $("aiExplanation").innerText = result.explanation || "--";

  setStatus(result.riskLevel, result.clearanceStatus);

  if (result.market) {
    $("marketPrice").innerText = formatUSD(result.market.priceUsd);
    $("marketChange").innerText = formatChange(result.market.priceChange24h);
  }

  $("missionStatus").innerText = result.clearanceStatus || "Mission scanned";
}

function updatePassport(result) {
  $("requestId").innerText = result.requestId || "--";
  $("proofId").innerText = result.proofId || "--";
  $("passportWallet").innerText = shortText(result.walletAddress, 14, 10);
  $("passportToken").innerText = result.token || "--";
  $("passportStatus").innerText = result.clearanceStatus || "--";
  $("proofTime").innerText = result.createdAtUTC || "--";
  $("proofHash").innerText = result.proofHash || "--";

  if (result.capOrder) {
    $("capOrderId").innerText = result.capOrder.orderId || "--";
    activateTimeline();
  }
}

function updateA2AConsole(result) {
  const capId = result.capOrder?.orderId || "--";

  $("a2aConsole").innerHTML = `
    <span>> Caller Agent: ${result.callerAgent || "AlphaSwap Bot"}</span>
    <span>> Service Agent: CROO SentinelX</span>
    <span>> Mission: ${result.action || "Pre-trade clearance"}</span>
    <span>> Token: ${result.token}</span>
    <span>> Result: ${result.clearanceStatus}</span>
    <span>> Risk Score: ${result.riskScore}/100</span>
    <span>> CAP Order: ${capId}</span>
    <span>> Proof: ${shortText(result.proofHash, 16, 10)}</span>
  `;
}

async function requestClearance() {
  const button = $("clearanceBtn");

  try {
    setButtonLoading(button, "Scanning Mission...", true);

    const payload = {
      walletAddress: $("walletAddress").value.trim(),
      token: $("tokenSelect").value,
      action: $("actionInput").value.trim() || "Pre-swap safety check",
    };

    const response = await fetch(`${API_BASE}/api/risk-check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message || "Risk check failed");
    }

    updateRiskResult(data.result);
    updatePassport(data.result);
    await loadLogs();
  } catch (error) {
    $("missionStatus").innerText = "Risk scan failed";
    $("aiExplanation").innerText = error.message;
    setStatus("BLOCK", "MISSION ERROR");
  } finally {
    setButtonLoading(button, "Scanning Mission...", false);
  }
}

async function simulateA2A() {
  const button = $("a2aBtn");

  try {
    setButtonLoading(button, "Agent Calling SentinelX...", true);

    const wallet =
      $("walletAddress").value.trim() || demoWallet;

    const payload = {
      callerAgent: $("callerAgent").value.trim() || "AlphaSwap Bot",
      walletAddress: wallet,
      token: $("a2aToken").value,
      action: $("a2aAction").value.trim() || "Agent requests pre-swap risk clearance",
      serviceFee: "0.1 USDC",
    };

    const response = await fetch(`${API_BASE}/api/agent/risk-check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message || "A2A call failed");
    }

    updateRiskResult(data.result);
    updatePassport(data.result);
    updateA2AConsole(data.result);
    await loadLogs();
  } catch (error) {
    $("a2aConsole").innerHTML = `<span>> A2A mission failed: ${error.message}</span>`;
  } finally {
    setButtonLoading(button, "Agent Calling SentinelX...", false);
  }
}

function loadDemoData() {
  $("walletAddress").value = demoWallet;
  $("tokenSelect").value = "bnb";
  $("actionInput").value = "Swap BNB to USDT after safety clearance";
  $("callerAgent").value = "AlphaSwap Bot";
  $("a2aToken").value = "bnb";
  $("a2aAction").value = "Agent requests pre-swap risk clearance";

  $("missionStatus").innerText = "Demo data loaded";
}

async function loadLogs() {
  try {
    const [callsResponse, proofsResponse] = await Promise.all([
      fetch(`${API_BASE}/api/agent/calls`),
      fetch(`${API_BASE}/api/proofs`),
    ]);

    const callsData = await callsResponse.json();
    const proofsData = await proofsResponse.json();

    renderAgentCalls(callsData.calls || []);
    renderProofVault(proofsData.proofs || []);
  } catch (error) {
    console.log("Log loading failed:", error.message);
  }
}

function renderAgentCalls(calls) {
  const container = $("agentCalls");

  if (!calls.length) {
    container.innerHTML = `<p class="empty-text">No agent calls yet.</p>`;
    return;
  }

  container.innerHTML = calls
    .slice(0, 6)
    .map(
      (call) => `
        <div class="log-item">
          <strong>${call.callerAgent} → ${call.serviceAgent}</strong>
          <p>${call.token} · ${call.clearanceStatus} · Score ${call.riskScore}/100</p>
          <p>${call.createdAtUTC}</p>
        </div>
      `
    )
    .join("");
}

function renderProofVault(proofs) {
  const container = $("proofVault");

  if (!proofs.length) {
    container.innerHTML = `<p class="empty-text">No proofs generated yet.</p>`;
    return;
  }

  container.innerHTML = proofs
    .slice(0, 6)
    .map(
      (proof) => `
        <div class="log-item">
          <strong>${proof.proofId} · ${proof.token}</strong>
          <p>${proof.clearanceStatus} · Score ${proof.riskScore}/100</p>
          <p>Hash: ${shortText(proof.proofHash, 18, 10)}</p>
        </div>
      `
    )
    .join("");
}

async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    const data = await response.json();

    if (data.success) {
      $("missionStatus").innerText = "SentinelX backend online";
    }
  } catch (error) {
    $("missionStatus").innerText = "Backend not connected";
  }
}

$("clearanceBtn").addEventListener("click", requestClearance);
$("a2aBtn").addEventListener("click", simulateA2A);
$("demoBtn").addEventListener("click", loadDemoData);

resetTimeline();
checkHealth();
loadLogs();
