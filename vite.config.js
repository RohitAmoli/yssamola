import { resolve } from "path"
import { defineConfig } from "vite"

// Static multi-page site. Each HTML file is a standalone, deployable page
// (works as-is on GitHub Pages); Vite is only used for local dev + build.
export default defineConfig({
  root: ".",
  server: { host: true, port: 3000, allowedHosts: true },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        about: resolve(__dirname, "about.html"),
        activities: resolve(__dirname, "activities.html"),
        live: resolve(__dirname, "live.html"),
        gallery: resolve(__dirname, "gallery.html"),
        join: resolve(__dirname, "join.html"),
        donate: resolve(__dirname, "donate.html"),
        contact: resolve(__dirname, "contact.html"),
        member: resolve(__dirname, "member.html"),
        news: resolve(__dirname, "news.html"),
      },
    },
  },
})
