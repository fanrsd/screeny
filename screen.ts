import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const YEAR = 365.25 * 864e5;

export type Role = "fondasi" | "inti-as" | "stabil" | "growth" | "internasional" | "obligasi" | "tematik" | "spekulatif";
export type Pt = { t: number; v: number };
export type Facts = { symbol: string; er: number | null; top10: number | null; cagr: number | null; mdd: number | null };
export type Factor = { key: string; label: string; weight: number; value: number | null; score: number | null };
export type Score = { total: number | null; raw: number | null; grade: string | null; factors: Factor[]; cheaper: string[] | null; coverage: number };
export type Metrics = {
  years: number; allYears: number; cagr: number | null; cagrAll: number | null;
  mdd: number | null; vol: number | null; beta: number | null; growth: [number, number][];
};

// Video 2: same exposure, lower cost. ponytail: static list of the pairs the video named; extend when needed.
export const CHEAPER: Record<string, string[]> = { SPY: ["VOO", "IVV"], QQQ: ["QQQM"], IWF: ["VUG"], IEFA: ["VXUS"] };

/** Linear interpolation over [x, score] points sorted by x; clamps at both ends. */
function interp(x: number, pts: [number, number][]): number {
  let [x0, y0] = pts[0]!;
  if (x <= x0) return y0;
  for (const [x1, y1] of pts.slice(1)) {
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    [x0, y0] = [x1, y1];
  }
  return y0;
}

/**
 * Video 2's criteria: biaya, diversifikasi, performa jangka panjang, efisiensi. Ketahanan from video 1 (stability).
 * Efisiensi is a veto, as in the video: a good fund with a cheaper equivalent (SPY vs VOO) or a leveraged fund is "Hindari".
 */
export function score(f: Facts, role?: Role): Score {
  const factors: Factor[] = [
    { key: "biaya", label: "Biaya (expense ratio)", weight: 25, value: f.er,
      score: f.er == null ? null : interp(f.er * 100, [[0.05, 100], [0.1, 85], [0.2, 65], [0.5, 35], [1, 10]]) },
    { key: "diversifikasi", label: "Diversifikasi (bobot 10 saham teratas)", weight: 20, value: f.top10,
      score: f.top10 == null ? null : interp(f.top10 * 100, [[15, 100], [25, 85], [40, 65], [55, 40], [70, 15]]) },
    { key: "performa", label: "Performa (CAGR 10 tahun)", weight: 35, value: f.cagr,
      score: f.cagr == null ? null : interp(f.cagr * 100, [[2, 5], [6, 35], [9, 60], [12, 80], [15, 95], [18, 100]]) },
    { key: "ketahanan", label: "Ketahanan (penurunan terdalam)", weight: 20, value: f.mdd,
      score: f.mdd == null ? null : interp(-f.mdd * 100, [[15, 100], [25, 80], [35, 55], [50, 25], [60, 10]]) },
  ];
  const used = factors.filter((x) => x.score != null);
  const w = used.reduce((a, x) => a + x.weight, 0);
  const cheaper = CHEAPER[f.symbol] ?? null;
  const veto = cheaper != null || role === "spekulatif";
  const raw = w ? used.reduce((a, x) => a + x.score! * x.weight, 0) / w : null;
  const total = raw == null ? null : veto ? Math.min(raw, 49) : raw;
  const grade = total == null ? null : total >= 85 ? "Terbaik" : total >= 75 ? "Sangat Baik" : total >= 65 ? "Baik" : total >= 55 ? "Cukup" : "Hindari";
  return { total, raw, grade, factors, cheaper, coverage: w };
}

export function classify(name: string, category: string | null, bondShare: number): Role {
  const n = `${name} ${category ?? ""}`.toLowerCase();
  if (/\b(2x|3x|ultra|leveraged|inverse|bear|daily)\b/.test(n)) return "spekulatif";
  if (bondShare > 0.5 || /\b(bond|treasury|aggregate|fixed income|sukuk|muni|tips)\b/.test(n)) return "obligasi";
  if (/(growth|nasdaq[ -]?100|technology)/.test(n)) return "growth";
  if (/(dividend|equity income)/.test(n)) return "stabil";
  if (/(all-world|total world|acwi|all country|msci world|global|world)/.test(n)) return "fondasi";
  if (/(ex-us|ex us|international|eafe|emerging|foreign|europe|japan|china|india|asia|pacific)/.test(n)) return "internasional";
  if (/(s&p 500|total stock market|russell|large blend|large value|mid-cap blend|small blend)/.test(n)) return "inti-as";
  return "tematik";
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

/** All window metrics use the last 10 years so funds with different inception dates compare fairly (video 2, IVV vs VOO). */
export function metrics(series: Pt[], bench: Pt[] | null): Metrics {
  const first = series[0]!, end = series.at(-1)!;
  const win = series.filter((p) => p.t >= end.t - 10 * YEAR - 20 * 864e5);
  const start = win[0]!;
  const years = (end.t - start.t) / YEAR;
  const allYears = (end.t - first.t) / YEAR;
  let peak = 0, mdd = 0;
  for (const p of win) { peak = Math.max(peak, p.v); mdd = Math.min(mdd, p.v / peak - 1); }
  const rets = win.slice(1).map((p, i) => p.v / win[i]!.v - 1);
  const m = mean(rets);

  let beta: number | null = null;
  if (bench) {
    const monthRet = (s: Pt[]) => new Map(s.slice(1).map((p, i) => [new Date(p.t).toISOString().slice(0, 7), p.v / s[i]!.v - 1]));
    const a = monthRet(series), b = monthRet(bench);
    const keys = [...a.keys()].filter((k) => b.has(k)).slice(-37, -1); // last 36 complete months
    if (keys.length >= 24) {
      const x = keys.map((k) => b.get(k)!), y = keys.map((k) => a.get(k)!);
      const mx = mean(x), my = mean(y);
      beta = mean(x.map((xi, i) => (xi - mx) * (y[i]! - my))) / mean(x.map((xi) => (xi - mx) ** 2));
    }
  }
  return {
    years, allYears,
    cagr: years >= 1 ? (end.v / start.v) ** (1 / years) - 1 : null,
    cagrAll: allYears >= 1 ? (end.v / first.v) ** (1 / allYears) - 1 : null,
    mdd: years >= 1 ? mdd : null,
    vol: rets.length > 2 ? Math.sqrt(mean(rets.map((r) => (r - m) ** 2)) * 12) : null,
    beta,
    growth: win.map((p) => [p.t, p.v / start.v]),
  };
}

/** Monthly bars, re-dated to the 1st of their month in UTC (LSE bars arrive as the previous day 23:00Z). */
export async function monthly(symbol: string): Promise<Pt[]> {
  const c = await yf.chart(symbol, { period1: "1990-01-01", interval: "1mo" });
  const out: Pt[] = [];
  for (const q of c.quotes) {
    const v = q.adjclose ?? q.close;
    if (v == null) continue;
    const d = new Date(new Date(q.date).getTime() + 3 * 864e5);
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    // Yahoo appends a live quote dated inside the current month's bar; the bar already carries the latest close.
    if (out.at(-1)?.t !== t) out.push({ t, v });
  }
  return out;
}

const SECTORS: Record<string, string> = {
  technology: "Teknologi", financial_services: "Keuangan", healthcare: "Kesehatan", consumer_cyclical: "Konsumer siklikal",
  communication_services: "Komunikasi", industrials: "Industri", consumer_defensive: "Konsumer primer", energy: "Energi",
  basic_materials: "Bahan baku", utilities: "Utilitas", realestate: "Properti",
};

const HEADLINE: Record<Role, string> = {
  fondasi: "Cocok sebagai ETF fondasi (seluruh dunia)",
  "inti-as": "Cocok sebagai fondasi versi Amerika Serikat",
  stabil: "Cocok sebagai penyeimbang di slot dividen",
  growth: "Cocok sebagai mesin growth, cukup pilih satu",
  internasional: "Opsional: pelengkap eksposur non-AS",
  obligasi: "Relevan hanya untuk fase pensiun yang konservatif",
  tematik: "Satelit tematik, maksimal 10% portofolio",
  spekulatif: "Hanya untuk porsi spekulatif, maksimal 10% portofolio",
};

function recommend(role: Role, s: Score, m: Metrics, er: number | null, top10: number | null, yld: number | null) {
  const pct = (x: number) => `${(x * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
  const dec = (x: number, d: number) => x.toFixed(d).replace(".", ",");
  const headline = role === "spekulatif" ? HEADLINE.spekulatif
    : s.cheaper ? `Pilih ${s.cheaper.join(" atau ")}: eksposur mirip, biaya lebih rendah`
    : s.grade === "Hindari" ? "Kurang efisien sebagai inti portofolio"
    : HEADLINE[role];

  const points: string[] = [];
  if (er == null) points.push("Expense ratio tidak tersedia di Yahoo Finance, faktor biaya tidak dinilai.");
  else if (er <= 0.001) points.push(`Biaya sangat murah: ${pct(er)} per tahun.`);
  else if (er >= 0.004) points.push(`Biaya tinggi: ${pct(er)} per tahun, setara ${Math.round(er / 0.0003)}x biaya VOO.`);
  else points.push(`Biaya ${pct(er)} per tahun.`);
  if (top10 != null) {
    if (top10 >= 0.5) points.push(`Terkonsentrasi: ${pct(top10)} dana ada di 10 saham teratas.`);
    else if (top10 <= 0.25) points.push(`Tersebar luas: 10 saham teratas hanya ${pct(top10)} dana.`);
    else points.push(`10 saham teratas memegang ${pct(top10)} dana.`);
  }
  if (m.cagr != null) points.push(`Rata-rata tumbuh ${pct(m.cagr)} per tahun selama ${dec(m.years, 1)} tahun terakhir (dalam mata uang dana).`);
  if (m.mdd != null) points.push(`Penurunan terdalam ${pct(m.mdd)} di periode yang sama (data bulanan).`);
  if (m.beta != null && m.beta < 0.85) points.push(`Beta ${dec(m.beta, 2)} terhadap S&P 500: bergerak lebih tenang dari pasar.`);
  if (m.beta != null && m.beta > 1.15) points.push(`Beta ${dec(m.beta, 2)} terhadap S&P 500: naik turunnya lebih tajam dari pasar.`);
  if (yld != null && yld >= 0.025) points.push(`Dividen sekitar ${pct(yld)} per tahun.`);
  if (m.allYears < 5) points.push(`Riwayat baru ${dec(m.allYears, 1)} tahun: skor performa belum teruji krisis.`);
  return { headline, points };
}

export class ScreenError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function screen(symbol: string, bench: () => Promise<Pt[]>) {
  const sym = symbol.trim().toUpperCase();
  const q = await yf.quoteSummary(sym, { modules: ["price", "summaryDetail", "fundProfile", "topHoldings", "defaultKeyStatistics"] });
  const type = q.price?.quoteType;
  if (type !== "ETF") throw new ScreenError(`${sym} bukan ETF (${type ?? "tipe tidak dikenal"}). Screeny saat ini khusus ETF.`, 422);

  const [series, b] = await Promise.all([monthly(sym), bench().catch(() => null)]);
  if (series.length < 2) throw new ScreenError(`Riwayat harga ${sym} tidak tersedia.`, 404);

  const name = q.price?.longName ?? q.price?.shortName ?? sym;
  const category = q.fundProfile?.categoryName ?? q.defaultKeyStatistics?.category ?? null;
  const er = q.fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio ?? null;
  const holdings = (q.topHoldings?.holdings ?? []).map((h) => ({ symbol: h.symbol, name: h.holdingName, pct: h.holdingPercent }));
  const top10 = holdings.length ? holdings.reduce((a, h) => a + h.pct, 0) : null;
  const sectors = (q.topHoldings?.sectorWeightings ?? [])
    .flatMap((o) => Object.entries(o).map(([k, v]) => ({ name: SECTORS[k] ?? k, pct: Number(v) })))
    .filter((x) => x.pct > 0).sort((a, z) => z.pct - a.pct);
  const yld = q.summaryDetail?.yield ?? q.defaultKeyStatistics?.yield ?? null;

  const m = metrics(series, b);
  const role = classify(name, category, q.topHoldings?.bondPosition ?? 0);
  const s = score({ symbol: sym, er, top10, cagr: m.cagr, mdd: m.mdd }, role);

  return {
    symbol: sym, name, category, family: q.fundProfile?.family ?? q.defaultKeyStatistics?.fundFamily ?? null,
    currency: q.price?.currency ?? null, exchange: q.price?.exchangeName ?? null, price: q.price?.regularMarketPrice ?? null,
    aum: q.summaryDetail?.totalAssets ?? null, inception: q.defaultKeyStatistics?.fundInceptionDate ?? new Date(series[0]!.t),
    er, yield: yld, top10, holdings, sectors: sectors.slice(0, 5),
    shariah: /(islamic|shariah|sharia|syariah)/i.test(name),
    role, metrics: m, score: s, recommendation: recommend(role, s, m, er, top10, yld), asOf: new Date(),
  };
}

export async function search(query: string) {
  const r = await yf.search(query, { quotesCount: 10, newsCount: 0 });
  return r.quotes.flatMap((x) =>
    "quoteType" in x && x.quoteType === "ETF" && "symbol" in x
      ? [{ symbol: x.symbol, name: ("longname" in x && x.longname) || ("shortname" in x && x.shortname) || "", exchange: ("exchDisp" in x && x.exchDisp) || x.exchange }]
      : [],
  );
}

/**
 * Largest US-listed ETFs by fund net assets, from Yahoo's custom screener.
 * yahoo-finance2 only exposes predefined screeners (none rank ETFs by size), so this calls the endpoint directly.
 */
export async function topEtfs(size = 10): Promise<{ symbol: string; name: string; netAssets: number }[]> {
  const UA = { "User-Agent": "Mozilla/5.0" };
  const fc = await fetch("https://fc.yahoo.com", { headers: UA, redirect: "manual" });
  const cookie = fc.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ");
  const crumb = await (await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { ...UA, cookie } })).text();
  const body = {
    size, offset: 0, sortField: "fundnetassets", sortType: "DESC", quoteType: "ETF",
    query: { operator: "and", operands: [{ operator: "eq", operands: ["region", "us"] }] }, userId: "", userIdType: "guid",
  };
  const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/screener?formatted=false&region=US&crumb=${encodeURIComponent(crumb)}`, {
    method: "POST", headers: { ...UA, cookie, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Yahoo screener ${r.status}`);
  const j = (await r.json()) as { finance?: { result?: { quotes?: { symbol?: string; longName?: string; shortName?: string; netAssets?: number }[] }[] } };
  const quotes = j.finance?.result?.[0]?.quotes ?? [];
  if (!quotes.length) throw new Error("Yahoo screener kosong");
  return quotes.flatMap((q) => (q.symbol ? [{ symbol: q.symbol, name: q.longName ?? q.shortName ?? q.symbol, netAssets: q.netAssets ?? 0 }] : []));
}
