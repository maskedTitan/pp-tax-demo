import { json } from '@sveltejs/kit';
import { gateway } from '$lib/server/braintree.js';

export async function POST({ request }) {
    try {
        const { nonce, isVault, amount, type, paymentMethodToken, createCustomer } = await request.json();

        let result;

        if (type === 'paymentMethodToken' && paymentMethodToken) {
            // Returning user kept their default payment instrument — charge via vault token
            result = await gateway.transaction.sale({
                amount: amount || '10.00',
                paymentMethodToken,
                options: { submitForSettlement: true }
            });
        } else if (isVault && amount === '0.00') {
            // $0 Auth — vault without charging
            result = await gateway.paymentMethod.create({
                paymentMethodNonce: nonce,
                options: { verifyCard: true }
            });
        } else if (createCustomer) {
            // Saved PM vault: create a customer-linked payment method so the PMT
            // works with clientToken.generate({ paymentMethodToken }).
            const customerResult = await gateway.customer.create({
                paymentMethodNonce: nonce
            });
            if (!customerResult.success) {
                return json({ success: false, error: customerResult.message }, { status: 400 });
            }
            const paymentMethod = customerResult.customer.paymentMethods[0];
            return json({
                success: true,
                transactionId: null,
                vaultToken: paymentMethod?.token || null
            });
        } else {
            // Standard sale — optionally vault via storeInVaultOnSuccess (recurring flow)
            result = await gateway.transaction.sale({
                amount: amount || '10.00',
                paymentMethodNonce: nonce,
                options: {
                    submitForSettlement: false,
                    storeInVaultOnSuccess: !!isVault
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
