import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build works whether GitHub Pages serves it at
// https://<user>.github.io/ or https://<user>.github.io/<repo>/
export default defineConfig({
  base: "./",
  plugins: [react()],
});
