require("dotenv").config();
const { ethers } = require("ethers");

(async () => {
  const provider = new ethers.JsonRpcProvider(process.env.GANACHE_RPC);
  console.log("block:", await provider.getBlockNumber());

  const pkRaw = (process.env.ANCHOR_PK || "").trim();
  const pk = pkRaw.startsWith("0x") ? pkRaw : "0x" + pkRaw;

  const wallet = new ethers.Wallet(pk, provider);
  console.log("addr:", wallet.address);

  const bal = await provider.getBalance(wallet.address);
  console.log("balance:", bal.toString());

  const tx = await wallet.sendTransaction({ to: wallet.address, value: 0n, data: "0x1234" });
  console.log("tx:", tx.hash);
})();
