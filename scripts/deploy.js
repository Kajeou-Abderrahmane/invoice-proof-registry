const fs = require("fs");
const path = require("path");

async function main() {
  const [admin, issuer, approver, finance] = await ethers.getSigners();

  console.log("Admin   :", admin.address);
  console.log("Issuer  :", issuer.address);
  console.log("Approver:", approver.address);
  console.log("Finance :", finance.address);

  const Factory = await ethers.getContractFactory("InvoiceProofRegistry");
  const contract = await Factory.deploy(admin.address);
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log("InvoiceProofRegistry deployed to:", addr);

  // Grant roles
  const ISSUER_ROLE = await contract.ISSUER_ROLE();
  const APPROVER_ROLE = await contract.APPROVER_ROLE();
  const FINANCE_ROLE = await contract.FINANCE_ROLE();

  await (await contract.grantRole(ISSUER_ROLE, issuer.address)).wait();
  await (await contract.grantRole(APPROVER_ROLE, approver.address)).wait();
  await (await contract.grantRole(FINANCE_ROLE, finance.address)).wait();

  console.log("Roles granted.");

  // Export contract info for frontend
  const artifact = await artifacts.readArtifact("InvoiceProofRegistry");
  const out = {
    chainId: 31337,
    contractAddress: addr,
    abi: artifact.abi
  };

  const outPath = path.join(__dirname, "..", "frontend-test", "contract-info.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Wrote:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
