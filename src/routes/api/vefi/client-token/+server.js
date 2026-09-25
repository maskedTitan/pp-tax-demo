import { json } from '@sveltejs/kit';
import { gateway } from '$lib/server/braintree.js';

/**
 * GET /api/vefi/client-token
 * Plain (un-scoped) client token for Flow 1 (first-time buyer).
 */
export async function GET() {
    try {
        const result = await gateway.clientToken.generate({});
        return json({ clientToken: result.clientToken });
    } catch (error) {
        return json({ error: error.message }, { status: 500 });
    }
}
