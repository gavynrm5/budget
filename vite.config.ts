/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// base "./" makes the build work on GitHub Pages (project sub-path) and on
// Cloudflare Pages (root) without any changes. Routing uses URL hashes (#/budget).
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png", "icons/favicon.svg"],
      manifest: {
        name: "Pay Period Budget",
        short_name: "Budget",
        description: "Personal budget that runs on pay periods (15th to 14th).",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0A0A0A",
        theme_color: "#0A0A0A",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
        // Never let the service worker intercept Firebase auth handler pages.
        navigateFallbackDenylist: [/^\/__\//]
      }
    })
  ],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: { firebase: ["firebase/app", "firebase/auth", "firebase/firestore"], react: ["react", "react-dom", "react-router-dom"] }
      }
    }
  },
  test: { environment: "node" }
});
