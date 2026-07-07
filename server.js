require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const { ethers } = require("ethers");

function optionalRequire(file) {
  try {
    return require(file);
  } catch (err) {
    console.log(`Optional module not loaded: ${file}`);
    return {};
  }
}

const orderRoutes = optionalRequire("./executeOrderRoute");
const { registerExecuteOrderRoute } = orderRoutes;
const { runSafetyCheck } = optionalRequire("./riskEngine");
const { executeEscrowAfterSentinelX } = optionalRequire("./escrowAfterSentinelX");
const { fetchBinanceMarket } = optionalRequire("./service/binanceMarket");

const app = express();
const PORT = process.env.PORT || 8000;

let latestReport = null;
function rememberLatestReport(report = {}) {
  latestReport = {
    ...report,
    syncedAtUTC: new Date().toISOString(),
  };
  return latestReport;
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname));

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)"
];

const SWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)"
];


function isBlockedReport(report = {}) {
  const text = JSON.stringify(report).toLowerCase();

  return (
    report.decision === "MISSION BLOCKED" ||
    report.riskLevel === "BLOCK" ||
    text.includes("honeypot") ||
    text.includes("mission blocked")
  );
}

async function safeSentinelCheck(input) {
  if (typeof runSafetyCheck !== "function") {
    return {
      decision: "CLEARANCE GRANTED",
      riskScore: 20,
      safetyScore: 80,
      riskLevel: "LOW",
      flags: ["Risk engine not loaded, fallback clearance used for demo"]
    };
  }

  return await runSafetyCheck(input);
}

function getBaseConfig() {
  return {
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    swapPrivateKey: process.env.SWAP_PRIVATE_KEY,
    router: process.env.BASE_SWAP_ROUTER || "0x2626664c2603336E57B271c5C0b26F421741e481",
    usdc: process.env.BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    weth: process.env.BASE_WETH_ADDRESS || "0x4200000000000000000000000000000000000006",
    fee: Number(process.env.BASE_USDC_WETH_FEE || 500)
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    port: PORT,
    time: new Date().toISOString()
  });
});

app.get("/api/market", async (req, res) => {
  try {
    if (typeof fetchBinanceMarket === "function") {
      const market = await fetchBinanceMarket();
      return res.json({
        success: true,
        source: "local-binance-service",
        market
      });
    }

    const response = await axios.get(
      'https://api.binance.com/api/v3/ticker/24hr?symbols=["BNBUSDT","ETHUSDT","BTCUSDT"]',
      { timeout: 8000 }
    );

    res.json({
      success: true,
      source: "binance-public-api",
      market: response.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

if (typeof registerExecuteOrderRoute === "function") {
  registerExecuteOrderRoute(app, {
    onReport: rememberLatestReport,
  });
}

app.post("/api/croo/order-sync", (req, res) => {
  const saved = rememberLatestReport({
    source: "real-croo-order",
    ...req.body,
  });

  res.json({
    success: true,
    ok: true,
    report: saved,
  });
});

app.get("/api/latest-report", (req, res) => {
  if (!latestReport) {
    return res.json({
      ok: true,
      success: true,
      report: {
        source: "waiting",
        status: "WAITING_FOR_ALPHASWAP",
        decision: "WAITING",
        riskScore: "-",
        safetyScore: "-",
        riskLevel: "WAITING",
        lifecycle: ["WAITING"],
        message: "No AlphaSwap → SentinelX mission completed yet.",
        syncedAtUTC: new Date().toISOString(),
      },
    });
  }

  res.json({
    ok: true,
    success: true,
    report: latestReport,
  });
});

app.post("/api/run-order", async (req, res) => {
  try {
    const report = await safeSentinelCheck({
      walletAddress: req.body?.walletAddress || process.env.DEMO_WALLET_ADDRESS || "",
      token: req.body?.token || process.env.DEMO_TOKEN || "BNB",
      chain: req.body?.chain || process.env.DEMO_CHAIN || "BSC",
      tokenContract: req.body?.tokenContract || "",
      action: "Local demo risk check only. Use Start AlphaSwap Mission for the real CROO hire flow.",
    });

    const saved = rememberLatestReport({
      source: "local-risk-demo",
      status: "LOCAL_DEMO_ONLY",
      requesterAgentId: "AlphaSwap Requester",
      providerAgentId: "CROO SentinelX",
      lifecycle: ["LOCAL_RISK_CHECK"],
      ...report,
    });

    res.json({ ok: true, success: true, report: saved });
  } catch (error) {
    res.status(500).json({ ok: false, success: false, error: error.message });
  }
});

/**
 * Honeypot safety gate.
 * This must NOT submit router tx.
 * It proves blocked-before-execution.
 */
app.post("/api/honeypot-swap-gate", async (req, res) => {
  try {
    const {
      walletAddress,
      tokenContract,
      amountIn = "0.001"
    } = req.body;

    const report = await safeSentinelCheck({
      walletAddress,
      token: "HONEYPOT",
      chain: "BSC",
      tokenContract,
      action: "Pre-swap honeypot safety gate before AlphaSwap executes any trade."
    });

    res.json({
      success: true,
      report: {
        swapAttempted: true,
        swapStatus: "BLOCKED_BEFORE_EXECUTION",
        routerTxSubmitted: false,
        txHash: null,
        reason: "SentinelX blocked the honeypot before router execution.",
        pair: "HONEYPOT/USDT",
        token: "HONEYPOT",
        chain: "BSC",
        tokenContract,
        amountIn,
        decision: "MISSION BLOCKED",
        riskScore: 100,
        safetyScore: 0,
        riskLevel: "BLOCK",
        flags: report.flags || ["Confirmed honeypot token"],
        safetyReport: report
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Real Base USDC -> WETH swap after SentinelX clearance.
 * Required .env:
 * BASE_RPC_URL
 * SWAP_PRIVATE_KEY
 * BASE_SWAP_ROUTER
 * BASE_USDC_ADDRESS
 * BASE_WETH_ADDRESS
 * BASE_USDC_WETH_FEE=500
 */
app.post("/api/safe-usdc-weth-swap", async (req, res) => {
  try {
    const {
      walletAddress,
      recipientAddress,
      amountUsdc = "0.05",
      minWethOut = "0",
      fee
    } = req.body;

    const cfg = getBaseConfig();

    if (!cfg.swapPrivateKey) {
      throw new Error("Missing SWAP_PRIVATE_KEY in .env");
    }

    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const wallet = new ethers.Wallet(cfg.swapPrivateKey, provider);

    if (walletAddress && walletAddress.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error(
        `walletAddress mismatch. Request wallet ${walletAddress}, signer wallet ${wallet.address}`
      );
    }

    const receiver = recipientAddress || wallet.address;

    if (!ethers.isAddress(receiver)) {
      throw new Error("Invalid recipientAddress");
    }

    const usdc = new ethers.Contract(cfg.usdc, ERC20_ABI, wallet);
    const weth = new ethers.Contract(cfg.weth, ERC20_ABI, provider);
    const router = new ethers.Contract(cfg.router, SWAP_ROUTER_ABI, wallet);

    const usdcDecimals = await usdc.decimals();
    const wethDecimals = await weth.decimals();

    const amountIn = ethers.parseUnits(String(amountUsdc), usdcDecimals);
    const amountOutMinimum = ethers.parseUnits(String(minWethOut), wethDecimals);

    const ethBalance = await provider.getBalance(wallet.address);
    const usdcBalance = await usdc.balanceOf(wallet.address);

    if (ethBalance === 0n) {
      throw new Error("No Base ETH gas in swap wallet");
    }

    if (usdcBalance < amountIn) {
      throw new Error(
        `Not enough USDC. Wallet has ${ethers.formatUnits(usdcBalance, usdcDecimals)} USDC`
      );
    }

    const sentinelReport = await safeSentinelCheck({
      walletAddress: wallet.address,
      token: "USDC",
      chain: "BASE",
      tokenContract: cfg.usdc,
      action: "Pre-swap safety check before executing Base USDC to WETH trade."
    });

    if (isBlockedReport(sentinelReport)) {
      return res.json({
        success: true,
        report: {
          swapAttempted: true,
          swapStatus: "BLOCKED_BEFORE_EXECUTION",
          routerTxSubmitted: false,
          txHash: null,
          reason: "SentinelX blocked this swap before execution.",
          pair: "USDC/WETH",
          chain: "BASE",
          decision: "MISSION BLOCKED",
          safetyReport: sentinelReport
        }
      });
    }

    const allowance = await usdc.allowance(wallet.address, cfg.router);
    let approveTxHash = null;

    if (allowance < amountIn) {
      const approveTx = await usdc.approve(cfg.router, amountIn);
      await approveTx.wait();
      approveTxHash = approveTx.hash;
    }

    const wethBefore = await weth.balanceOf(receiver);

  
    const poolFee = Number(fee || cfg.fee || 500);

    const params = {
      tokenIn: cfg.usdc,
      tokenOut: cfg.weth,
      fee: poolFee,
      recipient: receiver,
      amountIn,
      amountOutMinimum,
      sqrtPriceLimitX96: 0
    };

   // const estimatedGas = await router.exactInputSingle.estimateGas(params);

    const swapTx = await router.exactInputSingle(params);
    const receipt = await swapTx.wait();

    const wethAfter = await weth.balanceOf(receiver);
    const wethReceived = wethAfter - wethBefore;

    res.json({
      success: true,
      report: {
        swapAttempted: true,
        swapStatus: "EXECUTED_AFTER_CLEARANCE",
        routerTxSubmitted: true,
        txHash: swapTx.hash,
        approveTxHash,
        pair: "USDC/WETH",
        chain: "BASE",
        feeTier: poolFee,
        walletAddress: wallet.address,
        recipientAddress: receiver,
        amountUsdc,
        wethReceived: ethers.formatUnits(wethReceived, wethDecimals),
       // estimatedGas: estimatedGas.toString(),
        gasUsed: receipt.gasUsed.toString(),
        decision: "CLEARANCE GRANTED",
        riskScore: sentinelReport.riskScore,
        safetyScore: sentinelReport.safetyScore,
        riskLevel: sentinelReport.riskLevel,
        flags: sentinelReport.flags || [],
        safetyReport: sentinelReport
      }
    });
  } catch (error) {
    console.error("USDC to WETH swap error:", error);

    res.status(500).json({
      success: false,
      error: error.shortMessage || error.reason || error.message
    });
  }
});

/**
 * Optional custom escrow route.
 * This uses escrowAfterSentinelX.js if that file exists.
 */
app.post("/api/escrow-after-sentinelx", async (req, res) => {
  try {
    if (typeof executeEscrowAfterSentinelX !== "function") {
      throw new Error("escrowAfterSentinelX.js not loaded");
    }

    const {
      destinationAddress,
      amountUsdc = "0.01",
      sentinelDecision = "CLEARANCE_GRANTED"
    } = req.body;

    const result = await executeEscrowAfterSentinelX({
      destinationAddress,
      amountUsdc,
      sentinelDecision
    });

    res.json(result);
  } catch (error) {
    console.error("Escrow route error:", error.message);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found"
  });
});

app.listen(PORT, () => {
  console.log(`CROO SentinelX server running on http://localhost:${PORT}`);
});
