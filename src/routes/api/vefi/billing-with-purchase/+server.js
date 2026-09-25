import { json } from '@sveltejs/kit';
import { gateway } from '$lib/server/braintree.js';

/**
 * POST /api/vefi/billing-with-purchase
 * Body: { nonce, amount }
 *
 * Flow 1: three explicit steps so the PMT is always returned.
 * storeInVaultOnSuccess is unreliable for returning the token when the
 * nonce carries a billing agreement — the vault happens but token comes
 * back null. Doing the steps separately guarantees we get the PMT.
 *
 * 1. Create a Braintree customer.
 * 2. Vault the nonce to that customer → get the PMT.
 * 3. Charge the vaulted token.
 */
export async function POST({ request }) {
    try {
        const { nonce, amount } = await request.json();

        if (!nonce || !amount) {
            return json({ error: 'nonce and amount are required' }, { status: 400 });
        }

        // Step 1: Create customer
        const customerResult = await gateway.customer.create({});
        if (!customerResult.success) {
            return json(
                { error: `Failed to create customer: ${customerResult.message}` },
                { status: 400 }
            );
        }
        const customerId = customerResult.customer.id;

        // Step 2: Vault the nonce
        const vaultResult = await gateway.paymentMethod.create({
            customerId,
            paymentMethodNonce: nonce,
        });
        if (!vaultResult.success) {
            return json(
                { error: `Failed to vault payment method: ${vaultResult.message}` },
                { status: 400 }
            );
        }
        const savedPaymentMethodToken = vaultResult.paymentMethod.token;

        // Step 3: Charge the vaulted token
        const saleResult = await gateway.transaction.sale({
            amount,
            paymentMethodToken: savedPaymentMethodToken,
            options: { submitForSettlement: true },
        });
        if (!saleResult.success) {
            return json({ error: saleResult.message }, { status: 400 });
        }

        return json({
            success: true,
            transactionId: saleResult.transaction.id,
            status: saleResult.transaction.status,
            customerId,
            savedPaymentMethodToken,
        });
    } catch (error) {
        return json({ error: error.message }, { status: 500 });
    }
}
