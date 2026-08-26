import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const CHARGE_PAYMENT_METHOD_MUTATION = `
mutation ChargePaymentMethod($input: ChargePaymentMethodInput!) {
  chargePaymentMethod(input: $input) {
    transaction {
      id
      legacyId
      status
      amount {
        value
        currencyCode
      }
      merchantAccountId
    }
  }
}`;

/**
 * POST /api/billing-agreements/charge-token
 * Charges a vaulted payment method via Braintree GraphQL (merchant-initiated transaction)
 */
export async function POST({ request }) {
    try {
        const { paymentMethodId, amount, merchantAccountId, isProduction } = await request.json();

        if (!paymentMethodId || !amount) {
            return json(
                { error: 'Missing required fields: paymentMethodId, amount' },
                { status: 400 }
            );
        }

        const publicKey = isProduction ? env.BRAINTREE_PROD_PUBLIC_KEY : env.BRAINTREE_PUBLIC_KEY;
        const privateKey = isProduction ? env.BRAINTREE_PROD_PRIVATE_KEY : env.BRAINTREE_PRIVATE_KEY;

        if (!publicKey || !privateKey) {
            return json({ error: 'Braintree credentials not configured for this environment' }, { status: 500 });
        }

        const graphqlUrl = isProduction
            ? 'https://payments.braintree-api.com/graphql'
            : 'https://payments.sandbox.braintree-api.com/graphql';

        const credentials = Buffer.from(`${publicKey}:${privateKey}`).toString('base64');
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${credentials}`,
            'Braintree-Version': '2024-08-01'
        };

        const transaction = {
            amount: amount
        };

        if (merchantAccountId) {
            transaction.merchantAccountId = merchantAccountId;
        }

        const input = {
            paymentMethodId,
            transaction
        };

        const response = await fetch(graphqlUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                query: CHARGE_PAYMENT_METHOD_MUTATION,
                variables: { input }
            })
        });

        const data = await response.json();

        if (data.errors && data.errors.length > 0) {
            const errorMessage = data.errors.map(e => e.message).join('; ');
            return json(
                { error: errorMessage, details: data.errors, mutation: { request: input, response: data } },
                { status: 400 }
            );
        }

        const tx = data.data?.chargePaymentMethod?.transaction;

        if (!tx) {
            return json(
                { error: 'No transaction returned from Braintree', mutation: { request: input, response: data } },
                { status: 400 }
            );
        }

        return json({
            success: true,
            transactionId: tx.legacyId,
            graphqlId: tx.id,
            status: tx.status,
            amount: tx.amount?.value,
            currency: tx.amount?.currencyCode,
            merchantAccountId: tx.merchantAccountId || null,
            mutation: { request: input, response: data }
        });
    } catch (error) {
        console.error('Charge token error:', error);
        return json(
            { error: error.message || 'Failed to charge token' },
            { status: 500 }
        );
    }
}
