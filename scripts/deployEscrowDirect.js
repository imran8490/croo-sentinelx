require("dotenv").config();
const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");

async function main() {
  if (!process.env.BASE_RPC_URL) throw new Error("Missing BASE_RPC_URL");
  if (!process.env.DEPLOY_PRIVATE_KEY) throw new Error("Missing DEPLOY_PRIVATE_KEY");
  if (!process.env.BASE_USDC_ADDRESS) throw new Error("Missing BASE_USDC_ADDRESS");

  const contractPath = path.join(__dirname, "../contracts/SentinelXEscrow.sol");
  const source = fs.readFileSync(contractPath, "utf8");

  const input = {
    language: "Solidity",
    sources: {
      "SentinelXEscrow.sol": { content: source }
    },
    settings: {
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode"] }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    for (const err of output.errors) {
      console.log(err.formattedMessage);
    }
  }

  const contract = output.contracts["SentinelXEscrow.sol"]["SentinelXEscrow"];
  const abi = contract.abi;
  const bytecode = contract.evm.bytecode.object;

  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new ethers.Wallet(process.env.DEPLOY_PRIVATE_KEY, provider);

  console.log("Deploy wallet:", wallet.address);

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const escrow = await factory.deploy(process.env.BASE_USDC_ADDRESS.toLowerCase());

  await escrow.waitForDeployment();

  console.log("SentinelXEscrow deployed:", await escrow.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
