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
            amount: { currency: "USD", value: 100 }, // $1.00
            reference: `YOUR_ORDER_NUMBER_${Date.now()}`,
            paymentMethod: data.paymentMethod,
            returnUrl: "http://localhost:5173/adyen",
            merchantAccount: env.ADYEN_MERCHANT_ACCOUNT,
            channel: "Web",
            countryCode: "US",
            origin: "http://localhost:5173",
            shopperEmail: "test-buyer@example.com",
            shopperName: shopperName,
            browserInfo: data.browserInfo,
            // lineItems removed to prevent validation mismatches
            additionalData: {
                "paypal.intent": "sale"
            }
        };

        console.log("Adyen Payment Method Type:", data.paymentMethod?.type);

        // Treat 'paypal' and 'venmo' similarly for address handling (omitting prevents collisions)
        // We NOW ALLOW recurring for BOTH (since your account supports Venmo Vaulting!).
        const isPayPalOrVenmo = ['venmo', 'paypal', 'paywithgoogle'].includes(data.paymentMethod?.type);

        if (recurring) {
            paymentRequest.shopperReference = 'test_shopper_1';
            paymentRequest.recurringProcessingModel = 'Subscription';
            paymentRequest.storePaymentMethod = true;
            paymentRequest.shopperInteraction = 'Ecommerce';
        }

        // We omit delivery address for PayPal/Venmo to rely on their internal address selection ("GET_FROM_FILE" equivalent)
        if (deliveryAddress && !isPayPalOrVenmo) {
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
