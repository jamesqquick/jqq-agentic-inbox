import { defineConfig } from "vitest/config";

// Unit tests run in a plain Node environment. Tests are co-located with the
// code they cover as `*.test.ts` files (see AGENTS.md "Testing").
//
// Modules under test should avoid Worker-only imports (Browser Rendering,
// Durable Objects, etc.) so they can run here without workerd. For code that
// genuinely needs Worker bindings, introduce `@cloudflare/vitest-pool-workers`
// in a separate project rather than forcing everything into workerd.
export default defineConfig({
	test: {
		environment: "node",
		include: ["{workers,shared,app}/**/*.{test,spec}.ts"],
	},
});
