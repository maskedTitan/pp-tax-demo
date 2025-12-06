import { json } from '@sveltejs/kit';
import { getPayPalOrder } from '$lib/paypal.js';

/**
 * GET /api/paypal/order/[orderId]
 * Fetches PayPal order details
 */
export async function GET({ params }) {
    try {
        const { orderId } = params;

        if (!orderId) {
            return json({ error: 'Order ID is required' }, { status: 400 });
        }

        const order = await getPayPalOrder(orderId);

        return json(order);
    } catch (error) {
        console.error('Error fetching PayPal order:', error);
        return json(
            {
                error: error.message || 'Failed to fetch order'
            },
            { status: 500 }
        );
    }
}
