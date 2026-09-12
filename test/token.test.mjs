// Token position math, run with plain node: `npm test`. No network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenPosition } from "../lib/chains/token.ts";

const base = { chain: "BNB Chain", platform: "binance-smart-chain", contract: "0x" + "ab".repeat(20) };

test("decimals reported as a string are accepted, since explorers do that", () => {
  assert.equal(tokenPosition({ ...base, rawValue: "150000000", symbol: "BTCB", decimals: "8" }).quantity, "1.5");
});

test("a token is scaled by its own decimals, not by an assumed 18", () => {
  // 1.5 of an 8-decimal token. This is the bug the old code had: BSC_TOKENS entries and
  // TRC-20 balances were scaled by a hardcoded count regardless of what the token used.
  const p = tokenPosition({ ...base, rawValue: "150000000", symbol: "BTCB", decimals: 8 });
  assert.equal(p.quantity, "1.5");
  // What the old behaviour produced, for the record. Off by a factor of ten billion.
  const wrong = tokenPosition({ ...base, rawValue: "150000000", symbol: "BTCB", decimals: 18 });
  assert.equal(wrong.quantity, "0.00000000015");
  assert.notEqual(p.quantity, wrong.quantity);
});

test("unknown decimals skips the row rather than assuming a scale", () => {
  // Number(null) is 0 and Number("") is 0, so a coercing check would turn a missing
  // decimals count into "scale by 10^0" and print raw base units as the balance.
  for (const decimals of [undefined, null, NaN, "", " ", "eighteen", -1, 99, 1.5, true, {}]) {
    assert.equal(tokenPosition({ ...base, rawValue: "1000", symbol: "X", decimals }), null, String(decimals));
  }
});

test("zero balances and malformed values produce nothing", () => {
  assert.equal(tokenPosition({ ...base, rawValue: "0", symbol: "X", decimals: 18 }), null);
  assert.equal(tokenPosition({ ...base, rawValue: "", symbol: "X", decimals: 18 }), null);
  assert.equal(tokenPosition({ ...base, rawValue: "1.5", symbol: "X", decimals: 18 }), null, "base units are integers");
  assert.equal(tokenPosition({ ...base, rawValue: "0x10", symbol: "X", decimals: 18 }), null);
});

test("a malformed contract address produces nothing", () => {
  for (const contract of ["", "0x", "not-an-address", "0x" + "ab".repeat(19)]) {
    assert.equal(tokenPosition({ ...base, contract, rawValue: "1000", symbol: "X", decimals: 18 }), null, contract);
  }
});

test("a token impersonating a native coin is labelled and flagged", () => {
  const p = tokenPosition({ ...base, chain: "Ethereum Classic", rawValue: "1000000000000000000", symbol: "ETC", decimals: 18 });
  assert.match(p.asset, /NOT native ETC/);
  assert.match(p.note, /scam airdrop/);
  // Priced by contract address, never by the ticker it borrowed.
  assert.match(p.priceSymbol, /^cg:binance-smart-chain:0x/);
});

test("a legitimate ticker is left alone", () => {
  const p = tokenPosition({ ...base, rawValue: "1000000", symbol: "DAI", decimals: 6 });
  assert.equal(p.asset, "DAI");
  assert.equal(p.note, undefined);
  assert.equal(p.kind, "token");
});

test("no symbol anywhere falls back to the address, not to a guess", () => {
  const p = tokenPosition({ ...base, rawValue: "1000000", symbol: null, decimals: 6 });
  assert.equal(p.asset, "0xababab…");
});

test("a bridged claim keeps its own kind so it is never summed with the native coin", () => {
  const p = tokenPosition({ ...base, rawValue: "1000000000000000000", symbol: "ETC", decimals: 18, kind: "bridged", note: "Binance-Peg" });
  assert.equal(p.kind, "bridged");
  // The mimic flag still wins on the label: it is a contract, not the native coin.
  assert.match(p.asset, /NOT native ETC/);
});

test("the contract address is matched case-insensitively", () => {
  const p = tokenPosition({ ...base, contract: "0x" + "AB".repeat(20), rawValue: "1000000", symbol: "DAI", decimals: 6 });
  assert.match(p.priceSymbol, /0xabab/);
});
