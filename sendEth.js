const { ethers } = require("ethers");

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:7545");

// 🔑 PRIVATE KEY of a FUNDED Ganache account (index 0)
const fundedPrivateKey = "0x7126f81e5fceb3950240f276a90dbba7d5bd53bc58fe6a3158094a880d6085ac";

const wallet = new ethers.Wallet(fundedPrivateKey, provider);

async function send() {
  const tx = await wallet.sendTransaction({
    to: "0x3ba19dfc63f192CB2bCBA8297B5be9845a73E76d", // anchor address
    value: ethers.parseEther("10"),
  });

  await tx.wait();
  console.log("✅ ETH sent to anchor address");
}

send();
