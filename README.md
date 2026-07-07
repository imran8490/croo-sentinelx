//--------------------------------------------------------------------------------------------------------------------------------------------------------
CROO SentinelX – Pre-Swap Safety Clearance Agent for AlphaSwap
--------------------------------------------------------------------------------------------------------------------------------------------------------//

CROO SentinelX is a pre-swap safety clearance agent built for the CROO A2A ecosystem.

AlphaSwap is the requester agent. SentinelX is the provider agent. AlphaSwap cannot execute a swap directly. It must first hire SentinelX through CROO, wait for a verified safety report, and only continue if SentinelX returns CLEARANCE_GRANTED.

If SentinelX returns MISSION_BLOCKED or CAUTION, the swap stops before router execution.

--------------------------------------------------------------------------------------------------------------------------------------------------------
Problem:
--------------------------------------------------------------------------------------------------------------------------------------------------------
Autonomous trading agents can execute swaps quickly, but they also need a safety layer before touching the router.

Without a pre-swap safety gate, an agent may swap into risky tokens, honeypots, suspicious contracts, or unsafe market conditions.

CROO SentinelX solves this by forcing AlphaSwap to request a safety report before execution.

--------------------------------------------------------------------------------------------------------------------------------------------------------
Solution:
--------------------------------------------------------------------------------------------------------------------------------------------------------

CROO SentinelX works as a safety clearance provider.

AlphaSwap first creates a CROO A2A mission. SentinelX accepts the mission, checks the wallet, token, chain, and market risk, then delivers a safety report.

Only a CLEARANCE_GRANTED result unlocks the real swap.

MISSION_BLOCKED stops the swap before router execution.


Project Flow:

1. User starts AlphaSwap mission from the dashboard.
2. AlphaSwap requester creates a CROO A2A order.
3. SentinelX provider accepts the mission.
4. CROO payment is locked for the SentinelX safety report.5. 
5. SentinelX runs the risk engine.
6. SentinelX checks:
    -Wallet risk
    -Token risk
    -Chain information
    -Market risk
    -Honeypot signals
7. SentinelX delivers the safety report.
8. Dashboard declares the final result.
9. If result is CLEARANCE_GRANTED:
    -AlphaSwap unlocks the swap gate
    -External source wallet signs the transaction
    -USDC is swapped to WETH on Base
    -WETH is sent to the destination wallet
    -BaseScan transaction link is shown
10. If result is MISSION_BLOCKED:
    -AlphaSwap stops before router execution
    -No real swap transaction is submitted
    -Dashboard shows blocked proof

--------------------------------------------------------------------------------------------------------------------------------------------------------
Full A2A LifeCycle
--------------------------------------------------------------------------------------------------------------------------------------------------------

AlphaSwap Requester
↓
CROO Mission Created
↓
SentinelX Provider Accepts Mission
↓
CROO Payment Lock
↓
SentinelX Risk Engine Scan
↓
Report Delivered
↓
Result Declared
↓
CLEARANCE_GRANTED or MISSION_BLOCKED
↓
Real Swap or Stop

--------------------------------------------------------------------------------------------------------------------------------------------------------
Safe Swap Flow
--------------------------------------------------------------------------------------------------------------------------------------------------------

External Source Wallet
↓
Holds USDC on Base
↓
SentinelX Safety Check
↓
CLEARANCE_GRANTED
↓
USDC to WETH Swap
↓
WETH sent to Destination Wallet
↓
BaseScan Transaction Proof

In this flow, AlphaSwap is only the CROO requester agent. The real swap is executed from an external source wallet using the backend private key.

--------------------------------------------------------------------------------------------------------------------------------------------------------
Blocked Honeypot Flow
--------------------------------------------------------------------------------------------------------------------------------------------------------

AlphaSwap creates mission
↓
SentinelX scans risky token
↓
HONEYPOT detected
↓
MISSION_BLOCKED
↓
No router transaction
↓
Swap stopped before execution

This proves SentinelX is not just a report tool. It controls whether AlphaSwap can execute or not.

--------------------------------------------------------------------------------------------------------------------------------------------------------
Demo Results
--------------------------------------------------------------------------------------------------------------------------------------------------------

Safe Mission

Token: USDC
Chain: BASE
Route: USDC to WETH
Result: CLEARANCE_GRANTED
Swap Status: Real swap executed
Proof: BaseScan transaction hash and destination wallet proof

Blocked Mission

Token: HONEYPOT
Chain: BSC
Result: MISSION_BLOCKED
Swap Status: Stopped before router execution
Proof: No real swap transaction submitted
--------------------------------------------------------------------------------------------------------------------------------------------------------
Project Structure
--------------------------------------------------------------------------------------------------------------------------------------------------------

CROO-SentinelX
│
├── server.js
├── provider.js
├── Requester.js
├── executeOrderRoute.js
├── riskEngine.js
├── safeSwapExecutor.js
├── escrowAfterSentinelX.js
├── orderOrchestrator.js
├── hardhat.config.js
├── package.json
├── package-lock.json
├── README.md
├── .env.example
├── .gitignore
│
├── public
│ ├── index.html
│ ├── app.js
│ └── styles.css
│
├── scripts
│ └── contract / deployment helper scripts
│
└── service
└── optional market / helper services

Files Used

--------------------------------------------------------------------------------------------------------------------------------------------------------
server.js
--------------------------------------------------------------------------------------------------------------------------------------------------------
Main backend server.

It runs the dashboard API, handles AlphaSwap mission requests, syncs CROO order reports, and connects the frontend with the backend flow.

Main responsibilities:

	Start Express server
	Serve dashboard
	Receive AlphaSwap start mission request
	Trigger CROO order flow
	Store latest proof JSON
	Show transaction hash and BaseScan link
	Handle safe and blocked mission results

--------------------------------------------------------------------------------------------------------------------------------------------------------
provider.js
--------------------------------------------------------------------------------------------------------------------------------------------------------

SentinelX provider agent.

This file listens for CROO missions, accepts AlphaSwap requests, runs SentinelX risk checks, and delivers the final report back through CROO.

Main responsibilities:

	Start SentinelX provider
	Listen for CROO order events
	Accept missions
	Run risk engine
	Deliver report
	Sync result to local dashboard

--------------------------------------------------------------------------------------------------------------------------------------------------------
Requester.js
--------------------------------------------------------------------------------------------------------------------------------------------------------

AlphaSwap requester agent.

This file represents the requester side of the A2A flow. AlphaSwap creates a mission and hires SentinelX through CROO.

Main responsibilities:

	Create CROO negotiation
	Send mission requirements
	Wait for SentinelX acceptance
	Track CROO order ID
	Receive delivered report

--------------------------------------------------------------------------------------------------------------------------------------------------------
executeOrderRoute.js
--------------------------------------------------------------------------------------------------------------------------------------------------------

Main execution route.

This file controls the important rule: no SentinelX clearance means no swap.

Main responsibilities:

	Start AlphaSwap mission
	Hire SentinelX
	Wait for report
	Check decision
	If CLEARANCE_GRANTED, execute swap
	If MISSION_BLOCKED or CAUTION, stop swap
	Return final proof to dashboard

--------------------------------------------------------------------------------------------------------------------------------------------------------
riskEngine.js
--------------------------------------------------------------------------------------------------------------------------------------------------------

SentinelX risk engine.

This file checks token, wallet, chain, and market risk before a swap is allowed.

Main responsibilities:

	Check market data
	Check wallet risk
	Check token risk
	Detect honeypot mission
	Calculate risk score
	Calculate safety score
	Return CLEARANCE_GRANTED or MISSION_BLOCKED

--------------------------------------------------------------------------------------------------------------------------------------------------------
safeSwapExecutor.js
--------------------------------------------------------------------------------------------------------------------------------------------------------

Real swap executor.

This file executes the real USDC to WETH swap on Base only after SentinelX returns CLEARANCE_GRANTED.

Main responsibilities:

	Use external source wallet private key
	Check USDC balance
	Approve router if needed
	Execute USDC to WETH swap
	Send WETH output to destination wallet
	Return transaction hash
	Return BaseScan link

--------------------------------------------------------------------------------------------------------------------------------------------------------
escrowAfterSentinelX.js
--------------------------------------------------------------------------------------------------------------------------------------------------------

Escrow helper logic.

This file supports escrow-style post-SentinelX execution flow. It can be used for payment lock, release, block, or refund style logic.

Main responsibilities:

	Fund escrow order
	Release order after clearance
	Block order after failed safety result
	Refund blocked mission if needed

--------------------------------------------------------------------------------------------------------------------------------------------------------
orderOrchestrator.js
--------------------------------------------------------------------------------------------------------------------------------------------------------

Orchestration layer.

This file connects the order input, risk engine, report creation, proof hash, and optional contract delivery.

Main responsibilities:

	Accept order input
	Extract trade parameters
	Run SentinelX safety check
	Build proof report
	Generate proof hash
	Sync result to dashboard

--------------------------------------------------------------------------------------------------------------------------------------------------------
hardhat.config.js
--------------------------------------------------------------------------------------------------------------------------------------------------------

Hardhat configuration 

Used for smart contract deployment or contract interaction setup.

Main responsibilities:

	Configure Solidity version
	Configure Base network
	Load deploy wallet from environment variables

--------------------------------------------------------------------------------------------------------------------------------------------------------
public/index.html
--------------------------------------------------------------------------------------------------------------------------------------------------------
Frontend dashboard UI.

Main responsibilities:

	Show AlphaSwap mission form
	Show source wallet
	Show destination wallet
	Show swap amount
	Show CROO lifecycle
	Show SentinelX decision
	Show risk score and safety score
	Show transaction hash and BaseScan link
	Show latest proof JSON

--------------------------------------------------------------------------------------------------------------------------------------------------------
public/app.js
--------------------------------------------------------------------------------------------------------------------------------------------------------

Frontend dashboard logic.

Main responsibilities:

	Handle Start AlphaSwap Mission button
	Send request to backend
	Update lifecycle UI
	Render safe result
	Render blocked result
	Show proof JSON
	Show BaseScan link

--------------------------------------------------------------------------------------------------------------------------------------------------------
public/styles.css
--------------------------------------------------------------------------------------------------------------------------------------------------------

Dashboard styling.

Main responsibilities:

	Layout design
	Cards
	Timeline UI
	Status colors
	Safe / blocked indicators

--------------------------------------------------------------------------------------------------------------------------------------------------------
package.json
--------------------------------------------------------------------------------------------------------------------------------------------------------

Project dependency and script file.

Main responsibilities:

	Store Node.js dependencies
	Store project scripts
	Help install required packages using npm install

--------------------------------------------------------------------------------------------------------------------------------------------------------
.env.example
--------------------------------------------------------------------------------------------------------------------------------------------------------

Example environment configuration.

This file shows required environment variables without exposing private keys.

--------------------------------------------------------------------------------------------------------------------------------------------------------
.gitignore
--------------------------------------------------------------------------------------------------------------------------------------------------------

Git ignore file.

This prevents private and local files from being uploaded to GitHub.

--------------------------------------------------------------------------------------------------------------------------------------------------------
Environment Setup
--------------------------------------------------------------------------------------------------------------------------------------------------------

Create a local .env file and add your own keys.

PORT=8000

CROO_API_URL=https://api.croo.network
CROO_WS_URL=wss://api.croo.network/ws

ALPHASWAP_SDK_KEY=your_alphaswap_sdk_key
CROO_SDK_KEY=your_sentinelx_sdk_key
CROO_TARGET_SERVICE_ID=your_sentinelx_service_id

BASE_RPC_URL=https://mainnet.base.org
SWAP_PRIVATE_KEY=your_external_source_wallet_private_key

BASE_SWAP_ROUTER=0x2626664c2603336E57B271c5C0b26F421741e481
BASE_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
BASE_WETH_ADDRESS=0x4200000000000000000000000000000000000006
BASE_USDC_WETH_FEE=500

EXECUTE_REAL_SWAP_AFTER_SENTINX=true
DEFAULT_SWAP_USDC_AMOUNT=0.05
DEFAULT_MIN_WETH_OUT=0
DEMO_ALLOW_ZERO_MIN_OUT=true

Do not upload .env to GitHub. Do not share private keys or API keys publicly.

--------------------------------------------------------------------------------------------------------------------------------------------------------
Install
--------------------------------------------------------------------------------------------------------------------------------------------------------

Run:

npm install

--------------------------------------------------------------------------------------------------------------------------------------------------------
Run Dashboard Server
--------------------------------------------------------------------------------------------------------------------------------------------------------

Run:

node server.js

Open:

http://localhost:8000

--------------------------------------------------------------------------------------------------------------------------------------------------------
Run SentinelX Provider
--------------------------------------------------------------------------------------------------------------------------------------------------------

Open a second terminal and run:

node provider.js

The provider listens for CROO missions, accepts the mission, runs the risk engine, and delivers the SentinelX safety report.

--------------------------------------------------------------------------------------------------------------------------------------------------------
How To Test Safe Swap
--------------------------------------------------------------------------------------------------------------------------------------------------------

Use this mission:

Token: USDC
Chain: BASE
TokenContract: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Action: AlphaSwap wants to swap USDC to WETH. SentinelX must check safety first. 
        If the report says CLEARANCE_GRANTED, AlphaSwap executes the real swap. 
        If the report says CAUTION or MISSION_BLOCKED, AlphaSwap stops before router execution.

Expected result:

	Decision: CLEARANCE_GRANTED
	Real swap executed
	Transaction hash shown
	BaseScan link shown
	Destination wallet receives WETH

--------------------------------------------------------------------------------------------------------------------------------------------------------
How To Test Honeypot Block
--------------------------------------------------------------------------------------------------------------------------------------------------------

Use this mission:

Token: HONEYPOT
Chain: BSC
TokenContract: 0x8f96e9348898b49Ba2b4677f4c8bbdad64e4349f
Action: AlphaSwap wants to test a risky honeypot token before swap execution. 
        SentinelX must check the token contract first. 
        If the report says MISSION_BLOCKED, AlphaSwap must stop before router execution and no real swap should happen.

Expected result:

	Decision: MISSION_BLOCKED
	Risk Score: 100
	Safety Score: 0
	Router Tx: No tx
	Swap Status: Blocked before execution

--------------------------------------------------------------------------------------------------------------------------------------------------------
Dashboard Proof
--------------------------------------------------------------------------------------------------------------------------------------------------------

The dashboard shows:

	CROO order ID
	Requester agent
	Provider agent
	SentinelX decision
	Risk score
	Safety score
	Source wallet
	Destination wallet
	Transaction hash
	BaseScan link
	Latest proof JSON

--------------------------------------------------------------------------------------------------------------------------------------------------------
Important GitHub Upload Note
--------------------------------------------------------------------------------------------------------------------------------------------------------

Do not upload these files:

	.env
	node_modules
	screenshots
	backup files
	Zone.Identifier files
	local history JSON files
	private keys
	API keys

Recommended upload files:

	server.js
	provider.js
	Requester.js
	executeOrderRoute.js
	riskEngine.js
	safeSwapExecutor.js
	escrowAfterSentinelX.js	
	orderOrchestrator.js
	public folder
	scripts folder if used
	service folder if used
	package.json
	package-lock.json
	README.md
	.env.example
	.gitignore

--------------------------------------------------------------------------------------------------------------------------------------------------------
Key Rule
--------------------------------------------------------------------------------------------------------------------------------------------------------

No SentinelX clearance means no AlphaSwap execution.

AlphaSwap can only execute the real swap after SentinelX delivers a verified CLEARANCE_GRANTED report.

--------------------------------------------------------------------------------------------------------------------------------------------------------
Demo Video Summary
--------------------------------------------------------------------------------------------------------------------------------------------------------

The demo includes two scenarios.

First, a safe USDC to WETH swap on Base. SentinelX returns CLEARANCE_GRANTED, and the real swap is executed.

Second, a honeypot blocked mission. SentinelX returns MISSION_BLOCKED, and no router transaction is submitted.

--------------------------------------------------------------------------------------------------------------------------------------------------------
Project Tagline
--------------------------------------------------------------------------------------------------------------------------------------------------------

SentinelX is a pre-trade safety gate for autonomous trading agents.

--------------------------------------------------------------------------------------------------------------------------------------------------------
Security Note
--------------------------------------------------------------------------------------------------------------------------------------------------------

This project is built for demo and hackathon purposes. Do not use real funds without proper testing, slippage protection, security review, and production-level monitoring.

Private keys, API keys, .env, and local runtime data should never be uploaded to GitHub.
