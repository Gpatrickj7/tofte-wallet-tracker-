export const config = {
  auth: { user: process.env.DASH_USER ?? "", pass: process.env.DASH_PASS ?? "" },
  wallets: {
    etc: process.env.ETC_ADDRESS ?? "",
    bsc: process.env.BSC_ADDRESS ?? "",
    sol: process.env.SOL_ADDRESS ?? "",
    btc: process.env.BTC_ADDRESS ?? "",
    eth: process.env.ETH_ADDRESS ?? "",
    trx: process.env.TRX_ADDRESS ?? "",
  },
  pool: { name: process.env.POOL ?? "2miners", address: process.env.POOL_ADDRESS ?? "" },
};
