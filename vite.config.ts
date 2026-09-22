import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const DATA_ROUTE = '/data/pois.cogp.parquet';
const DATA_FILE = resolve(import.meta.dirname, 'data/pois.cogp.parquet');

/**
 * ローカルの COGP を HTTP Range 付きで配信する。
 * なぜ自前か: COGP は「先頭から N レベル分の row group を Range で取る」前提なので
 * 206 が返らないとリーダーが成立しない。data/ は 2.1 GiB で publicDir に置けず
 * （build でコピーされる）、Vite の静的配信の対象外にあるため 1 本だけ道を通す。
 */
function serveCogp(): Plugin {
  return {
    name: 'serve-cogp',
    configureServer(server) {
      server.middlewares.use(DATA_ROUTE, (req, res) => {
        let size: number;
        try {
          size = statSync(DATA_FILE).size;
        } catch {
          res.statusCode = 404;
          res.end('data/pois.cogp.parquet がない。README の取得手順を参照');
          return;
        }

        res.setHeader('Content-Type', 'application/vnd.apache.parquet');
        res.setHeader('Accept-Ranges', 'bytes');

        // リーダーはまず HEAD でファイル長を知り、そこから footer を Range で読む。
        if (req.method === 'HEAD') {
          res.statusCode = 200;
          res.setHeader('Content-Length', String(size));
          res.end();
          return;
        }

        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        if (!match) {
          // 全件 2.1 GiB を返しても誰も待てない。Range 必須にして誤用を早く気づかせる。
          res.statusCode = 416;
          res.setHeader('Content-Range', `bytes */${size}`);
          res.end();
          return;
        }

        const [, rawStart, rawEnd] = match;
        const start = rawStart ? Number(rawStart) : Math.max(0, size - Number(rawEnd));
        const end = rawStart ? (rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1) : size - 1;
        if (!Number.isFinite(start) || start > end || start >= size) {
          res.statusCode = 416;
          res.setHeader('Content-Range', `bytes */${size}`);
          res.end();
          return;
        }

        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', String(end - start + 1));
        createReadStream(DATA_FILE, { start, end }).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [serveCogp()],
  optimizeDeps: {
    // MapLibre は自前の worker を同梱しており、依存最適化に通すと
    // maplibre-gl-worker.mjs が出力されず地図が起動しない。
    exclude: ['maplibre-gl'],
  },
});
