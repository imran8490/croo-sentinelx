(function () {
  const steps = ["request", "accept", "pay", "deliver", "clear"];
  let currentStep = 0;
  let activeRun = false;
  let finished = false;
  let ignoreOldJsonUntil = 0;

  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
  }

  function render() {
    steps.forEach((name, index) => {
      const box = el("pf-" + name);
      if (!box) return;

      box.classList.remove("active", "done", "error");

      if (currentStep >= 5) {
        box.classList.add("done");
      } else if (index + 1 < currentStep) {
        box.classList.add("done");
      } else if (index + 1 === currentStep) {
        box.classList.add("active");
      }
    });
  }

  function resetFlow() {
    currentStep = 0;
    finished = false;
    activeRun = true;
    ignoreOldJsonUntil = Date.now() + 60000;

    steps.forEach((name) => {
      const box = el("pf-" + name);
      if (!box) return;
      box.classList.remove("active", "done", "error");
    });

    setText("paymentLiveText", "Live");
    setText("paymentFlowMessage", "Starting real CROO A2A order...");
  }

  function go(step, message) {
    if (finished && step < 5) return;
    if (step < currentStep) return;

    currentStep = step;

    if (step >= 5) {
      finished = true;
      activeRun = false;
      currentStep = 5;
      setText("paymentLiveText", "Completed");
      setText("paymentFlowMessage", message || "CROO lifecycle complete: LOCK → DELIVER → CLEAR.");
      setText("paymentStatus", "CLEARED");
    } else {
      setText("paymentLiveText", "Live");
      if (message) setText("paymentFlowMessage", message);
    }

    render();
  }

  function errorFlow(message) {
    if (finished) return;

    const box = el("pf-" + steps[Math.max(0, currentStep - 1)]);
    if (box) {
      box.classList.remove("active");
      box.classList.add("error");
    }

    setText("paymentLiveText", "Needs attention");
    setText("paymentFlowMessage", message || "CROO order needs attention.");
  }

  function readStatusText() {
    const status = el("executeStatus");
    const t = String(status ? status.textContent : "").toLowerCase();

    if (!t.trim()) return;

    if (t.includes("timed out")) {
      go(4, "SentinelX delivered or is waiting for CROO clear. Check CROO site for final status.");
      return;
    }

    if (t.includes("failed") || t.includes("error")) {
      errorFlow(status.textContent);
      return;
    }

    if (t.includes("done") || t.includes("completed") || t.includes("cleared") || t.includes("real order completed")) {
      go(5, "CROO lifecycle complete: LOCK → DELIVER → CLEAR.");
      return;
    }

    if (t.includes("delivered") || t.includes("delivering") || t.includes("delivery")) {
      go(4, "SentinelX risk report delivered to CROO.");
      return;
    }

    if (t.includes("paid") || t.includes("payment") || t.includes("escrow") || t.includes("lock")) {
      go(3, "CROO locked the USDC service payment.");
      return;
    }

    if (t.includes("accepted") || t.includes("accept")) {
      go(2, "SentinelX accepted the A2A safety mission.");
      return;
    }

    if (t.includes("request") || t.includes("negotiation") || t.includes("created")) {
      go(1, "AlphaSwap created a real CROO A2A order.");
    }
  }

  function readJsonText() {
    if (activeRun && Date.now() < ignoreOldJsonUntil && !finished) return;

    const raw = el("rawJson");
    if (!raw) return;

    try {
      const data = JSON.parse(raw.textContent || "{}");
      const status = String(data.status || "").toLowerCase();
      const lifecycle = Array.isArray(data.lifecycle)
        ? data.lifecycle.map((x) => String(x).toUpperCase())
        : [];

      if (
        lifecycle.includes("CLEAR") ||
        lifecycle.includes("CLEARED") ||
        status.includes("completed") ||
        status.includes("cleared") ||
        data.clearTxHash ||
        data.clearAt
      ) {
        go(5, "CROO lifecycle complete: LOCK → DELIVER → CLEAR.");
      } else if (status.includes("delivering")) {
        go(4, "SentinelX report delivered. Waiting for CROO clear.");
      } else if (status.includes("paid")) {
        go(3, "CROO payment locked.");
      } else if (status.includes("created")) {
        go(1, "CROO order created.");
      }
    } catch {}
  }

  document.addEventListener("DOMContentLoaded", () => {
    const executeBtn = el("executeBtn");
    const executeStatus = el("executeStatus");
    const rawJson = el("rawJson");

    if (executeBtn) {
      executeBtn.addEventListener("click", () => {
        resetFlow();
        go(1, "AlphaSwap is creating a real CROO A2A order...");
      });
    }

    if (executeStatus) {
      new MutationObserver(readStatusText).observe(executeStatus, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    if (rawJson) {
      new MutationObserver(readJsonText).observe(rawJson, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    setInterval(() => {
      readStatusText();
      readJsonText();
      render();
    }, 700);
  });
})();
