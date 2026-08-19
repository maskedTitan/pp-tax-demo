import { json } from '@sveltejs/kit';
import { adyenRequest } from '$lib/server/adyen.js';

/**
 * POST /api/adyen/charge-token
 * Merchant-initiated payment using a stored payment method token (recurringDetailReference)
 */
export async function POST({ request }) {
    try {
        const { storedPaymentMethodId, amount, shopperReference } = await request.json();

        if (!storedPaymentMethodId || !amount || !shopperReference) {
            return json(
                { error: 'Missing required fields: storedPaymentMethodId, amount, shopperReference' },
                { status: 400 }
            );
        }

        const paymentRequest = {
            amount: {
                currency: 'USD',
                value: Math.round(parseFloat(amount) * 100) // Convert dollars to cents
            },
            reference: `MIT_${Date.now()}`,
            paymentMethod: {
                type: 'paypal',
                storedPaymentMethodId
            },
            shopperReference,
            shopperInteraction: 'ContAuth',
            recurringProcessingModel: 'Subscription',
            returnUrl: 'http://localhost:5173/adyen'
        };

        const response = await adyenRequest('/payments', paymentRequest);

        return json(response);
    } catch (error) {
        console.error('Adyen Charge Token Error:', error);
        return json(
            { error: error.message || 'Charge token payment failed' },
            { status: 500 }
        );
    }
}
