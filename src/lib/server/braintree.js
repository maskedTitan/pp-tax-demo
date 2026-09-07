import braintree from 'braintree';
import { env } from '$env/dynamic/private';

export const gateway = new braintree.BraintreeGateway({
    environment: braintree.Environment.Sandbox,
    merchantId: env.BRAINTREE_MERCHANT_ID,
    publicKey: env.BRAINTREE_PUBLIC_KEY,
    privateKey: env.BRAINTREE_PRIVATE_KEY
});

const GRAPHQL_URL = 'https://payments.sandbox.braintree-api.com/graphql';

/**
 * Execute a Braintree GraphQL mutation/query.
 * Returns the parsed JSON response body.
 */
export async function braintreeGraphql(query, variables = {}) {
    const credentials = Buffer.from(
        `${env.BRAINTREE_PUBLIC_KEY}:${env.BRAINTREE_PRIVATE_KEY}`
    ).toString('base64');

    const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${credentials}`,
            'Braintree-Version': '2024-08-01',
        },
        body: JSON.stringify({ query, variables }),
    });

    return response.json();
}
