import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@stiksound/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      "@stiksound/providers": path.resolve(__dirname, "../../packages/providers/src/index.ts"),
      "@stiksound/media-web": path.resolve(__dirname, "../../packages/media-web/src/index.ts"),
      "@stiksound/ui": path.resolve(__dirname, "../../packages/ui/src/index.ts")
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, "popup.html"),
        sidepanel: path.resolve(__dirname, "sidepanel.html"),
        editor: path.resolve(__dirname, "editor.html"),
        background: path.resolve(__dirname, "src/background.ts")
      },
      output: {
        entryFileNames: "[name].js"
      }
    }
  }
});
