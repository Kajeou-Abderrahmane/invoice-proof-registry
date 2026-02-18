const { expect } = require("chai");
const { ethers } = require("hardhat");

// Helper: encode a 3-character currency code as bytes3
function toBytes3(str) {
  return ethers.hexlify(ethers.toUtf8Bytes(str));
}

// Helper: hash a document string (simulates client-side Keccak256 of a PDF)
function docHash(content) {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

// Helper: hash a vendor ID (simulates vendor identifier hashing)
function vendorHash(id) {
  return ethers.keccak256(ethers.toUtf8Bytes(id));
}

// Helper: hash a payment reference
function payRefHash(ref) {
  return ethers.keccak256(ethers.toUtf8Bytes(ref));
}

describe("InvoiceProofRegistry", function () {
  // ---------------------------------------------------------------------------
  // Fixture
  // ---------------------------------------------------------------------------
  async function deployFixture() {
    const [admin, issuer, approver, finance, other] = await ethers.getSigners();

    const InvoiceProofRegistry = await ethers.getContractFactory(
      "InvoiceProofRegistry"
    );
    const registry = await InvoiceProofRegistry.deploy(admin.address);
    await registry.waitForDeployment();

    const ISSUER_ROLE = await registry.ISSUER_ROLE();
    const APPROVER_ROLE = await registry.APPROVER_ROLE();
    const FINANCE_ROLE = await registry.FINANCE_ROLE();

    await registry.connect(admin).grantRole(ISSUER_ROLE, issuer.address);
    await registry.connect(admin).grantRole(APPROVER_ROLE, approver.address);
    await registry.connect(admin).grantRole(FINANCE_ROLE, finance.address);

    return {
      registry,
      admin,
      issuer,
      approver,
      finance,
      other,
      ISSUER_ROLE,
      APPROVER_ROLE,
      FINANCE_ROLE,
    };
  }

  // ---------------------------------------------------------------------------
  // 1. Duplicate prevention
  // ---------------------------------------------------------------------------
  describe("Duplicate Invoice Prevention", function () {
    it("prevents registering the same invoice ID twice", async function () {
      const { registry, issuer } = await deployFixture();

      const invoiceId = "ACME-INV-2024-00142";
      const hash = docHash("Acme Corp invoice #00142 – £12,500 consulting Q4");
      const vendor = vendorHash("ACME-CORP-GB-VAT-123456789");

      await registry
        .connect(issuer)
        .registerInvoice(invoiceId, hash, 12500, toBytes3("GBP"), vendor);

      await expect(
        registry
          .connect(issuer)
          .registerInvoice(invoiceId, hash, 12500, toBytes3("GBP"), vendor)
      ).to.be.revertedWith("invoice exists");
    });

    it("allows registering different invoice IDs for the same vendor", async function () {
      const { registry, issuer } = await deployFixture();

      const vendor = vendorHash("GLOBEX-EU-VAT-987654321");

      await registry
        .connect(issuer)
        .registerInvoice(
          "GLOBEX-INV-2024-0081",
          docHash("Globex invoice #0081 – €8,400 SaaS licence Jan"),
          8400,
          toBytes3("EUR"),
          vendor
        );

      await registry
        .connect(issuer)
        .registerInvoice(
          "GLOBEX-INV-2024-0082",
          docHash("Globex invoice #0082 – €8,400 SaaS licence Feb"),
          8400,
          toBytes3("EUR"),
          vendor
        );

      // Both registrations should succeed — no revert expected
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Role-based access control
  // ---------------------------------------------------------------------------
  describe("Role-Based Access Control", function () {
    it("blocks an unauthorised account from registering an invoice", async function () {
      const { registry, other } = await deployFixture();

      await expect(
        registry
          .connect(other)
          .registerInvoice(
            "STARK-INV-2024-00305",
            docHash("Stark Industries invoice #00305 – $45,000 parts"),
            45000,
            toBytes3("USD"),
            vendorHash("STARK-IND-US-EIN-123456789")
          )
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("blocks an unauthorised account from approving an invoice", async function () {
      const { registry, issuer, other } = await deployFixture();

      await registry
        .connect(issuer)
        .registerInvoice(
          "WAYNE-INV-2024-00071",
          docHash("Wayne Enterprises invoice #00071 – $22,000 security audit"),
          22000,
          toBytes3("USD"),
          vendorHash("WAYNE-ENT-US-EIN-987654321")
        );

      await expect(
        registry.connect(other).approveInvoice("WAYNE-INV-2024-00071")
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("blocks an unauthorised account from rejecting an invoice", async function () {
      const { registry, issuer, other } = await deployFixture();

      await registry
        .connect(issuer)
        .registerInvoice(
          "INITECH-INV-2024-00019",
          docHash("Initech invoice #00019 – £3,200 IT support"),
          3200,
          toBytes3("GBP"),
          vendorHash("INITECH-GB-VAT-555444333")
        );

      await expect(
        registry
          .connect(other)
          .rejectInvoice("INITECH-INV-2024-00019", ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("blocks an unauthorised account from marking an invoice paid", async function () {
      const { registry, issuer, approver, other } = await deployFixture();

      const invoiceId = "UMBRELLA-INV-2024-00203";

      await registry
        .connect(issuer)
        .registerInvoice(
          invoiceId,
          docHash("Umbrella Corp invoice #00203 – €67,000 lab equipment"),
          67000,
          toBytes3("EUR"),
          vendorHash("UMBRELLA-EU-VAT-222333444")
        );

      await registry.connect(approver).approveInvoice(invoiceId);

      await expect(
        registry
          .connect(other)
          .markPaid(invoiceId, payRefHash("BACS-OUT-2024-11-30-UCO203"))
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("allows the full lifecycle when correct roles are used", async function () {
      const { registry, issuer, approver, finance } = await deployFixture();

      const invoiceId = "NAKATOMI-INV-2024-00512";

      await registry
        .connect(issuer)
        .registerInvoice(
          invoiceId,
          docHash("Nakatomi Trading invoice #00512 – ¥1,200,000 imports"),
          1200000,
          toBytes3("JPY"),
          vendorHash("NAKATOMI-JP-TAX-111222333")
        );

      await registry.connect(approver).approveInvoice(invoiceId);

      await registry
        .connect(finance)
        .markPaid(invoiceId, payRefHash("SWIFT-OUT-2024-12-01-NTJ512"));
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Status lifecycle transitions
  // ---------------------------------------------------------------------------
  describe("Status Lifecycle Transitions", function () {
    it("transitions correctly from Created → Approved → Paid", async function () {
      const { registry, issuer, approver, finance } = await deployFixture();

      const invoiceId = "CYBERDYNE-INV-2024-00088";

      await registry
        .connect(issuer)
        .registerInvoice(
          invoiceId,
          docHash("Cyberdyne Systems invoice #00088 – $98,000 robotics R&D"),
          98000,
          toBytes3("USD"),
          vendorHash("CYBERDYNE-US-EIN-444555666")
        );

      await registry.connect(approver).approveInvoice(invoiceId);

      await expect(
        registry.connect(approver).approveInvoice(invoiceId)
      ).to.be.revertedWith("status not CREATED");

      await expect(
        registry
          .connect(approver)
          .rejectInvoice(invoiceId, payRefHash("cannot-reject-approved"))
      ).to.be.revertedWith("status not CREATED");

      await registry
        .connect(finance)
        .markPaid(invoiceId, payRefHash("CHAPS-OUT-2024-12-05-CDS088"));

      await expect(
        registry
          .connect(finance)
          .markPaid(invoiceId, payRefHash("CHAPS-OUT-2024-12-05-CDS088-DUP"))
      ).to.be.revertedWith("status not APPROVED");
    });

    it("transitions correctly from Created → Rejected", async function () {
      const { registry, issuer, approver } = await deployFixture();

      const invoiceId = "OSCORP-INV-2024-00334";

      await registry
        .connect(issuer)
        .registerInvoice(
          invoiceId,
          docHash("Oscorp Industries invoice #00334 – $15,000 chemicals"),
          15000,
          toBytes3("USD"),
          vendorHash("OSCORP-US-EIN-777888999")
        );

      const reason = payRefHash("REJECT: amount does not match PO-2024-00334");
      await registry.connect(approver).rejectInvoice(invoiceId, reason);

      await expect(
        registry.connect(approver).approveInvoice(invoiceId)
      ).to.be.revertedWith("status not CREATED");

      await expect(
        registry.connect(approver).rejectInvoice(invoiceId, reason)
      ).to.be.revertedWith("status not CREATED");
    });

    it("blocks marking a rejected invoice as paid", async function () {
      const { registry, issuer, approver, finance } = await deployFixture();

      const invoiceId = "SOYLENT-INV-2024-00007";

      await registry
        .connect(issuer)
        .registerInvoice(
          invoiceId,
          docHash("Soylent Corp invoice #00007 – $4,800 catering"),
          4800,
          toBytes3("USD"),
          vendorHash("SOYLENT-US-EIN-001002003")
        );

      await registry
        .connect(approver)
        .rejectInvoice(invoiceId, payRefHash("REJECT: duplicate claim detected"));

      await expect(
        registry
          .connect(finance)
          .markPaid(invoiceId, payRefHash("BACS-OUT-2024-12-10-SLC007"))
      ).to.be.revertedWith("status not APPROVED");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Payment reference validation
  // ---------------------------------------------------------------------------
  describe("Payment Reference Validation", function () {
    it("blocks markPaid on a CREATED invoice (not yet approved)", async function () {
      const { registry, issuer, finance } = await deployFixture();

      const invoiceId = "WEYLAND-INV-2024-00991";

      await registry
        .connect(issuer)
        .registerInvoice(
          invoiceId,
          docHash("Weyland-Yutani invoice #00991 – $250,000 spacecraft maintenance"),
          250000,
          toBytes3("USD"),
          vendorHash("WEYLAND-US-EIN-321654987")
        );

      await expect(
        registry
          .connect(finance)
          .markPaid(invoiceId, payRefHash("WIRE-OUT-2024-12-15-WYU991"))
      ).to.be.revertedWith("status not APPROVED");
    });

    it("blocks markPaid with a zero paymentRefHash", async function () {
      const { registry, issuer, approver, finance } = await deployFixture();

      const invoiceId = "REKALL-INV-2024-00056";

      await registry
        .connect(issuer)
        .registerInvoice(
          invoiceId,
          docHash("Rekall Inc invoice #00056 – $33,000 memory implants"),
          33000,
          toBytes3("USD"),
          vendorHash("REKALL-US-EIN-456789012")
        );

      await registry.connect(approver).approveInvoice(invoiceId);

      await expect(
        registry.connect(finance).markPaid(invoiceId, ethers.ZeroHash)
      ).to.be.revertedWith("paymentRefHash empty");
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Document hash verification
  // ---------------------------------------------------------------------------
  describe("Document Hash Verification", function () {
    it("returns true when the supplied hash matches the registered hash", async function () {
      const { registry, issuer } = await deployFixture();

      const invoiceId = "TYRELL-INV-2024-00177";
      const hash = docHash("Tyrell Corporation invoice #00177 – $580,000 replicant units");
      const vendor = vendorHash("TYRELL-US-EIN-654321098");

      await registry
        .connect(issuer)
        .registerInvoice(invoiceId, hash, 580000, toBytes3("USD"), vendor);

      expect(await registry.verify(invoiceId, hash)).to.equal(true);
    });

    it("returns false when a tampered hash is supplied", async function () {
      const { registry, issuer } = await deployFixture();

      const invoiceId = "TYRELL-INV-2024-00178";
      const originalHash = docHash("Tyrell Corporation invoice #00178 – $580,000 replicant units");
      const tamperedHash = docHash("Tyrell Corporation invoice #00178 – $5,800 replicant units");
      const vendor = vendorHash("TYRELL-US-EIN-654321098");

      await registry
        .connect(issuer)
        .registerInvoice(invoiceId, originalHash, 580000, toBytes3("USD"), vendor);

      expect(await registry.verify(invoiceId, tamperedHash)).to.equal(false);
    });

    it("returns false for an unregistered invoice ID", async function () {
      const { registry } = await deployFixture();

      const hash = docHash("some document that was never registered");
      expect(await registry.verify("GHOST-INV-0000-00000", hash)).to.equal(false);
    });
  });
});