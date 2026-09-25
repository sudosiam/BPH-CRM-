import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, __dirname, "VITE_");
  const supabaseUrl = process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY;
  if (process.env.VERCEL && (!supabaseUrl || !supabaseKey)) {
    throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the Vercel project settings, then redeploy.");
  }

  return {
    plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      registerType: "autoUpdate",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,ico}"],
      },
      manifest: {
        name: "BPH CRM",
        short_name: "BPH",
        description: "Leads, follow-ups, sold, and lost.",
        theme_color: "#EFECE4",
        background_color: "#EFECE4",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      devOptions: { enabled: true },
    }),
    ],
    resolve: {
      alias: { "@shared": path.resolve(__dirname, "../../shared") },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: { "/api": "http://127.0.0.1:8787" },
      fs: { allow: [path.resolve(__dirname, "../..")] },
    },
  };
});
