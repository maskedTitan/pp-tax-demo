import { json } from '@sveltejs/kit';
import { adyenRequest } from '$lib/server/adyen.js';
import { env } from '$env/dynamic/private';

/**
 * POST /api/adyen/payments
 * Initiates a payment with Adyen
 */
export async function POST({ request, url }) {
    try {
        const body = await request.json();
        const { data, recurring, deliveryAddress, lockAddress, shopperName } = body; // state.data from frontend

        const paymentRequest = {
            amount: { currency: "USD", value: 1000 },
            reference: `YOUR_ORDER_NUMBER_${Date.now()}`,
            paymentMethod: data.paymentMethod,
            returnUrl: "http://localhost:5173/adyen", // Redirect handling
            merchantAccount: env.ADYEN_MERCHANT_ACCOUNT,
            channel: "Web", // Required for Adyen
            shopperName: shopperName, // { firstName: "...", lastName: "..." }
            browserInfo: data.browserInfo, // Important for 3DS/Fraud
        };

        if (recurring) {
            paymentRequest.shopperReference = 'test_shopper_1';
            paymentRequest.recurringProcessingModel = 'Subscription';
            paymentRequest.storePaymentMethod = true;
            paymentRequest.shopperInteraction = 'Ecommerce';
        }

        if (deliveryAddress) {
            paymentRequest.deliveryAddress = deliveryAddress;
        }

        const response = await adyenRequest('/payments', paymentRequest);

        return json(response);
    } catch (error) {
        console.error('Adyen Payment Error:', error);
        return json(
            {
                error: error.message || 'Payment initiation failed'
            },
            { status: 500 }
        );
    }
}
