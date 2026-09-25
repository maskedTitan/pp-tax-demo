import { json } from '@sveltejs/kit';
import { gateway } from '$lib/server/braintree.js';

/**
 * POST /api/vefi/charge-nonce
 * Body: { paymentMethodNonce, amount }
 *
 * Flow 2 Path A: buyer tapped the pencil and changed their funding instrument.
 * The SDK's onApprove produces a fresh nonce for the newly chosen instrument;
 * charge that nonce (no vault update needed — the billing agreement itself is
 * unchanged, only which funding source backs it changes on the PayPal side).
 */
export async function POST({ request }) {
    try {
        const { paymentMethodNonce, amount } = await request.json();

        if (!paymentMethodNonce || !amount) {
            return json({ error: 'paymentMethodNonce and amount are required' }, { status: 400 });
        }

        const result = await gateway.transaction.sale({
            amount,
            paymentMethodNonce,
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
            path: 'A',
        });
    } catch (error) {
        return json({ error: error.message }, { status: 500 });
    }
}
