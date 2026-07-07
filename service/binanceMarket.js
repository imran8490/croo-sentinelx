const axios = require("axios");

async function fetchBinanceMarket() {
  const symbols = ["BNBUSDT", "ETHUSDT", "BTCUSDT"];
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
  const { data } = await axios.get(url, { timeout: 8000 });
  return data;
}

module.exports = { fetchBinanceMarket };
