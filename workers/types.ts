// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Cloudflare.Env {
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
	// Sent.dm SMS. SENT_API_KEY is a secret (wrangler secret put SENT_API_KEY).
	// SENT_TEMPLATE_ID, DIGEST_SMS_RECIPIENT, and SENT_SANDBOX come from
	// wrangler.jsonc vars and are typed via wrangler types (worker-configuration.d.ts).
	SENT_API_KEY: string;
	// Inbound SMS webhook. SENT_WEBHOOK_SECRET is a secret (wrangler secret put SENT_WEBHOOK_SECRET).
	// It is the whsec_... signing secret from the sent.dm dashboard for the /webhooks/sms endpoint.
	// SENT_SMS_MAILBOX_ID comes from wrangler.jsonc vars and is typed in worker-configuration.d.ts.
	SENT_WEBHOOK_SECRET: string;
}
