import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/web",
  base: "/",
  plugins: [react()],
  build: { outDir: "../../dist", emptyOutDir: true, sourcemap: false },
  // dev server: hot reload for the page; /api goes to the Express server (npm start) so the Etherscan proxy works in development too
  server: { port: 5173, proxy: { "/api": "http://localhost:3000" } },
});
