// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CovenantAuthorizationRegistry {
    address public owner;

    mapping(address => bool) public trustedExecutor;
    mapping(bytes32 => bool) public revokedAuth;
    mapping(bytes32 => bool) public cancelledOrder;
    mapping(bytes32 => address) public authorizationOwner;
    mapping(bytes32 => address) public orderOwner;



    event TrustedExecutorSet(address indexed executor, bool isTrusted);
    event AuthorizationRegistered(bytes32 indexed authHash, address indexed authOwner);
    event AuthorizationRevoked(bytes32 indexed authHash, address indexed revoker);
    event OrderCancelled(bytes32 indexed orderHash, address indexed trader);
    event OrderRegistered(bytes32 indexed orderHash, address indexed trader);

    error NotOwner();
    error UnauthorizedExecutor();
    error AuthorizationOwnerMismatch();
    error UnknownAuthorization();
    error NotAuthorizationOwner();
    error OrderOwnerMismatch();
    error UnknownOrder();
    error NotOrderOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyTrustedExecutor() {
        if (!trustedExecutor[msg.sender]) revert UnauthorizedExecutor();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setTrustedExecutor(address executor, bool isTrusted) external onlyOwner {
        trustedExecutor[executor] = isTrusted;
        emit TrustedExecutorSet(executor, isTrusted);
    }

    function registerAuthorization(bytes32 authHash, address authOwner) external onlyTrustedExecutor {
        address existing = authorizationOwner[authHash];

        if (existing != address(0) && existing != authOwner) {
            revert AuthorizationOwnerMismatch();
        }

        if (existing == address(0)) {
            authorizationOwner[authHash] = authOwner;
            emit AuthorizationRegistered(authHash, authOwner);
        }
    }

    function revokeAuthorization(bytes32 authHash) external {
        address authOwner = authorizationOwner[authHash];

        if (authOwner == address(0)) revert UnknownAuthorization();
        if (msg.sender != authOwner) revert NotAuthorizationOwner();

        revokedAuth[authHash] = true;
        emit AuthorizationRevoked(authHash, msg.sender);
    }

function registerOrder(bytes32 orderHash, address trader) external onlyTrustedExecutor {
    address existing = orderOwner[orderHash];

    if (existing != address(0) && existing != trader) {
        revert OrderOwnerMismatch();
    }

    if (existing == address(0)) {
        orderOwner[orderHash] = trader;
        emit OrderRegistered(orderHash, trader);
    }
}

function cancelOrder(bytes32 orderHash) external {
    address trader = orderOwner[orderHash];

    if (trader == address(0)) revert UnknownOrder();
    if (msg.sender != trader) revert NotOrderOwner();

    cancelledOrder[orderHash] = true;
    emit OrderCancelled(orderHash, msg.sender);
}
}
