
# CROO SentinelX

## Pre-Swap Safety Clearance Agent for CROO A2A

CROO SentinelX is a pre-swap safety clearance agent built on the CROO A2A ecosystem.

Before a trading agent executes a swap, it should know whether the trade is safe or risky. SentinelX acts as a safety checkpoint before execution.

In this project:

- AlphaSwap is the requester agent.
- SentinelX is the provider agent.
- CROO handles the A2A order, service payment, delivery proof, and settlement.
- SentinelX delivers a risk report before AlphaSwap executes the trade.

SentinelX does not execute swaps directly. It provides a pre-swap safety report.

---

## Project Summary

AlphaSwap wants to execute a BNB to USDT trade.

Before the trade happens, AlphaSwap hires SentinelX through CROO. SentinelX scans risk and returns a safety clearance report with a decision, risk score, safety score, proof hash, and delivery data.

CROO manages the complete A2A lifecycle:

Order Request -> Accept Mission -> Payment Lock -> Report Delivery -> Clear / Complete

---

## Why SentinelX Matters

Autonomous trading agents can act fast, but fast execution can also create risk.

Before a swap, an agent should check:

- Wallet risk
- Token contract risk
- Market movement
- Honeypot or scam token signals
- Final safety decision

SentinelX gives trading agents a safety layer before they act.

---

## How It Works

AlphaSwap Requester Agent
        |
        v
Creates A2A safety request through CROO
        |
        v
CROO creates order and locks service payment
        |
        v
SentinelX Provider Agent accepts the mission
        |
        v
SentinelX runs the risk engine
        |
        v
SentinelX delivers safety report to CROO
        |
        v
CROO clears the order and completes settlement

---

## Agent Roles

### AlphaSwap Requester

AlphaSwap is the requester agent.

It represents a trading agent that wants to execute a BNB to USDT trade, but first requests a safety clearance report.

### CROO SentinelX Provider

SentinelX is the provider agent.

It listens for CROO orders, accepts safety check missions, runs the risk engine, and delivers the final report.

### CROO Network

CROO handles:

- Agent-to-agent order creation
- Service payment
- Payment lock
- Report delivery tracking
- Proof JSON
- Settlement lifecycle

---

## Core Features

- Real CROO A2A provider agent
- AlphaSwap requester agent
- Real CROO order execution
- USDC service payment through CROO
- Live payment lifecycle dashboard
- Risk score and safety score
- Proof hash generation
- CROO delivery JSON proof
- Wallet risk layer
- Market risk layer
- Token contract risk layer
- Honeypot detection proof
- Mission blocked verdict for risky token contracts

---

## Risk Engine

SentinelX calculates a safety report using multiple layers.

### 1. Market Risk Layer

Checks market data such as token price and 24-hour movement.

Example:

Token: BNB
Market Source: CoinGecko
24h Movement: checked

### 2. Wallet Risk Layer

Checks the target wallet address when provided.

Example:

Wallet Address: 0x08e391A5ea432DB8a38d4a3155fF386146cE6c94
Wallet Layer: Active

### 3. Token Contract Risk Layer

Checks BEP20 token contracts when a contract address is provided.

For native BNB, token contract scanning is skipped because BNB is a native coin and does not have a BEP20 contract address.

For BEP20 tokens, SentinelX can scan the token contract.

### 4. Honeypot Detection

SentinelX can detect risky token contracts and return a block verdict before a swap is executed.

---

## Safety Decisions

SentinelX returns one of three decisions:

CLEARANCE GRANTED
CAUTION REQUIRED
MISSION BLOCKED

### CLEARANCE GRANTED

The trade appears safe enough to continue.

### CAUTION REQUIRED

The trade has some risk signals and should be reviewed carefully.

### MISSION BLOCKED

The token or trade is risky enough that the swap should not proceed.

---

## Real CROO A2A Payment Proof

CROO SentinelX completed a real A2A service flow through CROO.

AlphaSwap Requester hired SentinelX Provider through CROO. CROO locked the USDC service payment, SentinelX delivered the safety clearance report, and CROO completed the settlement.

The CROO lifecycle showed:

LOCK -> DELIVER -> CLEAR

This proves:

Real CROO A2A order
Real USDC service payment
Real SentinelX report delivery
Real CROO settlement

Balance movement also confirmed the payment settlement:

AlphaSwap Requester balance decreased
SentinelX Provider balance increased

This proves that SentinelX is not only a local simulation. It completed a real CROO A2A service transaction.

---

## Honeypot Token Detection Proof

SentinelX also supports token-contract risk checks for BEP20 tokens on BSC.

To prove the token-risk layer, SentinelX was tested with a honeypot token contract address on BSC:

0x8f96e9348898b498a2b4677f4c8abdad64e4349f

This test was a safety check only. No swap was executed.

SentinelX detected the token contract risk and returned:

Decision: MISSION BLOCKED
Risk Level: BLOCK
Flag: Confirmed honeypot token

This proves SentinelX can block a dangerous trade before AlphaSwap executes it.

---

## Important Scope

SentinelX does not execute swaps directly.

SentinelX provides a pre-swap safety clearance report before another agent executes the trade.

Correct scope:

AlphaSwap = trade intent / requester agent
SentinelX = pre-swap safety report provider
CROO = A2A order, payment, delivery proof, and settlement layer

This project proves a real CROO A2A service flow, not a direct token swap.

---

## Dashboard

The dashboard shows:

- Requester agent
- Provider agent
- Order ID
- Decision
- Risk score
- Safety score
- Proof hash
- Transaction hash
- Latest proof JSON
- Live CROO payment lifecycle

Lifecycle UI:

Order Request -> Accept Mission -> Payment Lock -> Report Delivery -> Clear / Complete

---

## Report Delivery

SentinelX delivers the report directly inside the CROO delivery JSON.

The dashboard may show:

Report URI: Embedded in CROO delivery JSON

This means the report is included in the CROO delivery payload and verified using:

- Proof hash
- Transaction hash
- CROO View JSON
- Delivery ID

---

## Demo Proof Checklist

The final demo shows:

CROO SentinelX dashboard
Server terminal running
Provider terminal running
Real CROO order execution
CROO order completed
LOCK -> DELIVER -> CLEAR lifecycle
Proof hash
Transaction hash
Delivery JSON
Payment settlement
Honeypot token blocked with MISSION BLOCKED

---

## Tech Stack

- Node.js
- Express.js
- CROO Network SDK
- CROO A2A order/payment flow
- CoinGecko market data
- GoPlus token security checks
- HTML / CSS / JavaScript dashboard

---

## Project Structure

SentinelX/
├── server.js
├── provider.js
├── requester.js
├── executeOrderRoute.js
├── riskEngine.js
├── package.json
├── README.md
├── .env.example
├── public/
│   ├── index.html
│   ├── app.js
│   └── paymentFlowStable.js
└── data/
    └── croo-orders.json

---

## Environment Setup

Create a .env file in the project root.

Do not commit .env to GitHub.

Example:

PORT=8000

CROO_API_URL=https://api.croo.network
CROO_WS_URL=wss://api.croo.network/ws

CROO_SDK_KEY=YOUR_SENTINELX_PROVIDER_KEY
CROO_API_KEY=YOUR_SENTINELX_PROVIDER_KEY

ALPHASWAP_SDK_KEY=YOUR_ALPHASWAP_REQUESTER_KEY

CROO_TARGET_SERVICE_ID=YOUR_SENTINELX_SERVICE_ID
CROO_SERVICE_ID=YOUR_SENTINELX_SERVICE_ID

CROO_AGENT_WALLET=YOUR_SENTINELX_PROVIDER_WALLET

DEMO_WALLET_ADDRESS=0x08e391A5ea432DB8a38d4a3155fF386146cE6c94
DEMO_TOKEN=BNB
DEMO_CHAIN=BSC

Important:

CROO_SDK_KEY and ALPHASWAP_SDK_KEY must be different.

If both keys are the same, CROO may treat the requester and provider as the same agent.

---

## Install

npm install

---

## Run the Dashboard Server

Terminal 1:

cd ~/SentinelX
npm start

Open:

http://localhost:8000

---

## Run the SentinelX Provider

Terminal 2:

cd ~/SentinelX
npm run provider

For a cleaner demo terminal, use:

npm run provider:clean

The provider listens for CROO orders and delivers the safety report.

---

## Run a Real CROO Order

Use the dashboard button:

Execute Real CROO Order

Example wallet:

0x08e391A5ea432DB8a38d4a3155fF386146cE6c94

Example comment:

Wallet: 0x08e391A5ea432DB8a38d4a3155fF386146cE6c94
Token: BNB
Chain: BSC
Action: Pre-swap safety clearance before AlphaSwap executes a BNB to USDT trade on BSC.

Expected result:

CROO order created
SentinelX accepted
Payment locked
Report delivered
CROO cleared/completed

---

## Honeypot Safety Test

This test proves token contract risk detection.

No swap is executed.

Wallet: 0x08e391A5ea432DB8a38d4a3155fF386146cE6c94
Token: HONEYPOT
Chain: BSC
TokenContract: 0x8f96e9348898b498a2b4677f4c8abdad64e4349f
Action: Honeypot safety check.

Expected result:

Decision: MISSION BLOCKED
Risk Level: BLOCK
Flag: Confirmed honeypot token

---

## API Endpoints

### Health Check

GET /api/health

### Local Risk Check

POST /api/risk-check

### Latest Report

GET /api/latest-report

### Execute Real CROO Order

POST /api/execute-order

---

## Example Safety Report

{
  "agent": "CROO SentinelX",
  "service": "Pre-trade Safety Clearance",
  "decision": "CAUTION REQUIRED",
  "riskScore": 40,
  "safetyScore": 60,
  "riskLevel": "CAUTION",
  "proofHash": "example-proof-hash",
  "lifecycle": ["LOCK", "DELIVER", "CLEAR"]
}

---

## Demo Video Script Summary

CROO SentinelX is a pre-swap safety agent built on CROO A2A.

AlphaSwap hires SentinelX before executing a BNB to USDT trade.

CROO locks the USDC service payment.

SentinelX runs the risk engine and delivers a safety report.

The order is completed with LOCK, DELIVER, and CLEAR.

This proves real A2A payment settlement.

SentinelX does not execute the swap directly.

It provides safety clearance before another agent executes the trade.

---

## Security Notes

Do not upload these files or values to GitHub:

.env
API keys
Private keys
Wallet seed phrases
Secret tokens

Use .env.example for public configuration examples.

---

## Limitations

- SentinelX does not execute swaps directly.
- It provides a safety clearance report before execution.
- Native BNB does not have a token contract, so token-contract checks are skipped for native BNB.
- BEP20 token contract checks work when a token contract address is provided.
- Honeypot detection was tested using a contract address only. No unsafe swap was executed.

---

## Built By

Built by Imran.

---

## Final Summary

CROO SentinelX proves a real A2A service flow where AlphaSwap hires SentinelX, CROO handles payment and settlement, SentinelX delivers a pre-swap safety report, and risky honeypot contracts can be blocked before trade execution.

