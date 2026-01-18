import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        offscreen: "src/offscreen.js", // Kept to avoid errors if referenced elsewhere
        popup: "src/popup.js" 
      },
      output: {
        entryFileNames: "[name].js",
        format: "es"
      }
    }
  }
});