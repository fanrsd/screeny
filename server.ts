import { monthly, screen, search, ScreenError, topEtfs, type Pt } from "./screen";

// ponytail: in-memory cache per process, 6h TTL; move to disk/redis if the server restarts often or scales out.
const TTL = 6 * 3600e3;
const cache = new Map<string, { at: number; data: Promise<unknown> }>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data as Promise<T>;
  const data = load();
  cache.set(key, { at: Date.now(), data });
  data.catch(() => cache.delete(key));
  return data;
}
const bench = () => cached<Pt[]>("bench:SPY", () => monthly("SPY"));

function fail(e: unknown) {
  const status = e instanceof ScreenError ? e.status : /not found|no data|404/i.test(String(e)) ? 404 : 502;
  const error = e instanceof ScreenError ? e.message
    : status === 404 ? "Ticker tidak ditemukan di Yahoo Finance. Cek ejaan atau tambahkan akhiran bursa (contoh VWRA.L)."
    : "Gagal mengambil data dari Yahoo Finance. Coba lagi sebentar lagi.";
  return Response.json({ error }, { status });
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/": () => new Response(Bun.file(`${import.meta.dir}/index.html`)),
    "/api/top": () => cached("top", () => topEtfs(10)).then((d) => Response.json(d), fail),
    "/api/etf/:symbol": async (req) => {
      const sym = req.params.symbol.toUpperCase();
      if (!/^[A-Z0-9.\-^=]{1,15}$/.test(sym)) return Response.json({ error: "Format ticker tidak valid." }, { status: 400 });
      return cached(`etf:${sym}`, () => screen(sym, bench)).then((d) => Response.json(d), fail);
    },
    "/api/search": async (req) => {
      const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
      if (q.length < 1 || q.length > 40) return Response.json([]);
      return cached(`search:${q.toLowerCase()}`, () => search(q)).then((d) => Response.json(d), fail);
    },
  },
});

console.log(`Screeny jalan di ${server.url}`);
