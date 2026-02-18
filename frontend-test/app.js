// Invoice Proof Registry – workflow demo (ethers v6, plain JS)

let provider;
let signer;
let contract;
let contractInfo;
let currentDocHash = null;
let networkOk = false;
let roles = { isIssuer: false, isApprover: false, isFinance: false, isAdmin: false };

const accountEl = document.getElementById("account");
const chainIdEl = document.getElementById("chainId");
const providerInfoEl = document.getElementById("providerInfo");
const roleBadgesEl = document.getElementById("roleBadges");
const networkWarningBannerEl = document.getElementById("networkWarningBanner");
const docHashDisplayEl = document.getElementById("docHashDisplay");
const txHashEl = document.getElementById("txHash");
const outputEl = document.getElementById("outputPanel");
const timelineEl = document.getElementById("timelinePanel");

const actionButtonIds = [
  "registerButton",
  "getInvoiceButton",
  "verifyButton",
  "approveButton",
  "rejectButton",
  "markPaidButton",
  "timelineButton",
];

// --- Output helpers (clean; no node logs in UI) ---
function setStatus(msg) {
  outputEl.textContent = "Status: " + msg;
}

function setJson(obj) {
  outputEl.textContent = "Status: OK\n" + JSON.stringify(obj, null, 2);
}

function setError(err) {
  const msg = err && (err.message || String(err));
  outputEl.textContent = "Error: " + msg;
}

function setOutput(statusMsg, jsonObj) {
  let s = "Status: " + statusMsg;
  if (jsonObj != null) s += "\n\n" + JSON.stringify(jsonObj, null, 2);
  outputEl.textContent = s;
}

// --- Contract loading ---
async function loadContractInfo() {
  const res = await fetch("./contract-info.json");
  if (!res.ok) throw new Error("contract-info.json not found. Deploy contract first.");
  contractInfo = await res.json();
}

function getContractAddress() {
  return contractInfo.contractAddress || contractInfo.address;
}

async function ensureProviderAndSigner() {
  if (!window.ethereum) throw new Error("MetaMask (window.ethereum) not found");
  if (!provider) provider = new ethers.BrowserProvider(window.ethereum);
  if (!signer) signer = await provider.getSigner();
}

async function ensureContract() {
  if (!contractInfo) await loadContractInfo();
  await ensureProviderAndSigner();
  const address = getContractAddress();
  if (!address) throw new Error("Contract address missing in contract-info.json");
  if (!contract) contract = new ethers.Contract(address, contractInfo.abi, signer);
  return contract;
}

// --- Network safety ---
async function ensureCorrectNetwork() {
  if (!contractInfo) await loadContractInfo();
  if (!provider) {
    if (!window.ethereum) throw new Error("MetaMask not found");
    provider = new ethers.BrowserProvider(window.ethereum);
  }
  const expected = contractInfo.chainId;
  if (expected === undefined || expected === null) {
    chainIdEl.textContent = (await provider.getNetwork()).chainId.toString();
    updateNetworkBanner(true);
    return true;
  }
  const expectedNum = Number(expected);
  const network = await provider.getNetwork();
  const current = Number(network.chainId);
  chainIdEl.textContent = current.toString();
  if (current !== expectedNum) {
    updateNetworkBanner(false, current, expectedNum);
    setStatus(
      "Wrong network. Please switch MetaMask to Hardhat Local (chainId " +
        expectedNum +
        "). Connected: " +
        current +
        "."
    );
    return false;
  }
  updateNetworkBanner(true);
  return true;
}

function updateNetworkBanner(ok, current, expected) {
  if (!networkWarningBannerEl) return;
  if (ok) {
    networkWarningBannerEl.classList.add("hidden");
    networkWarningBannerEl.textContent = "";
    return;
  }
  networkWarningBannerEl.classList.remove("hidden");
  networkWarningBannerEl.textContent =
    "Wrong network. Connected chain " +
    (current != null ? current : "?") +
    "; contract expects " +
    (expected != null ? expected : "?") +
    ". Click \"Switch Network\" to use Hardhat Local (chainId " +
    (expected != null ? expected : "31337") +
    ").";
}

function setActionsEnabled(enabled) {
  actionButtonIds.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !enabled;
  });
}

function updateButtonStates() {
  const registerBtn = document.getElementById("registerButton");
  const approveBtn = document.getElementById("approveButton");
  const rejectBtn = document.getElementById("rejectButton");
  const markPaidBtn = document.getElementById("markPaidButton");
  const getBtn = document.getElementById("getInvoiceButton");
  const verifyBtn = document.getElementById("verifyButton");
  const timelineBtn = document.getElementById("timelineButton");

  if (!networkOk) {
    setActionsEnabled(false);
    if (registerBtn) registerBtn.title = "Connect and switch to correct network first.";
    return;
  }

  setActionsEnabled(true);
  if (registerBtn) {
    registerBtn.disabled = !roles.isIssuer;
    registerBtn.title = roles.isIssuer ? "Register a new invoice" : "Switch to a wallet with ISSUER role to register.";
  }
  if (approveBtn) {
    approveBtn.disabled = !roles.isApprover;
    approveBtn.title = roles.isApprover ? "Approve this invoice" : "Switch to a wallet with APPROVER role.";
  }
  if (rejectBtn) {
    rejectBtn.disabled = !roles.isApprover;
    rejectBtn.title = roles.isApprover ? "Reject this invoice" : "Switch to a wallet with APPROVER role.";
  }
  if (markPaidBtn) {
    markPaidBtn.disabled = !roles.isFinance;
    markPaidBtn.title = roles.isFinance ? "Mark invoice as paid" : "Switch to a wallet with FINANCE role.";
  }
  if (getBtn) getBtn.title = "Read-only: get invoice data.";
  if (verifyBtn) verifyBtn.title = "Read-only: verify docHash.";
  if (timelineBtn) timelineBtn.title = "Load event audit trail for current Invoice ID.";
}

// --- Role badges (no innerHTML; use textContent / DOM only) ---
function renderRolesBadges(rolesArray) {
  if (!roleBadgesEl) return;
  while (roleBadgesEl.firstChild) roleBadgesEl.removeChild(roleBadgesEl.firstChild);
  if (!rolesArray || rolesArray.length === 0) {
    const span = document.createElement("span");
    span.className = "badge badge-neutral";
    span.textContent = "NO ROLE";
    roleBadgesEl.appendChild(span);
    return;
  }
  rolesArray.forEach(function (role) {
    const span = document.createElement("span");
    span.className = "badge badge-" + role.toLowerCase().replace(/ /g, "-");
    span.textContent = role;
    roleBadgesEl.appendChild(span);
  });
}

// --- Role detection ---
async function refreshRoles() {
  if (!contract) await ensureContract();
  const ISSUER_ROLE = await contract.ISSUER_ROLE();
  const APPROVER_ROLE = await contract.APPROVER_ROLE();
  const FINANCE_ROLE = await contract.FINANCE_ROLE();
  const addr = await signer.getAddress();
  let isAdmin = false;
  try {
    const DEFAULT_ADMIN_ROLE = await contract.DEFAULT_ADMIN_ROLE();
    isAdmin = await contract.hasRole(DEFAULT_ADMIN_ROLE, addr);
  } catch (_) {}
  roles = {
    isIssuer: await contract.hasRole(ISSUER_ROLE, addr),
    isApprover: await contract.hasRole(APPROVER_ROLE, addr),
    isFinance: await contract.hasRole(FINANCE_ROLE, addr),
    isAdmin: isAdmin,
  };
  const badges = [];
  if (roles.isIssuer) badges.push("ISSUER");
  if (roles.isApprover) badges.push("APPROVER");
  if (roles.isFinance) badges.push("FINANCE");
  if (roles.isAdmin) badges.push("ADMIN");
  renderRolesBadges(badges.length ? badges : ["NO ROLE"]);
  updateButtonStates();
}

function detectProvider() {
  const eth = window.ethereum;
  if (!eth) {
    providerInfoEl.textContent = "None (no window.ethereum)";
    return;
  }
  const name = eth.isMetaMask ? "MetaMask" : "Injected";
  providerInfoEl.textContent = name + " (isMetaMask=" + !!eth.isMetaMask + ")";
}

// --- Connect & Switch Network ---
async function connectWallet() {
  try {
    detectProvider();
    if (!window.ethereum) {
      setStatus("MetaMask not found in this browser.");
      return;
    }
    await window.ethereum.request({ method: "eth_requestAccounts" });
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    const addr = await signer.getAddress();
    accountEl.textContent = addr;
    networkOk = await ensureCorrectNetwork();
    if (!networkOk) {
      contract = null;
      setActionsEnabled(false);
      updateButtonStates();
      return;
    }
    await ensureContract();
    await refreshRoles();
    setStatus("Connected on correct network.");
  } catch (err) {
    setError(err);
  }
}

document.getElementById("connectButton").addEventListener("click", () => connectWallet());

document.getElementById("switchNetworkButton").addEventListener("click", async () => {
  try {
    if (!window.ethereum) {
      setStatus("MetaMask not found.");
      return;
    }
    if (!contractInfo) await loadContractInfo();
    const expectedNum = Number(contractInfo.chainId ?? 31337);
    const hex = "0x" + expectedNum.toString(16);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if (e.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x7a69",
              chainName: "Hardhat Local",
              rpcUrls: ["http://127.0.0.1:8545"],
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            },
          ],
        });
      } else throw e;
    }
    setStatus("Switched network. Reconnecting...");
    await connectWallet();
  } catch (err) {
    setError(err);
  }
});

// --- Validation ---
function validateRegister() {
  const invoiceId = document.getElementById("invoiceId").value.trim();
  const amountStr = document.getElementById("amount").value;
  const currencyStr = document.getElementById("currency").value.trim().toUpperCase();
  const errs = [];
  if (!invoiceId) errs.push("Invoice ID is required.");
  if (!currentDocHash) errs.push("Compute docHash first.");
  const amount = BigInt(amountStr || "0");
  if (amount <= 0n) errs.push("Amount must be > 0.");
  if (!/^[A-Z]{3}$/.test(currencyStr)) errs.push("Currency must be exactly 3 letters A–Z.");
  if (errs.length) {
    setOutput("Validation failed", { errors: errs });
    return null;
  }
  return { invoiceId, amount, currencyStr };
}

function validateInvoiceId() {
  const invoiceId = document.getElementById("invoiceId").value.trim();
  if (!invoiceId) {
    setOutput("Validation failed", { errors: ["Invoice ID is required."] });
    return null;
  }
  return invoiceId;
}

function validateReject() {
  const invoiceId = validateInvoiceId();
  if (!invoiceId) return null;
  const reason = document.getElementById("rejectReason").value.trim();
  if (!reason) {
    setOutput("Validation failed", { errors: ["Reject reason is required."] });
    return null;
  }
  return { invoiceId, reason };
}

function validateMarkPaid() {
  const invoiceId = validateInvoiceId();
  if (!invoiceId) return null;
  const paymentRef = document.getElementById("paymentRef").value.trim();
  if (!paymentRef) {
    setOutput("Validation failed", { errors: ["Payment reference is required."] });
    return null;
  }
  return { invoiceId, paymentRef };
}

// --- Gas‑safe write helper ---
async function sendTx(fnName, ...args) {
  const c = await ensureContract();
  const fn = c[fnName];
  const gas = await fn.estimateGas(...args);
  const tx = await fn(...args, { gasLimit: (gas * 120n) / 100n });
  txHashEl.textContent = tx.hash;
  await tx.wait();
  return tx;
}

// --- Compute Hash ---
document.getElementById("computeHashButton").addEventListener("click", async () => {
  try {
    const fileInput = document.getElementById("pdfFile");
    const textInput = document.getElementById("textToHash");
    let bytes;
    if (fileInput.files && fileInput.files[0]) {
      bytes = new Uint8Array(await fileInput.files[0].arrayBuffer());
    } else if (textInput.value && textInput.value.trim()) {
      bytes = ethers.toUtf8Bytes(textInput.value.trim());
    } else {
      setStatus("Provide a PDF file or text to hash.");
      return;
    }
    currentDocHash = ethers.keccak256(bytes);
    docHashDisplayEl.textContent = currentDocHash;
    setStatus("Computed docHash.");
  } catch (err) {
    setError(err);
  }
});

// --- Register ---
document.getElementById("registerButton").addEventListener("click", async () => {
  try {
    const v = validateRegister();
    if (!v) return;
    const vendorId = document.getElementById("vendorId").value.trim();
    if (!vendorId) {
      setOutput("Validation failed", { errors: ["Vendor ID is required."] });
      return;
    }
    const currencyBytes = ethers.hexlify(ethers.toUtf8Bytes(v.currencyStr)).slice(0, 8);
    const vendorIdHash = ethers.keccak256(ethers.toUtf8Bytes(vendorId));
    setStatus("Sending registerInvoice...");
    await sendTx("registerInvoice", v.invoiceId, currentDocHash, v.amount, currencyBytes, vendorIdHash);
    setStatus("Invoice registered.");
  } catch (err) {
    setError(err);
  }
});

// --- Get Invoice ---
document.getElementById("getInvoiceButton").addEventListener("click", async () => {
  try {
    const invoiceId = validateInvoiceId();
    if (!invoiceId) return;
    const c = await ensureContract();
    const r = await c.getInvoice(invoiceId);
    const statusCode = Number(r[5]);
    const statusLabel = ["CREATED", "APPROVED", "REJECTED", "PAID"][statusCode] || "UNKNOWN";
    setOutput("Fetched invoice.", {
      docHash: r[0],
      issuer: r[1],
      amount: r[2].toString(),
      currency: r[3],
      vendorIdHash: r[4],
      status: statusCode,
      statusLabel,
      createdAt: Number(r[6]),
      updatedAt: Number(r[7]),
      paymentRefHash: r[8],
    });
  } catch (err) {
    setError(err);
  }
});

// --- Verify ---
document.getElementById("verifyButton").addEventListener("click", async () => {
  try {
    if (!currentDocHash) {
      setOutput("Validation failed", { errors: ["Compute docHash first."] });
      return;
    }
    const invoiceId = validateInvoiceId();
    if (!invoiceId) return;
    const c = await ensureContract();
    const result = await c.verify(invoiceId, currentDocHash);
    setOutput("Verification complete.", { match: result });
  } catch (err) {
    setError(err);
  }
});

// --- Approve ---
document.getElementById("approveButton").addEventListener("click", async () => {
  try {
    const invoiceId = validateInvoiceId();
    if (!invoiceId) return;
    setStatus("Sending approveInvoice...");
    await sendTx("approveInvoice", invoiceId);
    setStatus("Invoice approved.");
  } catch (err) {
    setError(err);
  }
});

// --- Reject ---
document.getElementById("rejectButton").addEventListener("click", async () => {
  try {
    const v = validateReject();
    if (!v) return;
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes(v.reason));
    setStatus("Sending rejectInvoice...");
    await sendTx("rejectInvoice", v.invoiceId, reasonHash);
    setStatus("Invoice rejected.");
  } catch (err) {
    setError(err);
  }
});

// --- Mark Paid ---
document.getElementById("markPaidButton").addEventListener("click", async () => {
  try {
    const v = validateMarkPaid();
    if (!v) return;
    const paymentRefHash = ethers.keccak256(ethers.toUtf8Bytes(v.paymentRef));
    setStatus("Sending markPaid...");
    await sendTx("markPaid", v.invoiceId, paymentRefHash);
    setStatus("Invoice marked paid.");
  } catch (err) {
    setError(err);
  }
});

// --- Event timeline ---
function invoiceKeyFromId(invoiceId) {
  return ethers.keccak256(ethers.toUtf8Bytes(invoiceId));
}

document.getElementById("timelineButton").addEventListener("click", async () => {
  try {
    const invoiceId = validateInvoiceId();
    if (!invoiceId) return;
    await ensureContract();
    if (!provider) await ensureProviderAndSigner();
    const address = getContractAddress();
    const iface = new ethers.Interface(contractInfo.abi);
    const key = invoiceKeyFromId(invoiceId);
    const events = [
      "InvoiceRegistered(bytes32,string,bytes32,address,uint256,bytes3,bytes32)",
      "InvoiceApproved(bytes32,address)",
      "InvoiceRejected(bytes32,address,bytes32)",
      "InvoicePaid(bytes32,address,bytes32)",
    ];
    const topic0s = events.map((sig) => ethers.id(sig));
    const fromBlock = 0n;
    const toBlock = "latest";
    const allLogs = await provider.getLogs({
      address,
      fromBlock,
      toBlock,
      topics: [topic0s],
    });
    const entries = [];
    for (const log of allLogs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (!parsed) continue;
        const args = parsed.args;
        const logKey = (args.invoiceKey ?? args[0]).toLowerCase();
        if (logKey !== key.toLowerCase()) continue;
        let byAddr = "";
        let extra = "";
        if (parsed.name === "InvoiceRegistered") {
          byAddr = args.issuer ?? args[3];
          extra = "invoiceId=" + (args.invoiceId ?? args[1]);
        } else if (parsed.name === "InvoiceApproved") {
          byAddr = args.approver ?? args[1];
        } else if (parsed.name === "InvoiceRejected") {
          byAddr = args.approver ?? args[1];
          extra = "reasonHash=" + (args.reasonHash ?? args[2]);
        } else if (parsed.name === "InvoicePaid") {
          byAddr = args.financeOperator ?? args[1];
          extra = "paymentRefHash=" + (args.paymentRefHash ?? args[2]);
        }
        entries.push({
          blockNumber: Number(log.blockNumber),
          name: parsed.name,
          by: byAddr,
          extra,
        });
      } catch (_) {}
    }
    entries.sort((a, b) => a.blockNumber - b.blockNumber);
    let text = "Event timeline for invoiceId: " + invoiceId + "\n\n";
    if (entries.length === 0) text += "No events found.";
    else entries.forEach((e) => (text += `[block ${e.blockNumber}] ${e.name} by ${e.by}${e.extra ? " " + e.extra : ""}\n`));
    timelineEl.textContent = text;
    setStatus("Timeline loaded.");
  } catch (err) {
    setError(err);
    timelineEl.textContent = "Error loading timeline.";
  }
});

// Initial UI state
timelineEl.textContent = "Click 'Load Event Timeline' for the current Invoice ID.";
outputEl.textContent = "Status: -";
updateButtonStates();
