require("dotenv").config();

const {
  runAlphaSwapOrder,
  extractSentinelXReport,
  isClearanceGranted,
} = require("./executeOrderRoute");

function nowUTC() {
  return new Date().toISOString();
}

function isAddress(addr) {
  return typeof addr === "string" && /^0x[a-fA-F0-9]{40}$/.test(addr.trim());
}

function logStep(step, data = {}) {
  const orderId = data.orderId ? ` order=${data.orderId}` : "";
  const status = data.status ? ` status=${data.status}` : "";
  console.log(`[${nowUTC()}] ${step}${orderId}${status}`);
}

async function maybeExecuteSwapAfterReport(report, walletAddress, recipientAddress) {
  if (!isClearanceGranted(report)) {
    console.log("🛑 Result declared:", report.decision || report.riskLevel || "NOT_SAFE");
    console.log("🛑 AlphaSwap stopped. Real swap was not executed.");
    return { swapExecuted: false, reason: "Stopped by SentinelX report" };
  }

  console.log("✅ Result declared: CLEARANCE GRANTED");

  if (String(process.env.EXECUTE_REAL_SWAP_AFTER_SENTINELX || "").toLowerCase() !== "true") {
    console.log("⚠️ Real swap env flag is OFF.");
    console.log("Set EXECUTE_REAL_SWAP_AFTER_SENTINELX=true to execute after SAFE report.");
    return { swapExecuted: false, reason: "EXECUTE_REAL_SWAP_AFTER_SENTINELX not enabled" };
  }

  const { executeUsdcToWethAfterClearance } = require("./safeSwapExecutor");

  console.log("🚀 SAFE report confirmed. Executing real Base USDC → WETH swap...");

  const result = await executeUsdcToWethAfterClearance({
    recipientAddress: recipientAddress || process.env.SWAP_RECIPIENT_ADDRESS || walletAddress,
    amountUsdc: process.env.DEFAULT_SWAP_USDC_AMOUNT || "0.05",
    minWethOut: process.env.DEFAULT_MIN_WETH_OUT || "0",
  });

  console.log("✅ Swap result:", JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const walletAddress = process.env.DEMO_WALLET_ADDRESS || "";

  if (!isAddress(walletAddress)) {
    throw new Error("Set DEMO_WALLET_ADDRESS in .env with a valid 0x wallet address");
  }

  const payload = {
    walletAddress,
    recipientAddress: recipientAddress || process.env.SWAP_RECIPIENT_ADDRESS || walletAddress,
    token: process.env.DEMO_TOKEN || "BNB",
    chain: process.env.DEMO_CHAIN || "BSC",
    tokenContract: process.env.DEMO_TOKEN_CONTRACT || "",
    comment:
      process.env.DEMO_COMMENT ||
      `Pre-swap safety check. AlphaSwap must hire SentinelX first and execute only after CLEARANCE GRANTED.`,
  };

  console.log("🚀 AlphaSwap Requester started");
  console.log("➡️ Flow: AlphaSwap → CROO hire SentinelX → report declared → SAFE only real swap");
  console.log("📋 Mission:", JSON.stringify(payload, null, 2));

  const orderResult = await runAlphaSwapOrder(payload, logStep);
  const report = extractSentinelXReport(orderResult.delivery, { orderId: orderResult.orderId });

  console.log("\n📄 SentinelX report declared:");
  console.log(JSON.stringify(report, null, 2));

  report.destinationAddress = report.destinationAddress || payload.recipientAddress;
  report.recipientAddress = report.recipientAddress || payload.recipientAddress;

  const swap = await maybeExecuteSwapAfterReport(report, payload.walletAddress, payload.recipientAddress);

  console.log("\n🏁 Final AlphaSwap result:");
  console.log(
    JSON.stringify(
      {
        orderId: orderResult.orderId,
        negotiationId: orderResult.negotiationId,
        decision: report.decision || report.riskLevel,
        swap,
        completedAtUTC: nowUTC(),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("❌ AlphaSwap requester failed:", err.message || err);
  process.exit(1);
});
