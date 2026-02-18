// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract InvoiceProofRegistry is AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant APPROVER_ROLE = keccak256("APPROVER_ROLE");
    bytes32 public constant FINANCE_ROLE = keccak256("FINANCE_ROLE");

    uint8 public constant STATUS_CREATED = 0;
    uint8 public constant STATUS_APPROVED = 1;
    uint8 public constant STATUS_REJECTED = 2;
    uint8 public constant STATUS_PAID = 3;

    struct Invoice {
        bytes32 docHash;
        address issuer;
        uint256 amount;
        bytes3 currency;
        bytes32 vendorIdHash;
        uint8 status;
        uint64 createdAt;
        uint64 updatedAt;
        bytes32 paymentRefHash;
    }

    mapping(bytes32 => Invoice) private invoices;

    event InvoiceRegistered(
        bytes32 indexed invoiceKey,
        string invoiceId,
        bytes32 docHash,
        address indexed issuer,
        uint256 amount,
        bytes3 currency,
        bytes32 vendorIdHash
    );

    event InvoiceApproved(bytes32 indexed invoiceKey, address indexed approver);

    event InvoiceRejected(
        bytes32 indexed invoiceKey,
        address indexed approver,
        bytes32 reasonHash
    );

    event InvoicePaid(
        bytes32 indexed invoiceKey,
        address indexed financeOperator,
        bytes32 paymentRefHash
    );

    constructor(address admin) {
        require(admin != address(0), "admin required");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function _invoiceKey(string memory invoiceId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(invoiceId));
    }

    function registerInvoice(
        string calldata invoiceId,
        bytes32 docHash,
        uint256 amount,
        bytes3 currency,
        bytes32 vendorIdHash
    ) external onlyRole(ISSUER_ROLE) {
        require(bytes(invoiceId).length != 0, "invoiceId empty");
        require(docHash != bytes32(0), "docHash empty");

        bytes32 key = _invoiceKey(invoiceId);
        require(invoices[key].createdAt == 0, "invoice exists");

        uint64 nowTs = uint64(block.timestamp);

        invoices[key] = Invoice({
            docHash: docHash,
            issuer: msg.sender,
            amount: amount,
            currency: currency,
            vendorIdHash: vendorIdHash,
            status: STATUS_CREATED,
            createdAt: nowTs,
            updatedAt: nowTs,
            paymentRefHash: bytes32(0)
        });

        emit InvoiceRegistered(
            key,
            invoiceId,
            docHash,
            msg.sender,
            amount,
            currency,
            vendorIdHash
        );
    }

    function approveInvoice(string calldata invoiceId)
        external
        onlyRole(APPROVER_ROLE)
    {
        bytes32 key = _invoiceKey(invoiceId);
        Invoice storage inv = invoices[key];
        require(inv.createdAt != 0, "invoice missing");
        require(inv.status == STATUS_CREATED, "status not CREATED");

        inv.status = STATUS_APPROVED;
        inv.updatedAt = uint64(block.timestamp);

        emit InvoiceApproved(key, msg.sender);
    }

    function rejectInvoice(string calldata invoiceId, bytes32 reasonHash)
        external
        onlyRole(APPROVER_ROLE)
    {
        bytes32 key = _invoiceKey(invoiceId);
        Invoice storage inv = invoices[key];
        require(inv.createdAt != 0, "invoice missing");
        require(inv.status == STATUS_CREATED, "status not CREATED");

        inv.status = STATUS_REJECTED;
        inv.updatedAt = uint64(block.timestamp);

        emit InvoiceRejected(key, msg.sender, reasonHash);
    }

    function markPaid(string calldata invoiceId, bytes32 paymentRefHash)
        external
        onlyRole(FINANCE_ROLE)
    {
        require(paymentRefHash != bytes32(0), "paymentRefHash empty");

        bytes32 key = _invoiceKey(invoiceId);
        Invoice storage inv = invoices[key];
        require(inv.createdAt != 0, "invoice missing");
        require(inv.status == STATUS_APPROVED, "status not APPROVED");

        inv.status = STATUS_PAID;
        inv.updatedAt = uint64(block.timestamp);
        inv.paymentRefHash = paymentRefHash;

        emit InvoicePaid(key, msg.sender, paymentRefHash);
    }

    function getInvoice(string calldata invoiceId)
        external
        view
        returns (
            bytes32 docHash,
            address issuer,
            uint256 amount,
            bytes3 currency,
            bytes32 vendorIdHash,
            uint8 status,
            uint64 createdAt,
            uint64 updatedAt,
            bytes32 paymentRefHash
        )
    {
        bytes32 key = _invoiceKey(invoiceId);
        Invoice storage inv = invoices[key];
        require(inv.createdAt != 0, "invoice missing");

        return (
            inv.docHash,
            inv.issuer,
            inv.amount,
            inv.currency,
            inv.vendorIdHash,
            inv.status,
            inv.createdAt,
            inv.updatedAt,
            inv.paymentRefHash
        );
    }

    function verify(string calldata invoiceId, bytes32 docHash)
        external
        view
        returns (bool)
    {
        bytes32 key = _invoiceKey(invoiceId);
        Invoice storage inv = invoices[key];
        if (inv.createdAt == 0) {
            return false;
        }
        return inv.docHash == docHash;
    }
}

