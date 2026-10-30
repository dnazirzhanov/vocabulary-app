import { createReadStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The API runs separately (backend/, port 8000); both dev and preview servers proxy /api to it.
const proxy = { '/api': 'http://localhost:8000' };

/**
 * Reading photos (ADR 0029) runs Tesseract in the browser. Its worker, engine and English model
 * are served from our own origin under /ocr/, not a public CDN, so photo reading works on networks
 * that block those (schools often do). They come from node_modules at pinned versions: served by
 * the dev server, copied into the build.
 */
function ocrAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const core = dirname(require.resolve('tesseract.js-core/package.json'));
  const files: Record<string, string> = {
    'worker.min.js': join(dirname(require.resolve('tesseract.js/package.json')), 'dist/worker.min.js'),
    // The LSTM engine in its three builds: the worker picks the fastest the browser supports.
    ...Object.fromEntries(
      [
        'tesseract-core-lstm.wasm.js',
        'tesseract-core-simd-lstm.wasm.js',
        'tesseract-core-relaxedsimd-lstm.wasm.js',
      ].map((name) => [name, join(core, name)]),
    ),
    'eng.traineddata.gz': join(
      dirname(require.resolve('@tesseract.js-data/eng/package.json')),
      '4.0.0_best_int/eng.traineddata.gz',
    ),
  };
  return {
    name: 'ocr-assets',
    configureServer(server) {
      server.middlewares.use('/ocr/', (request, response, next) => {
        const source = files[(request.url ?? '').replace(/^\//, '').split('?')[0]];
        if (!source) return next();
        // Worker scripts only run when served as JavaScript.
        response.setHeader('Content-Type', source.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        createReadStream(source).pipe(response);
      });
    },
    generateBundle() {
      for (const [name, source] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(source) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), ocrAssets()],
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 4173, strictPort: true, proxy },
});
