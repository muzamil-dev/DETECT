// @ts-check
import { defineConfig } from "astro/config";

import tailwind from "@astrojs/tailwind";
import svelte from "@astrojs/svelte";
import preact from "@astrojs/preact";

// https://astro.build/config
export default defineConfig({
  output: "static",
  vite: {
    server: {
      host: true,
    },
  },
  integrations: [tailwind(), svelte(), preact()],
});
