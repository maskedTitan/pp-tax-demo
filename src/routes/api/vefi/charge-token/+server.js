import { json } from '@sveltejs/kit';
import { gateway } from '$lib/server/braintree.js';

/**
 * POST /api/vefi/charge-token
 * Body: { paymentMethodToken, amount }
 *
 * Flow 2 Path B: buyer keeps their saved funding instrument and reorders.
 * No paysheet, no nonce — charge the stored PMT directly as a
 * merchant-initiated transaction.
 */
export async function POST({ request }) {
    try {
        const { paymentMethodToken, amount } = await request.json();

        if (!paymentMethodToken || !amount) {
            return json({ error: 'paymentMethodToken and amount are required' }, { status: 400 });
        }

        const result = await gateway.transaction.sale({
            amount,
            paymentMethodToken,
            merchantAccountId: 'paypal_au',
            options: { submitForSettlement: true },
        });

        if (!result.success) {
            return json({ error: result.message }, { status: 400 });
        }

        return json({
            success: true,
            transactionId: result.transaction.id,
            status: result.transaction.status,
            path: 'B',
        });
    } catch (error) {
        return json({ error: error.message }, { status: 500 });
    }
}
