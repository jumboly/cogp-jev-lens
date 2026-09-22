import { appendFileSync, createReadStream, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

import { RequestError, evaluateTags } from './src/server/evaluate-tags.js';

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

/**
 * `POST /api/evaluate-tags` の仮 BFF（#4 / #8）。
 * 本番の実行基盤は未決なので、当面は dev サーバーに同じ API 形で置く。
 * 中身は Vite に依存しない `src/server/` に分けてあり、そのまま移せる。
 */
function evaluateTagsApi(apiKey: string): Plugin {
  const logPath = resolve(import.meta.dirname, 'logs/jev.ndjson');
  mkdirSync(resolve(import.meta.dirname, 'logs'), { recursive: true });

  return {
    name: 'evaluate-tags-api',
    configureServer(server) {
      server.middlewares.use('/api/evaluate-tags', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST のみ');
          return;
        }
        if (!apiKey) {
          res.statusCode = 500;
          res.end('AI_GATEWAY_API_KEY が .env にない');
          return;
        }

        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          res.statusCode = 400;
          res.end('JSON として読めない');
          return;
        }

        // NDJSON は 1 行ずつ届けたいので、圧縮もバッファリングも挟ませない。
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Accel-Buffering', 'no');

        try {
          for await (const event of evaluateTags(body, {
            apiKey,
            // 全リクエストの生ログを残す。何が原因で失敗したかを後から追えるようにする。
            onLog: (entry) => appendFileSync(logPath, `${JSON.stringify(entry)}\n`),
          })) {
            res.write(`${JSON.stringify(event)}\n`);
          }
        } catch (err) {
          if (err instanceof RequestError) {
            // ヘッダは送信済みなので、本文の中で伝える。
            res.write(`${JSON.stringify({ type: 'error', kind: 'invalid', message: err.message })}\n`);
          } else {
            res.write(`${JSON.stringify({ type: 'error', kind: 'server', message: (err as Error).message })}\n`);
          }
        }
        res.end();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // 第 3 引数を空にすると VITE_ 接頭辞のない変数も読める。鍵はサーバー側にしか渡さない。
  const env = loadEnv(mode, import.meta.dirname, '');
  return {
  plugins: [serveCogp(), evaluateTagsApi(env['AI_GATEWAY_API_KEY'] ?? '')],
  optimizeDeps: {
    // MapLibre は自前の worker を同梱しており、依存最適化に通すと
    // maplibre-gl-worker.mjs が出力されず地図が起動しない。
    exclude: ['maplibre-gl'],
  },
  };
});
