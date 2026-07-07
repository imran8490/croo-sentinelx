require("dotenv").config();
const { ethers } = require("ethers");

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)"
];

const ESCROW_ABI = [
  "function owner() view returns (address)",
  "function fundOrder(bytes32 orderId, address receiver, uint256 amount) external",
  "function releaseOrder(bytes32 orderId, string decision) external",
  "function blockOrder(bytes32 orderId, string decision) external",
  "function refundOrder(bytes32 orderId) external"
];

function isBlockedDecision(decision = "") {
  return String(decision).toUpperCase().includes("MISSION_BLOCKED");
}

async function executeEscrowAfterSentinelX({
  destinationAddress,
  amountUsdc = "0.01",
  sentinelDecision = "CLEARANCE_GRANTED"
}) {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new ethers.Wallet(process.env.ESCROW_PRIVATE_KEY, provider);

  const escrowAddress = process.env.SENTINELX_ESCROW_ADDRESS.toLowerCase();

  const usdc = new ethers.Contract(process.env.BASE_USDC_ADDRESS, ERC20_ABI, wallet);
  const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, wallet);

  if (!ethers.isAddress(destinationAddress)) {
    throw new Error("Invalid destinationAddress");
  }

  const decimals = await usdc.decimals();
  const amount = ethers.parseUnits(amountUsdc, decimals);

  const balance = await usdc.balanceOf(wallet.address);
  if (balance < amount) {
    throw new Error(`Not enough USDC. Balance: ${ethers.formatUnits(balance, decimals)}`);
  }

  const orderId = ethers.id(`sentinelx-${Date.now()}-${destinationAddress}`);

  console.log("Funding escrow order:", orderId);

  const allowance = await usdc.allowance(wallet.address, escrowAddress);
  let approveTxHash = null;

  if (allowance < amount) {
    const approveTx = await usdc.approve(escrowAddress, amount);
    await approveTx.wait();
    approveTxHash = approveTx.hash;
  }

  const fundTx = await escrow.fundOrder(orderId, destinationAddress, amount);
  await fundTx.wait();

  if (isBlockedDecision(sentinelDecision)) {
    const blockTx = await escrow.blockOrder(orderId, "MISSION_BLOCKED");
    await blockTx.wait();

    const refundTx = await escrow.refundOrder(orderId);
    await refundTx.wait();

    return {
      success: true,
      escrowStatus: "BLOCKED_AND_REFUNDED",
      orderId,
      approveTxHash,
      fundTx: fundTx.hash,
      blockTx: blockTx.hash,
      refundTx: refundTx.hash
    };
  }

  const releaseTx = await escrow.releaseOrder(orderId, "CLEARANCE_GRANTED");
  await releaseTx.wait();

  return {
    success: true,
    escrowStatus: "RELEASED_TO_DESTINATION",
    orderId,
    destinationAddress,
    amountUsdc,
    approveTxHash,
    fundTx: fundTx.hash,
    releaseTx: releaseTx.hash
  };
}

module.exports = { executeEscrowAfterSentinelX };
