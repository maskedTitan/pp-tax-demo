
import { json } from '@sveltejs/kit';
import { adyenRequest } from '$lib/server/adyen.js';
import { calculateTax, calculateTotal } from '$lib/taxRates.js';

/**
 * POST /api/adyen/payments/update-order
 * Updates the PayPal order when the user changes shipping details.
 * This is required by Adyen to accept address changes and update amounts/tax.
 */
export async function POST({ request }) {
    try {
        const { paymentData, pspReference, shippingAddress } = await request.json();

        if (!paymentData || !pspReference) {
            return json({ error: 'Missing paymentData or pspReference' }, { status: 400 });
        }

        // In a real app, calculate new amount/tax based on shippingAddress here.
        // For this demo, we keep the amount same but we MUST call updateOrder 
        // to get a fresh paymentData signature from Adyen.

        // Calculate Tax logic (replicating direct PayPal/Stripe logic)
        // Hardcoded subtotal for demo purposes
        const subtotal = 10.00;
        const stateCode = shippingAddress?.stateOrProvince || shippingAddress?.state;

        // Use our shared tax library
        const taxAmountStr = calculateTax(subtotal, stateCode); // e.g. "0.90"
        const totalAmountStr = calculateTotal(subtotal, stateCode); // e.g. "10.90"

        // Convert to minor units for Adyen (cents)
        const totalValue = Math.round(parseFloat(totalAmountStr) * 100);
        const taxValue = Math.round(parseFloat(taxAmountStr) * 100);

        const updateRequest = {
            paymentData,
            pspReference,
            amount: {
                currency: "USD",
                value: totalValue
            },
            // Optional: Pass tax details if Adyen/PayPal supports it in this flow
            // taxAmount: {
            //    currency: "USD",
            //    value: taxValue
            // }
        };

        const response = await adyenRequest('/paypal/updateOrder', updateRequest, false);

        return json(response);
    } catch (error) {
        console.error('Adyen Update Order Error:', error);
        return json(
            { error: error.message || 'Failed to update order' },
            { status: 500 }
        );
    }
}
