// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract SentinelXEscrow {
    address public owner;
    IERC20 public usdc;

    enum Status {
        NONE,
        FUNDED,
        RELEASED,
        REFUNDED,
        BLOCKED
    }

    struct Order {
        address payer;
        address receiver;
        uint256 amount;
        Status status;
        string decision;
    }

    mapping(bytes32 => Order) public orders;

    event EscrowFunded(bytes32 indexed orderId, address indexed payer, address indexed receiver, uint256 amount);
    event EscrowReleased(bytes32 indexed orderId, address indexed receiver, uint256 amount, string decision);
    event EscrowBlocked(bytes32 indexed orderId, string decision);
    event EscrowRefunded(bytes32 indexed orderId, address indexed payer, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    constructor(address usdcAddress) {
        owner = msg.sender;
        usdc = IERC20(usdcAddress);
    }

    function fundOrder(bytes32 orderId, address receiver, uint256 amount) external {
        require(orders[orderId].status == Status.NONE, "ORDER_EXISTS");
        require(receiver != address(0), "BAD_RECEIVER");
        require(amount > 0, "BAD_AMOUNT");

        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "USDC_TRANSFER_FAILED");

        orders[orderId] = Order({
            payer: msg.sender,
            receiver: receiver,
            amount: amount,
            status: Status.FUNDED,
            decision: "PENDING"
        });

        emit EscrowFunded(orderId, msg.sender, receiver, amount);
    }

    function releaseOrder(bytes32 orderId, string calldata decision) external onlyOwner {
        Order storage order = orders[orderId];
        require(order.status == Status.FUNDED, "NOT_FUNDED");

        order.status = Status.RELEASED;
        order.decision = decision;

        bool ok = usdc.transfer(order.receiver, order.amount);
        require(ok, "USDC_RELEASE_FAILED");

        emit EscrowReleased(orderId, order.receiver, order.amount, decision);
    }

    function blockOrder(bytes32 orderId, string calldata decision) external onlyOwner {
        Order storage order = orders[orderId];
        require(order.status == Status.FUNDED, "NOT_FUNDED");

        order.status = Status.BLOCKED;
        order.decision = decision;

        emit EscrowBlocked(orderId, decision);
    }

    function refundOrder(bytes32 orderId) external onlyOwner {
        Order storage order = orders[orderId];
        require(order.status == Status.FUNDED || order.status == Status.BLOCKED, "CANNOT_REFUND");

        order.status = Status.REFUNDED;

        bool ok = usdc.transfer(order.payer, order.amount);
        require(ok, "USDC_REFUND_FAILED");

        emit EscrowRefunded(orderId, order.payer, order.amount);
    }
}
