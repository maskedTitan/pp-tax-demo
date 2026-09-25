import { json } from '@sveltejs/kit';
import { gateway } from '$lib/server/braintree.js';

/**
 * POST /api/vefi/billing-with-purchase
 * Body: { nonce, amount }
 *
 * Flow 1: single transaction.sale that simultaneously charges the order
 * and vaults the PayPal account. The saved payment method token (PMT)
 * is read from transaction.paypalAccount.token and returned alongside
 * the customer ID so the caller can persist both for Flow 2.
 */
export async function POST({ request }) {
    try {
        const { nonce, amount } = await request.json();

        if (!nonce || !amount) {
            return json({ error: 'nonce and amount are required' }, { status: 400 });
        }

        const result = await gateway.transaction.sale({
            amount,
            paymentMethodNonce: nonce,
            options: {
                submitForSettlement: true,
                storeInVaultOnSuccess: true,
            },
        });

        if (!result.success) {
            return json({ error: result.message }, { status: 400 });
        }

        return json({
            success: true,
            transactionId: result.transaction.id,
            status: result.transaction.status,
            customerId: result.transaction.customer?.id ?? null,
            savedPaymentMethodToken: result.transaction.paypalAccount?.token ?? null,
        });
    } catch (error) {
        return json({ error: error.message }, { status: 500 });
    }
}
