// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AuditAnchor {
    event AuditLogged(
        address indexed user,
        bytes32 indexed logHash,
        string actionType,
        uint256 timestamp
    );

    mapping(bytes32 => bool) public anchored;   // quick check
    mapping(bytes32 => uint256) public anchoredAt;

    function logAudit(bytes32 logHash, string calldata actionType) external {
        require(!anchored[logHash], "Already anchored");
        anchored[logHash] = true;
        anchoredAt[logHash] = block.timestamp;

        emit AuditLogged(msg.sender, logHash, actionType, block.timestamp);
    }
}
