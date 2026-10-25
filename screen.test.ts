import { expect, test } from "bun:test";
import { classify, metrics, score } from "./screen";

const voo = { er: 0.0003, top10: 0.38, cagr: 0.157, mdd: -0.24 };

test("cheaper equivalent or leverage vetoes the grade, quality score stays visible", () => {
  expect(score({ symbol: "VOO", ...voo }).grade).toBe("Terbaik");
  const spy = score({ symbol: "SPY", ...voo, er: 0.0009 });
  expect(spy.grade).toBe("Hindari");
  expect(spy.raw!).toBeGreaterThan(80);
  expect(score({ symbol: "TQQQ", ...voo }, "spekulatif").grade).toBe("Hindari");
});

test("missing expense ratio is excluded, not scored as zero", () => {
  const s = score({ symbol: "VWRA.L", ...voo, er: null });
  expect(s.coverage).toBe(75);
  expect(s.total!).toBeGreaterThan(80);
});

test("roles follow the 3-ETF portfolio slots", () => {
  expect(classify("Vanguard FTSE All-World UCITS ETF", null, 0)).toBe("fondasi");
  expect(classify("Schwab U.S. Dividend Equity ETF", "Large Value", 0)).toBe("stabil");
  expect(classify("SP Funds S&P Global Technology ETF", "Technology", 0)).toBe("growth");
  expect(classify("Vanguard Total International Stock Index Fund ETF Shares", "Foreign Large Blend", 0)).toBe("internasional");
  expect(classify("Vanguard Total Bond Market Index Fund ETF Shares", "Intermediate Core Bond", 0)).toBe("obligasi");
  expect(classify("ProShares UltraPro QQQ", "Trading--Leveraged Equity", 0)).toBe("spekulatif");
  expect(classify("Energy Select Sector SPDR Fund", "Equity Energy", 0)).toBe("tematik");
});

test("metrics: 10y window CAGR and drawdown", () => {
  const month = 30.4375 * 864e5;
  // 12 years of +10%/yr compounded monthly, with a -30% dip lasting one month in year 5
  const series = Array.from({ length: 145 }, (_, i) => ({ t: i * month, v: 1.1 ** (i / 12) * (i === 60 ? 0.7 : 1) }));
  const m = metrics(series, null);
  expect(m.years).toBeCloseTo(10, 0);
  expect(m.cagr!).toBeCloseTo(0.1, 3);
  expect(m.mdd!).toBeCloseTo(0.7 * 1.1 ** (1 / 12) - 1, 6); // dip vs the previous month's peak
});
