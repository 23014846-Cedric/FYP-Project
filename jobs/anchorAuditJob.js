// jobs/anchorAuditJob.js
// Auto-anchor unanchored AuditLog hashes to Ganache every 2 minutes.
// - Uses server-side wallet (ANCHOR_PK), so MetaMask will NOT pop up.
// - Writes anchor metadata back into AuditLog (anchored, anchor_tx, etc.)

require("dotenv").config({ override: true });

const cron = require("node-cron");
const { ethers } = require("ethers");
const crypto = require("crypto");
const AuditLog = require("../models/AuditLog");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const makeRoot = (hashes) => sha256(hashes.join(""));

function normPk(pkRaw) {
  const pk = (pkRaw || "").trim();
  if (!pk) throw new Error("Missing ANCHOR_PK in .env");
  return pk.startsWith("0x") ? pk : ("0x" + pk);
}

function norm0x(hex) {
  const h = (hex || "").trim();
  if (!h) return "0x";
  return h.startsWith("0x") ? h : ("0x" + h);
}

function getRpcUrl() {
  // If GANACHE_RPC is empty/undefined, ethers defaults to localhost:8545.
  // We hard-fallback to Ganache GUI default.
  const rpc = (process.env.GANACHE_RPC || "").trim();
  return rpc || "http://127.0.0.1:7545";
}

module.exports = function startAnchorJob() {
  cron.schedule("*/2 * * * *", async () => {
    try {
      console.log("[ANCHOR] tick");

      const logs = await AuditLog.find({ anchored: false })
        .sort({ timestamp: 1, _id: 1 })
        .limit(200)
        .lean();

      console.log("[ANCHOR] found logs:", logs.length);
      if (!logs.length) return;

      const root = makeRoot(logs.map((l) => l.hash));
      const batchId = crypto.randomUUID();

      const rpcUrl = getRpcUrl();
      console.log("[ANCHOR] GANACHE_RPC =", rpcUrl);

      const provider = new ethers.JsonRpcProvider(rpcUrl);

      // sanity check
      const block = await provider.getBlockNumber();
      console.log("[ANCHOR] rpc ok, block:", block);

      const wallet = new ethers.Wallet(normPk(process.env.ANCHOR_PK), provider);
      const bal = await provider.getBalance(wallet.address);
      console.log("[ANCHOR] anchor addr:", wallet.address, "balance:", bal.toString());

      // Anchor: store root in tx data (no contract)
      const tx = await wallet.sendTransaction({
        to: wallet.address,
        value: 0n,
        data: norm0x(root),
      });

      console.log("[ANCHOR] sent tx:", tx.hash);
      await tx.wait();
      console.log("[ANCHOR] tx confirmed:", tx.hash);

      const ids = logs.map((l) => l._id);

      const result = await AuditLog.updateMany(
        { _id: { $in: ids } },
        {
          $set: {
            anchored: true,
            anchor_batch: batchId,
            anchor_root: root,
            anchor_tx: tx.hash,
            anchored_at: new Date(),
          },
        }
      );

      console.log("[ANCHOR] updated logs:", result.modifiedCount ?? result.nModified ?? 0);
    } catch (err) {
      console.error("[ANCHOR][ERROR]", err?.message || err, err);
    }
  });
};
