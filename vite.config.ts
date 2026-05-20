import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { visualizer } from "rollup-plugin-visualizer";
import { imagetools } from "vite-imagetools";
import { VitePWA } from "vite-plugin-pwa";
import Critters from "critters";
/// <reference types="vitest" />

// Critical CSS plugin using Critters
function criticalCSSPlugin(): Plugin {
  return {
    name: 'vite-plugin-critical-css',
    apply: 'build',
    enforce: 'post',
    async closeBundle() {
      try {
        const distDir = path.resolve(__dirname, "dist");
        const indexPath = path.join(distDir, "index.html");
        if (!fs.existsSync(indexPath)) return;

        const html = await fs.promises.readFile(indexPath, "utf8");
        const critters = new Critters({
          path: distDir,
          publicPath: "/",
          preload: "swap",
          noscriptFallback: true,
          inlineFonts: true,
          preloadFonts: true,
          compress: true,
          pruneSource: false,
        });

        const result = await critters.process(html);
        await fs.promises.writeFile(indexPath, result, "utf8");
      } catch (error) {
        console.warn("[Critical CSS] Failed to process:", error);
      }
    },
  };
}

/**
 * Strip <link rel="stylesheet"> tags for heavy lazy-loaded CSS from index.html.
 *
 * Vite adds <link> tags for ALL extracted CSS chunks to index.html, even those
 * that belong to lazy-loaded routes. This plugin removes them post-build so
 * they only load on-demand when their parent JS chunk is fetched.
 *
 * The CSS files remain in dist/assets/ — they're referenced by their JS chunks
 * via __vite__mapDeps and loaded automatically when the chunk executes.
 */
function deferHeavyCSSPlugin(): Plugin {
  // CSS files matching any of these prefixes are removed from index.html.
  // They'll still be loaded on-demand by their JS chunk.
  const deferredCssPrefixes = ['katex-vendor'];

  return {
    name: 'vite-plugin-defer-heavy-css',
    apply: 'build',
    enforce: 'post',
    async closeBundle() {
      try {
        const distDir = path.resolve(__dirname, "dist");
        const indexPath = path.join(distDir, "index.html");
        if (!fs.existsSync(indexPath)) return;

        let html = await fs.promises.readFile(indexPath, "utf8");
        for (const prefix of deferredCssPrefixes) {
          // Match <link rel="stylesheet" ... href=".../{prefix}-{hash}.css">
          const re = new RegExp(
            `\\s*<link[^>]*href="[^"]*/${prefix}-[^"]*\\.css"[^>]*>`,
            'g'
          );
          html = html.replace(re, '');
        }
        await fs.promises.writeFile(indexPath, html, "utf8");
      } catch (error) {
        console.warn("[Defer Heavy CSS] Failed to process:", error);
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Root cause: terser minification can OOM on 2-core / 8GB builders (Vercel + local).
  // Default to esbuild minify for reliability; opt into terser via NODEBENCH_MINIFY=terser.
  //
  // Example:
  //   NODEBENCH_MINIFY=terser npm run build
  //   NODEBENCH_MINIFY=esbuild npm run build
  //
  // "esbuild" is the Vite default and is far more memory efficient.
  // Terser is retained for optional maximum compression.
  const minify = (process.env.NODEBENCH_MINIFY ?? "esbuild") === "terser" ? "terser" : "esbuild";
  const useTerser = minify === "terser";
  const enableCriticalCss = mode === "production" && process.env.NODEBENCH_CRITICAL_CSS === "1";
  const nodebenchServerTarget =
    process.env.VITE_NODEBENCH_SERVER_TARGET ??
    process.env.NODEBENCH_SERVER_TARGET ??
    "http://localhost:3100";

  return ({
    server: {
      host: true, // Bind to all interfaces so Chrome can reach the dev server
      proxy: {
        "/api/search": {
          target: "http://localhost:8020",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/search/, "/v1/search"),
        },
        "/api/search-upload": {
          target: "http://localhost:8020",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/search-upload/, "/search/upload"),
        },
        "/api/search-health": {
          target: "http://localhost:8020",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/search-health/, "/health"),
        },
        "/api/search-history": {
          target: nodebenchServerTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/search-history/, "/search/history"),
        },
        "/api/search-sync-status": {
          target: nodebenchServerTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/search-sync-status/, "/search/sync-status"),
        },
        "/api/sync-bridge": {
          target: nodebenchServerTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/sync-bridge/, "/api/sync-bridge"),
        },
        "/api/hyperloop": {
          target: nodebenchServerTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/hyperloop/, "/api/hyperloop"),
        },
        "/api/pipeline": {
          target: nodebenchServerTarget,
          changeOrigin: true,
        },
        "/api/improvements": {
          target: nodebenchServerTarget,
          changeOrigin: true,
        },
        "/api/retention": {
          target: nodebenchServerTarget,
          changeOrigin: true,
        },
        "/api/search/stream": {
          target: nodebenchServerTarget,
          changeOrigin: true,
        },
        "/api/product": {
          target: nodebenchServerTarget,
          changeOrigin: true,
        },
        "/voice": {
          target: nodebenchServerTarget,
          changeOrigin: true,
        },
      },
    },
    plugins: [
    react(),
    // Service Worker + PWA for aggressive caching
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'favicon.ico',
        'robots.txt',
        'apple-touch-icon.png',
        'pwa-192.png',
        'pwa-512.png',
        'mask-icon.svg',
      ],
       manifest: {
         name: 'NodeBench AI',
         short_name: 'NodeBench',
         description: 'AI-powered research and analytics platform',
         theme_color: '#09090B',
         background_color: '#09090B',
         display: 'standalone',
         start_url: '/?surface=chat',
         scope: '/',
         icons: [
           {
             src: '/pwa-192.png',
             sizes: '192x192',
             type: 'image/png',
           },
           {
             src: '/pwa-512.png',
             sizes: '512x512',
             type: 'image/png',
           },
           {
             src: '/pwa-512.png',
             sizes: '512x512',
             type: 'image/png',
             purpose: 'maskable',
           },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // CRITICAL: navigateFallbackDenylist with NetworkFirst on navigation
        // requests means HTML responses are NEVER cache-served. This is the
        // single biggest cause of "users see stale bundle after deploy".
        // With NetworkFirst, every navigation goes to the network first,
        // and only falls back to cache when offline. New deploys reach
        // users on the next page load, not after manual cache clear.
        //
        // The hashed JS/CSS chunks below stay on StaleWhileRevalidate —
        // they're content-addressed (index-COn3r21_.js) so cache is safe.
        // It's the entry HTML that points to those chunks that must NOT
        // be cached, otherwise users get the OLD HTML pointing at OLD chunks.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // Dogfood generation archives are QA evidence, not runtime assets.
        // Keep them fetchable under /dogfood, but do not precache every
        // archived screenshot into the service worker for normal users.
        globIgnores: [
          '**/dogfood/generations/**',
          '**/node_modules/**',
          '**/proto/**/node_modules/**',
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/voice\//, /^\/install\.sh/],
        runtimeCaching: [
          // Navigation requests — NetworkFirst with short timeout.
          // Users see new deploys on the next page load, not after cache clear.
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'navigation-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24, // 1 day max for HTML
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          // Cache Google Fonts
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // Cache JS/CSS with stale-while-revalidate
          {
            urlPattern: /\.(?:js|css)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'static-resources',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
          // Cache images
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
        ],
      },
    }),
    // Image optimization - converts PNG/JPG to WebP with quality 80
    imagetools({
      defaultDirectives: (url) => {
        // Only optimize images in public/assets
        if (url.searchParams.has('url') && url.searchParams.get('url')?.includes('/assets/')) {
          return new URLSearchParams({
            format: 'webp',
            quality: '80',
          });
        }
        return new URLSearchParams();
      },
    }),
     // Critical CSS inlining can significantly increase build time on constrained builders.
     // Keep it opt-in (NODEBENCH_CRITICAL_CSS=1) and rely on `index.html` baseline styles to prevent FOUC.
     enableCriticalCss ? criticalCSSPlugin() : null,
     // Remove katex-vendor CSS from index.html — it's only needed in the agents surface
     deferHeavyCSSPlugin(),
    // Bundle analyzer - run with: ANALYZE=true npm run build
    process.env.ANALYZE === 'true' ? visualizer({
      filename: './dist/stats.html',
      open: true,
      gzipSize: true,
      brotliSize: true,
    }) : null,
    // The code below enables dev tools like taking screenshots of your site
    // while it is being developed on chef.convex.dev.
    // Feel free to remove this code if you're no longer developing your app with Chef.
    mode === "development"
      ? {
          name: "inject-chef-dev",
          transform(code: string, id: string) {
            if (id.includes("main.tsx")) {
              return {
                code: `${code}

/* Added by Vite plugin inject-chef-dev */
window.addEventListener('message', async (message) => {
  if (message.source !== window.parent) return;
  if (message.data.type !== 'chefPreviewRequest') return;

  const worker = await import('https://chef.convex.dev/scripts/worker.bundled.mjs');
  await worker.respondToMessage(message);
});
            `,
                map: null,
              };
            }
            return null;
          },
        }
      : null,
    // End of code for taking screenshots on chef.convex.dev.
  ].filter(Boolean),
  resolve: {
    // Order matters: keep specific aliases above the generic "@/" alias.
    alias: [
      { find: "@features", replacement: path.resolve(__dirname, "./src/features").replace(/\\/g, "/") },
      { find: "@shared", replacement: path.resolve(__dirname, "./src/shared").replace(/\\/g, "/") },
      { find: "shared", replacement: path.resolve(__dirname, "./shared").replace(/\\/g, "/") },
      { find: /^@\//, replacement: `${path.resolve(__dirname, "./src").replace(/\\/g, "/")}/` },
    ],
    // Prevent duplicate React instances (common cause of "Invalid hook call" in Vite/monorepo setups).
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "rehype-raw", "rehype-sanitize", "rehype-parse", "hast-util-raw"],
    // Exclude heavy libraries that are lazy-loaded to speed up dev server start
    exclude: ["@pdfme/generator"],
  },
  // esbuild options for transforms (and for minification when NODEBENCH_MINIFY=esbuild)
  esbuild: {
    // eslint-disable-next-line no-undef
    // Keep `console.error`/`console.warn` in production so ErrorBoundaries and
    // client error reporting can surface actionable diagnostics.
    drop: mode === "production" ? ["debugger"] : undefined,
    pure: mode === "production" ? ["console.log", "console.info", "console.debug"] : undefined,
    // Remove legal comments for smaller transforms
    legalComments: 'none',
    // Tree shake during transforms
    treeShaking: true,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
  build: {
    // The heaviest routes/editors are lazy-loaded; keep this warning slightly higher
    // so it flags meaningful regressions without noise.
    chunkSizeWarningLimit: 2200,
    minify,
    target: "es2020",
    cssMinify: true,
    // Modern browsers don't need module preload polyfill.
    // Custom resolveDependencies limits preload to essential first-paint chunks
    // (vendor + small shared code). Heavy lazy-loaded chunks (agent-fast-panel,
    // editor-vendor, recharts-vendor, etc.) are excluded — they load on demand
    // when the user navigates to their surface.
    modulePreload: {
      polyfill: false,
      resolveDependencies(filename, deps) {
        // Only preload deps for the entry file
        if (!filename.includes('index')) return [];
        // Filter out heavy chunks that are lazy-loaded surfaces, not first-paint
        const heavyChunkPrefixes = [
          'agent-fast-panel', 'agent-autonomous', 'agent-oracle', 'agent-topic',
          'agent-sidebar', 'agent-approval', 'agent-notifications',
          'route-agents', 'route-research', 'route-documents', 'route-calendar',
          'route-analytics', 'route-spreadsheets',
          'editor-vendor', 'syntax-vendor', 'katex-vendor', 'katex-lazy', 'recharts-vendor',
          'spreadsheet-vendor',
          'Workbench', 'Benchmark',
          'doc-', 'editor-',
          'trajectory', 'DevDashboard', 'SettingsModal',
        ];
        return deps.filter(dep => {
          const basename = dep.split('/').pop() ?? dep;
          return !heavyChunkPrefixes.some(prefix => basename.startsWith(prefix));
        });
      },
    },
    terserOptions: useTerser ? {
      compress: {
        // Keep `console.error`/`console.warn` for diagnostics; strip noisy logs only.
        drop_console: false,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug'], // Remove specific console methods
        passes: 2, // Multiple compression passes for better results
      },
      mangle: {
        safari10: true, // Safari 10 compatibility
      },
      format: {
        comments: false, // Remove all comments
      },
    } : undefined,
    rollupOptions: {
      // Tree shaking - be careful with external deps that have side effects
      treeshake: {
        moduleSideEffects: true, // Don't assume side-effect-free (fixes lucide-react init)
        propertyReadSideEffects: false,
        tryCatchDeoptimization: false,
      },
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        // Route-based code splitting for optimal loading
        manualChunks(id) {
          // KaTeX lazy-loader wrapper — force into its own tiny chunk so Rollup
          // does NOT inline it into agent-fast-panel. If inlined, Rollup hoists
          // katex-vendor as a static dep of agent-fast-panel (and transitively
          // the main bundle). As a separate chunk, the dynamic import boundary
          // is preserved: agent-fast-panel -> (dynamic) -> katex-lazy -> (static) -> katex-vendor.
          if (id.includes('lazyRehypeKatex')) {
            return 'katex-lazy';
          }
          // Convex generated API — MUST be in its own chunk.
          // convex/_generated/api.ts creates 513 circular dependency chains
          // with convex/ action/tool files. When Rollup inlines it into the
          // main bundle, ESM execution order causes TDZ crash in headless
          // Chrome: "Cannot access 'o' before initialization".
          // Isolating it breaks the circular init chain.
          if (id.includes('convex/_generated/')) {
            return 'convex-runtime';
          }
          // Convex domain files (actions, tools, operations) — keep together
          // to avoid splitting circular deps across chunks.
          if (id.match(/convex\/(actions|domains|tools|crons|workflows)\//)) {
            return 'convex-runtime';
          }
          // Vendor chunks - only split large/important libraries
          if (id.includes('/node_modules/')) {
            // React core (keep small and cacheable)
            if (id.match(/\/node_modules\/(react\/|react-dom\/|scheduler\/)/)) {
              return 'react-vendor';
            }
            if (id.includes('/node_modules/react-router-dom/')) {
              return 'router-vendor';
            }
            // Convex (API client)
            if (id.includes('/node_modules/convex/')) {
              return 'convex-runtime';
            }
            // Editor ecosystem — ALL related packages MUST land in one chunk.
            // @blocknote/@tiptap/prosemirror have circular init deps; splitting
            // them across chunks causes "Cannot access X before initialization".
            // Including the full transitive set (unified/rehype/remark, yjs,
            // emoji-mart, floating-ui) prevents Rollup from splitting them.
            if (
              id.includes('/node_modules/@tiptap/') ||
              id.includes('/node_modules/@blocknote/') ||
              id.includes('/node_modules/prosemirror-') ||
              id.includes('/node_modules/@prosemirror-adapter/') ||
              id.includes('/node_modules/@handlewithcare/') ||
              id.includes('/node_modules/y-prosemirror') ||
              id.includes('/node_modules/y-protocols') ||
              id.includes('/node_modules/yjs/') ||
              id.includes('/node_modules/lib0/') ||
              id.includes('/node_modules/unified/') ||
              id.includes('/node_modules/rehype-') ||
              id.includes('/node_modules/remark-') ||
              id.includes('/node_modules/hast-') ||
              id.includes('/node_modules/mdast-') ||
              id.includes('/node_modules/unist-') ||
              id.includes('/node_modules/emoji-mart') ||
              id.includes('/node_modules/@emoji-mart/') ||
              id.includes('/node_modules/@floating-ui/') ||
              id.includes('/node_modules/@shikijs/')
            ) {
              return 'editor-vendor';
            }
            // Spreadsheet engine (very heavy)
            if (id.includes('/node_modules/xlsx')) {
              return 'spreadsheet-vendor';
            }
            // Date utilities (commonly used, stable)
            if (id.includes('/node_modules/date-fns/')) {
              return 'date-vendor';
            }
            // Animation library (Framer Motion - heavy)
            if (id.includes('/node_modules/framer-motion/')) {
              return 'motion-vendor';
            }
            // Markdown/syntax highlighting (heavy)
            if (id.includes('/node_modules/prismjs/') || id.includes('/node_modules/highlight.js/')) {
              return 'syntax-vendor';
            }
            // KaTeX math rendering (heavy, only used in FastAgentPanel message bubbles)
            // rehype-katex depends on katex — bundle them together so the entire
            // katex dependency tree lives in one deferred chunk.
            if (id.includes('/node_modules/katex/') || id.includes('/node_modules/rehype-katex/')) {
              return 'katex-vendor';
            }
            // Recharts (heavy charting, used in TelemetryInspector + ModelEvalDashboard)
            if (id.includes('/node_modules/recharts/')) {
              return 'recharts-vendor';
            }
            // Zod (validation, commonly used)
            if (id.includes('/node_modules/zod/')) {
              return 'zod-vendor';
            }
            // Let everything else be handled by Vite's default splitting
            // This avoids creating one massive vendor chunk
          }

          // Route-based splitting for application features
          if (id.includes('/features/analytics/')) {
            return 'route-analytics';
          }
          // Benchmarks: let Rollup decide chunking. Manual splitting caused TDZ
          // crashes in headless Chrome — bench-* chunks had circular init deps
          // with agent-fast-panel and convex-api that Rollup couldn't resolve
          // when forced into separate chunks.
          // Trajectory: lazy-loaded from WorkbenchView and other views
          if (id.includes('/features/trajectory/')) {
            return 'trajectory';
          }
          // Documents feature: per-boundary chunking so only the active
          // mode/overlay loads. Each chunk matches a React.lazy() boundary.
          if (id.includes('/features/documents/')) {
            // Per-mode view surfaces (lazy-loaded by DocumentsTabContent)
            if (id.includes('/viewModes/DocumentsCardsView')) return 'doc-view-cards';
            if (id.includes('/viewModes/DocumentsListView')) return 'doc-view-list';
            if (id.includes('/viewModes/DocumentsSegmentedView')) return 'doc-view-segmented';
            if (id.includes('/viewModes/index')) return undefined; // barrel — let Vite decide
            // VisualGlimpse preview renderer (lazy-loaded by DocumentCard)
            if (id.includes('/cards/VisualGlimpse')) return 'doc-visual-glimpse';
            // Preview family modules (lazy-loadable by family)
            if (id.includes('/previews/SpreadsheetPreview')) return 'doc-preview-spreadsheet';
            // Media cinema viewer (lazy-loaded by PlannerOverlays)
            if (id.includes('/MediaCinemaViewer')) return 'doc-media-viewer';
            // Sidebar panel (lazy-loaded by WorkspaceSurface)
            if (id.includes('/DocumentSidebarPanel')) return 'doc-sidebar';
            // Planner surface island (lazy-loaded by DocumentsHomeHub)
            if (id.includes('/DocumentsPlannerSurface')) return 'doc-planner-surface';
            // Planner overlays (lazy-loaded by PlannerSurface)
            if (id.includes('/DocumentsPlannerOverlays')) return 'doc-planner-overlays';
            // Planner hooks (loaded by PlannerSurface, not entry)
            if (id.includes('/hooks/usePlannerController')) return 'doc-planner-surface';
            if (id.includes('/hooks/usePlannerDateNav')) return 'doc-planner-surface';
            if (id.includes('/hooks/usePlannerAgendaData')) return 'doc-planner-surface';
            if (id.includes('/hooks/usePlannerViewPrefs')) return 'doc-planner-surface';
            if (id.includes('/hooks/usePlannerEditor')) return 'doc-planner-surface';
            if (id.includes('/hooks/usePlannerMutations')) return 'doc-planner-surface';
            // Planner provider (loaded by PlannerSurface)
            if (id.includes('/context/DocumentsPlannerProvider')) return 'doc-planner-surface';
            // Secondary views — NOT on documents entry path, loaded by
            // ActiveSurfaceHost or other lazy boundaries
            if (id.includes('/views/SpreadsheetView')) return 'doc-view-spreadsheet';
            if (id.includes('/views/FileViewer')) return 'doc-view-file';
            if (id.includes('/views/DocumentView')) return 'doc-view-document';
            if (id.includes('/views/PublicDocuments')) return undefined; // tiny, let Vite decide
            // Components only used by secondary views (not entry path)
            if (id.includes('/DocumentHeader')) return 'doc-view-document';
            if (id.includes('/CodeViewer')) return 'doc-view-file';
            if (id.includes('/DocumentGrid')) return 'doc-legacy-grid'; // dead code, legacy only
            // Spreadsheet surfaces — lazy-loaded from ActiveSurfaceHost
            if (id.includes('/surfaces/spreadsheets/')) return 'doc-spreadsheet-surface';
            // Editors — lazy-loaded from MiniEditorPopover in @shared/
            if (id.includes('/editors/SpreadsheetMiniEditor')) return 'doc-editor-spreadsheet';
            if (id.includes('/editors/DossierMiniEditor')) return 'doc-editor-dossier';
            if (id.includes('/editors/DocumentMiniEditor')) return 'doc-editor-document';
            if (id.includes('/editors/DualEditMiniPanel')) return 'doc-editor-dual';
            if (id.includes('/editors/DualCreateMiniPanel')) return 'doc-editor-dual';
            if (id.includes('/editors/PopoverMiniEditor')) return 'doc-editor-popover';
            // Everything else stays in route-documents
            return 'route-documents';
          }
          // Agents feature: carve out lazy-loaded panels so React.lazy() produces separate chunks
          if (id.includes('/features/agents/')) {
            // Heavy panels lazy-loaded from AgentsHub
            if (id.includes('/AutonomousOperationsPanel')) return 'agent-autonomous-ops';
            if (id.includes('/OracleControlTowerPanel')) return 'agent-oracle-tower';
            if (id.includes('/TopicCanvasPanel')) return 'agent-topic-canvas';
            if (id.includes('/AgentSidebar')) return 'agent-sidebar';
            if (id.includes('/HumanApprovalQueue')) return 'agent-approval-queue';
            if (id.includes('/NotificationActivityPanel')) return 'agent-notifications';
            // Lazy sub-surfaces used by AgentsHub or FastAgentPanel — let Vite split
            if (id.includes('/SwarmLanesView') || id.includes('/FreeModelRankingsPanel') || id.includes('/TaskManager/')) return undefined;
            // FastAgentPanel: tab-gated sub-components are lazy-loaded.
            // Exclude them from the catch-all so they get their own chunks.
            if (id.includes('/FastAgentPanel/')) {
              // Tab-gated panels (lazy-loaded on tab switch, not on panel open)
              if (id.includes('.Settings')) return 'agent-panel-settings';
              if (id.includes('.DisclosureTrace')) return 'agent-panel-trace';
              if (id.includes('.TraceAuditPanel')) return 'agent-panel-trace';
              if (id.includes('.BriefTab')) return 'agent-panel-brief';
              if (id.includes('.AgentTasksTab')) return 'agent-panel-tasks';
              if (id.includes('.EditsTab')) return 'agent-panel-edits';
              if (id.includes('.ParallelTaskTimeline')) return 'agent-panel-timeline';
              if (id.includes('.DecisionTreeKanban')) return 'agent-panel-kanban';
              if (id.includes('.PromptEnhancer')) return 'agent-panel-enhancer';
              if (id.includes('.SkillsPanel')) return 'agent-panel-skills';
              if (id.includes('.AgentHierarchy')) return 'agent-panel-hierarchy';
              if (id.includes('JarvisHUD')) return 'agent-panel-hud';
              if (id.includes('MediaGallery')) return 'agent-panel-media';
              if (id.includes('FileViewer')) return 'agent-panel-fileviewer';
              // Core chat shell — stays in agent-fast-panel
              return 'agent-fast-panel';
            }
            // Agent contexts — shared across entry + lazy chunks, let Vite split
            if (id.includes('/features/agents/context/')) return undefined;
            // AgentsHub is the landing view — only this stays in route-agents
            if (id.includes('/views/AgentsHub')) return 'route-agents';
            // Non-landing views: used as embedded sub-surfaces by AgentsHub or
            // FastAgentPanel. Let Vite split naturally so they land in the chunk
            // of their actual consumer, not forced into the landing entry.
            if (id.includes('/views/LiveAgentLanes')) return undefined;
            if (id.includes('/views/TaskPlanPanel')) return undefined;
            if (id.includes('/views/WorkflowMetricsBar')) return undefined;
            if (id.includes('/views/DeepAgentProgress')) return undefined;
            if (id.includes('/views/PublicActivityView')) return undefined;
            // Everything else (shared hooks, types, utils) — let Vite decide
            return undefined;
          }
          // Research feature: Split into core hub vs lazy-loaded sections
          // This allows React.lazy() components to become separate chunks
          if (id.includes('/features/research/views/ResearchHub')) {
            return 'route-research-hub';
          }
          if (id.includes('/features/research/views/CinematicHome')) {
            return 'route-research-home';
          }
          // Research sections: default-tab sections stay with hub (eagerly imported).
          // Tab-gated sections (BriefingSection, FeedSection) are lazy-loaded by
          // ResearchHub — let Vite split them into their consumer's chunk naturally.
          if (id.includes('/features/research/sections/BriefingSection')) return 'research-briefing';
          if (id.includes('/features/research/sections/FeedSection')) return 'research-feed';
          if (id.includes('/features/research/sections/DealListSection')) return 'research-deals';
          // DigestSection and DashboardSection are default-tab — stay in hub
          if (id.includes('/features/research/sections/')) return 'route-research-hub';
          if (id.includes('/features/research/components/')) {
            // Let components chunk naturally via lazy loading
            return undefined;
          }
          if (id.includes('/features/spreadsheets/')) {
            return 'route-spreadsheets';
          }
          if (id.includes('/features/calendar/')) {
            return 'route-calendar';
          }

          // Heavy editors from src
          if (id.includes('/components/Editor/') || id.includes('UnifiedEditor')) {
            return 'editor';
          }

          // Default: shared application code
          return undefined;
        },
      },
    },
    // Enable source maps for production debugging (can disable for smaller bundles)
    sourcemap: false, // Disable source maps to reduce bundle size
  },
  });
});
