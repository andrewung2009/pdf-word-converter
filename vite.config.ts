import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'node:path';

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "frame-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const engineContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' blob: 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function productionCsp(): Plugin {
  return {
    name: 'production-csp',
    apply: 'build',
    transformIndexHtml(html, context) {
      const isEngine = context.path.endsWith('engine.html');
      const policy = isEngine ? engineContentSecurityPolicy : contentSecurityPolicy;
      const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
      return html.replace('<head>', `<head>\n    ${meta}`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    productionCsp(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/pdfjs-dist/cmaps', dest: 'pdfjs', rename: { stripBase: 2 } },
        { src: 'node_modules/pdfjs-dist/standard_fonts', dest: 'pdfjs', rename: { stripBase: 2 } },
        { src: 'node_modules/pdfjs-dist/wasm', dest: 'pdfjs', rename: { stripBase: 2 } },
        { src: 'node_modules/pdfjs-dist/iccs', dest: 'pdfjs', rename: { stripBase: 2 } },
        { src: 'node_modules/pdf2docx-wasm/*', dest: 'engine/pdf2docx', rename: { stripBase: 2 } },
      ],
    }),
  ],
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: resolve('index.html'),
        engine: resolve('engine.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
});
