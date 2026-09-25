import { json } from '@sveltejs/kit';
import { gateway } from '$lib/server/braintree.js';

const MERCHANT_ACCOUNT_ID = 'paypal_au';

/**
 * POST /api/vefi/billing-with-purchase
 * Body: { nonce, amount }
 *
 * Three explicit steps so the PMT is always returned and created via the
 * SDK nonce path — required for the VEFI edit-funding-instrument feature.
 * (vaultPayPalBillingAgreement / direct B-ID import does not attach the
 * paymentMethodIdJwt metadata that SavedPaymentMethods needs for the pencil.)
 *
 * 1. Create a Braintree customer.
 * 2. Vault the nonce → paymentMethod.create returns the PMT.
 * 3. Charge the vaulted token via paypal_au.
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

        // Step 2: Vault the nonce — paypal_au is now the gateway default so
        // paymentMethod.create routes through the correct PayPal link.
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

        // Step 3: Charge
        const saleResult = await gateway.transaction.sale({
            amount,
            paymentMethodToken: savedPaymentMethodToken,
            merchantAccountId: MERCHANT_ACCOUNT_ID,
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
