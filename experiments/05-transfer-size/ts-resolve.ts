/**
 * `src/vendor/cogp/` は内部を `./reader.js` のように拡張子 .js で参照している
 * （ブラウザ向けの ESM 解決に合わせた vendor 元のまま）。Node の型剥がしは
 * .js → .ts の読み替えをしないため、実験から直接 import すると解決に失敗する。
 *
 * vendor を書き換えると `scripts/vendor_cogp.sh` の取り直しで消えるので、
 * 実験側で解決フックを足して吸収する。
 */
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

export function registerTsJsResolution(): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
        const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true }
        }
      }
      return nextResolve(specifier, context)
    },
  })
}
