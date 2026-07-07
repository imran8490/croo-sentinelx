require("dotenv").config();

const { ethers } = require("ethers");
const { runSafetyCheck } = require("./riskEngine");

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)"
];

const UNISWAP_V3_ROUTER_ABI = [
  // Base Uniswap SwapRouter02 exactInputSingle uses NO deadline field.
  // Correct selector: 0x04e45aaf
  // Old deadline ABI creates selector 0x414bf389 and reverts on Base router 0x262666...
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)"
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} in .env`);
  }
  return value;
}

function isBlocked(report = {}) {
  const text = JSON.stringify(report).toLowerCase();

  return (
    report.decision === "MISSION BLOCKED" ||
    report.riskLevel === "BLOCK" ||
    Number(report.riskScore) >= 100 ||
    text.includes("confirmed honeypot") ||
    text.includes("honeypot token") ||
    text.includes("honeypot")
  );
}

function assertAddress(address, label) {
  if (!ethers.isAddress(address)) {
    throw new Error(`Invalid ${label}: ${address}`);
  }
}

function extractRawTxFromError(err = {}) {
  const candidates = [
    err?.transaction,
    err?.rawTransaction,
    err?.payload?.params?.[0],
    err?.info?.payload?.params?.[0],
    err?.error?.payload?.params?.[0],
    err?.error?.data?.tx,
    err?.error?.data?.rawTransaction,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value) && value.length > 100) {
      return value;
    }
  }

  const text = JSON.stringify(err, Object.getOwnPropertyNames(err));
  const match = text.match(/0x[0-9a-fA-F]{200,}/);
  return match ? match[0] : null;
}

function isAlreadyKnownError(err = {}) {
  const text = String(err?.message || err?.shortMessage || JSON.stringify(err, Object.getOwnPropertyNames(err)) || "").toLowerCase();
  return text.includes("already known") || text.includes("known transaction");
}

function hashRawTx(rawTx) {
  return rawTx ? ethers.keccak256(rawTx) : null;
}

async function waitForKnownTx(provider, txHash, timeoutMs = 180000) {
  if (!txHash) return null;

  try {
    return await provider.waitForTransaction(txHash, 1, timeoutMs);
  } catch {
    return null;
  }
}

async function approveIfNeeded({ token, owner, spender, amountIn, provider }) {
  const allowance = await token.allowance(owner, spender);

  if (allowance >= amountIn) {
    return {
      approvalNeeded: false,
      approvalTxHash: null
    };
  }

  try {
    const approveTx = await token.approve(spender, amountIn);
    const approveReceipt = await approveTx.wait();

    return {
      approvalNeeded: true,
      approvalTxHash: approveTx.hash,
      approvalBlockNumber: approveReceipt.blockNumber
    };
  } catch (err) {
    if (!isAlreadyKnownError(err)) throw err;

    const rawTx = extractRawTxFromError(err);
    const txHash = hashRawTx(rawTx);
    const receipt = await waitForKnownTx(provider, txHash);

    return {
      approvalNeeded: true,
      approvalTxHash: txHash,
      approvalBlockNumber: receipt?.blockNumber || null,
      alreadyKnown: true,
      reason: "Approval transaction was already submitted. Reusing the known transaction hash."
    };
  }
}

/**
 * SAFE REAL SWAP:
 * Agent wallet USDC -> WETH
 * WETH output goes to recipientAddress.
 */
async function executeUsdcToWethAfterClearance({
  recipientAddress,
  amountUsdc = "0.10",
  minWethOut = "0"
}) {
  const BASE_RPC_URL = requireEnv("BASE_RPC_URL");
  const SWAP_PRIVATE_KEY = requireEnv("SWAP_PRIVATE_KEY");
  const BASE_SWAP_ROUTER = requireEnv("BASE_SWAP_ROUTER");
  const BASE_USDC_ADDRESS = requireEnv("BASE_USDC_ADDRESS");
  const BASE_WETH_ADDRESS = requireEnv("BASE_WETH_ADDRESS");

  assertAddress(BASE_SWAP_ROUTER, "BASE_SWAP_ROUTER");
  assertAddress(BASE_USDC_ADDRESS, "BASE_USDC_ADDRESS");
  assertAddress(BASE_WETH_ADDRESS, "BASE_WETH_ADDRESS");
  assertAddress(recipientAddress, "recipientAddress");

  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
  const signer = new ethers.Wallet(SWAP_PRIVATE_KEY, provider);

  const agentWallet = signer.address;

  // SentinelX safety check first
  const safety = await runSafetyCheck({
    walletAddress: agentWallet,
    token: "USDC",
    chain: "BASE",
    tokenContract: BASE_USDC_ADDRESS,
    action: "Pre-swap safety check before executing USDC to WETH swap on Base."
  });

  if (isBlocked(safety)) {
    return {
      ok: true,
      swapAttempted: true,
      swapStatus: "BLOCKED_BEFORE_EXECUTION",
      routerTxSubmitted: false,
      txHash: null,
      agentWallet,
      recipientAddress,
      pair: "USDC/WETH",
      chain: "BASE",
      amountIn: `${amountUsdc} USDC`,
      reason: "SentinelX blocked the swap before router execution.",
      decision: "MISSION BLOCKED",
      riskScore: 100,
      safetyScore: 0,
      riskLevel: "BLOCK",
      safetyReport: safety
    };
  }

  if (safety.decision !== "CLEARANCE GRANTED") {
    return {
      ok: true,
      swapAttempted: true,
      swapStatus: "NOT_EXECUTED_CAUTION",
      routerTxSubmitted: false,
      txHash: null,
      agentWallet,
      recipientAddress,
      pair: "USDC/WETH",
      chain: "BASE",
      amountIn: `${amountUsdc} USDC`,
      reason: "Swap not executed because SentinelX did not return CLEARANCE GRANTED.",
      decision: safety.decision,
      riskScore: safety.riskScore,
      safetyScore: safety.safetyScore,
      riskLevel: safety.riskLevel,
      safetyReport: safety
    };
  }

  const usdc = new ethers.Contract(BASE_USDC_ADDRESS, ERC20_ABI, signer);
  const weth = new ethers.Contract(BASE_WETH_ADDRESS, ERC20_ABI, signer);
  const router = new ethers.Contract(BASE_SWAP_ROUTER, UNISWAP_V3_ROUTER_ABI, signer);

  const usdcDecimals = await usdc.decimals();
  const amountIn = ethers.parseUnits(String(amountUsdc), usdcDecimals);

  const balance = await usdc.balanceOf(agentWallet);
  if (balance < amountIn) {
    throw new Error(`Insufficient agent wallet USDC balance. Need ${amountUsdc} USDC on Base.`);
  }

  const approval = await approveIfNeeded({
    token: usdc,
    owner: agentWallet,
    spender: BASE_SWAP_ROUTER,
    amountIn,
    provider
  });

  const allowZeroMinOut = process.env.DEMO_ALLOW_ZERO_MIN_OUT === "true";
  if (!allowZeroMinOut && (!minWethOut || String(minWethOut) === "0")) {
    throw new Error("minWethOut required unless DEMO_ALLOW_ZERO_MIN_OUT=true");
  }

  const amountOutMinimum = ethers.parseUnits(String(minWethOut || "0"), 18);
  const fee = Number(process.env.BASE_USDC_WETH_FEE || 500);

  const params = {
    tokenIn: BASE_USDC_ADDRESS,
    tokenOut: BASE_WETH_ADDRESS,
    fee,
    recipient: recipientAddress,
    amountIn,
    amountOutMinimum,
    sqrtPriceLimitX96: 0
  };

  const wethBefore = await weth.balanceOf(recipientAddress);

  let swapTxHash;
  let swapReceipt = null;
  let swapAlreadyKnown = false;

  try {
    const swapTx = await router.exactInputSingle(params);
    swapTxHash = swapTx.hash;
    swapReceipt = await swapTx.wait();
  } catch (err) {
    if (!isAlreadyKnownError(err)) throw err;

    const rawTx = extractRawTxFromError(err);
    swapTxHash = hashRawTx(rawTx);
    swapAlreadyKnown = true;

    if (!swapTxHash) {
      throw new Error("Swap transaction is already known, but the raw transaction hash could not be extracted.");
    }

    swapReceipt = await waitForKnownTx(provider, swapTxHash);
  }

  const wethAfter = await weth.balanceOf(recipientAddress);
  const wethReceived = wethAfter >= wethBefore ? wethAfter - wethBefore : 0n;

  return {
    ok: true,
    swapAttempted: true,
    swapStatus: swapReceipt ? "EXECUTED_AFTER_CLEARANCE" : "SUBMITTED_OR_ALREADY_KNOWN",
    routerTxSubmitted: true,
    txHash: swapTxHash,
    baseExplorerUrl: `https://basescan.org/tx/${swapTxHash}`,
    blockNumber: swapReceipt?.blockNumber || null,
    alreadyKnown: swapAlreadyKnown,
    agentWallet,
    recipientAddress,
    pair: "USDC/WETH",
    inputToken: "USDC",
    outputToken: "WETH",
    chain: "BASE",
    amountIn: `${amountUsdc} USDC`,
    amountOut: `${ethers.formatUnits(wethReceived, 18)} WETH`,
    outputTokenPriceSource: "WETH uses ETH market price",
    decision: safety.decision,
    riskScore: safety.riskScore,
    safetyScore: safety.safetyScore,
    riskLevel: safety.riskLevel,
    approval,
    reason: swapAlreadyKnown
      ? "SentinelX returned CLEARANCE GRANTED. Swap transaction was already submitted, so the existing transaction hash is reused."
      : "SentinelX returned CLEARANCE GRANTED, so AlphaSwap executed USDC to WETH swap from the external source wallet to the receiver wallet.",
    safetyReport: safety
  };
}

/**
 * HONEYPOT BLOCK DEMO:
 * No real swap.
 * It proves swap attempt is blocked before router execution.
 */
async function attemptHoneypotSwapBlocked({
  walletAddress,
  tokenContract,
  amountIn = "0.001"
}) {
  assertAddress(walletAddress, "walletAddress");
  assertAddress(tokenContract, "tokenContract");

  const safety = await runSafetyCheck({
    walletAddress,
    token: "HONEYPOT",
    chain: "BSC",
    tokenContract,
    action: "Attempted honeypot swap safety gate before router execution."
  });

  if (isBlocked(safety)) {
    return {
      ok: true,
      swapAttempted: true,
      swapStatus: "BLOCKED_BEFORE_EXECUTION",
      routerTxSubmitted: false,
      txHash: null,
      pair: "HONEYPOT/USDT",
      chain: "BSC",
      token: "HONEYPOT",
      tokenContract,
      amountIn,
      reason: "SentinelX detected a confirmed honeypot token and blocked the swap before execution.",
      decision: "MISSION BLOCKED",
      riskScore: 100,
      safetyScore: 0,
      riskLevel: "BLOCK",
      flags: safety.flags || ["Confirmed honeypot token"],
      safetyReport: safety
    };
  }

  return {
    ok: true,
    swapAttempted: true,
    swapStatus: "READY_FOR_EXECUTION_BUT_NOT_EXECUTED",
    routerTxSubmitted: false,
    txHash: null,
    pair: "HONEYPOT/USDT",
    chain: "BSC",
    token: "HONEYPOT",
    tokenContract,
    amountIn,
    reason: "SentinelX did not block this token. Demo still does not execute honeypot swaps.",
    decision: safety.decision,
    riskScore: safety.riskScore,
    safetyScore: safety.safetyScore,
    riskLevel: safety.riskLevel,
    safetyReport: safety
  };
}

module.exports = {
  executeUsdcToWethAfterClearance,
  attemptHoneypotSwapBlocked
};
