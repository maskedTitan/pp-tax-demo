
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

        console.log("Adyen Update Order - Received Address:", JSON.stringify(shippingAddress));

        if (!paymentData || !pspReference) {
            return json({ error: 'Missing paymentData or pspReference' }, { status: 400 });
        }

        // In a real app, calculate new amount/tax based on shippingAddress here.
        // For this demo, we keep the amount same but we MUST call updateOrder 
        // to get a fresh paymentData signature from Adyen.

        // Calculate Tax logic (replicating direct PayPal/Stripe logic)
        // Hardcoded subtotal for demo purposes - matches the create-payment base of $1.00
        const subtotal = 1.00;

        // Flexible state extraction
        const stateCode = shippingAddress?.stateOrProvince || shippingAddress?.state || shippingAddress?.admin_area_1 || 'CA';

        console.log(`Calculating tax for state: ${stateCode} (Derived from ${JSON.stringify(shippingAddress)})`);

        // Use our shared tax library
        const taxAmountStr = calculateTax(subtotal, stateCode); // e.g. "0.90"

        // Calculate Total with Tax
        const taxVal = parseFloat(taxAmountStr);
        const totalVal = subtotal + taxVal;

        // Convert to minor units for Adyen (cents)
        const totalValue = Math.round(totalVal * 100);

        const updateRequest = {
            paymentData,
            pspReference,
            amount: {
                currency: "USD",
                value: totalValue
            }
            // taxAmount removed to fix "Cannot ship to this address" error (some providers reject unknown fields)
        };

        console.log("Sending Adyen Update Request:", JSON.stringify(updateRequest));
        const response = await adyenRequest('/paypal/updateOrder', updateRequest, false);
        console.log("Adyen Update Response:", JSON.stringify(response));

        return json(response);
    } catch (error) {
        console.error('Adyen Update Order Error:', error);
        return json(
            { error: error.message || 'Failed to update order' },
            { status: 500 }
        );
    }
}
