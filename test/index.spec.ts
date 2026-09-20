import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";

describe("StreamFlow worker", () => {
	describe("request for /health", () => {
		it("/health responds with JSON status (unit style)", async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>(
				"http://example.com/health"
			);
			// Create an empty context to pass to `worker.fetch()`.
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.status).toBe("ok");
			expect(data.server).toBe("StreamFlow on Cloudflare (Native)");
		});

		it("responds with JSON status (integration style)", async () => {
			const request = new Request("http://example.com/health");
			const response = await SELF.fetch(request);
			
			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.status).toBe("ok");
			expect(data.server).toBe("StreamFlow on Cloudflare (Native)");
		});
	});
});
