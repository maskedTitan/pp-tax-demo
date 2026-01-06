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
        const { data, recurring, disableShipping, deliveryAddress, lockAddress, shopperName } = body; // state.data from frontend

        // PayPal and Venmo both report as type 'paypal' through Adyen
        // We can't distinguish them from the payment method data alone
        const isPayPalType = data.paymentMethod?.type === 'paypal';
        console.log('Payment Method Type:', data.paymentMethod?.type, '| Recurring:', recurring, '| Disable Shipping:', disableShipping);

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
            browserInfo: data.browserInfo,
            additionalData: {}
        };

        // Only include shopperName for non-PayPal/Venmo payments
        if (!isPayPalType && shopperName) {
            paymentRequest.shopperName = shopperName;
        }

        // Recurring configuration
        if (recurring) {
            paymentRequest.shopperReference = 'test_shopper_1';
            paymentRequest.recurringProcessingModel = 'Subscription';
            paymentRequest.storePaymentMethod = true;
            paymentRequest.shopperInteraction = 'Ecommerce';
        }

        // We omit delivery address for PayPal/Venmo to rely on their internal address selection
        if (deliveryAddress && !isPayPalType) {
            paymentRequest.deliveryAddress = deliveryAddress;
        }

        // PayPal/Venmo configuration
        if (isPayPalType) {
            paymentRequest.additionalData["paypal.intent"] = "sale";

            if (disableShipping) {
                console.log('Configuring PayPal/Venmo with NO_SHIPPING');
                paymentRequest.additionalData["paypal.shipping_preference"] = "NO_SHIPPING";
                paymentRequest.additionalData["paypal.userAction"] = "PAY_NOW";

                paymentRequest.lineItems = [
                    {
                        description: "Digital Service - No Shipping Required",
                        amountIncludingTax: 100,
                        amountExcludingTax: 100,
                        taxAmount: 0,
                        id: "digital_service_1",
                        quantity: 1,
                        taxCategory: "None"
                    }
                ];
            } else {
                console.log('Configuring PayPal/Venmo with shipping enabled');
                // Allow shipping address to be collected
                paymentRequest.lineItems = [
                    {
                        description: "Digital Service",
                        amountIncludingTax: 100,
                        amountExcludingTax: 100,
                        taxAmount: 0,
                        id: "item_1",
                        quantity: 1
                    }
                ];
            }
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
