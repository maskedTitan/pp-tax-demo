import { json } from '@sveltejs/kit';
import { gateway } from '$lib/server/braintree.js';

export async function POST({ request }) {
    try {
        const { nonce, isVault, amount } = await request.json();

        let result;

        if (isVault && amount === '0.00') {
            // $0 Auth / Setup token equivalent in Braintree
            result = await gateway.paymentMethod.create({
                paymentMethodNonce: nonce,
                options: {
                    verifyCard: true
                }
            });
        } else {
            // Standard Sale / Recurring Initial Charge
            result = await gateway.transaction.sale({
                amount: amount || '10.00',
                paymentMethodNonce: nonce,
                options: {
                    submitForSettlement: false, // Changed to false for authorize flow
                    storeInVaultOnSuccess: isVault // Store for future if recurring
                }
            });
        }

        if (result.success) {
            return json({ 
                success: true, 
                transactionId: result.transaction?.id || null,
                vaultToken: result.paymentMethod?.token || result.transaction?.paypalAccount?.token || null
            });
        } else {
            return json({ success: false, error: result.message }, { status: 400 });
        }
    } catch (error) {
        console.error('Transaction error:', error);
        return json({ error: 'Failed to process transaction' }, { status: 500 });
    }
}
