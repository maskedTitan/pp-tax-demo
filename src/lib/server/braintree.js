import braintree from 'braintree';
import { env } from '$env/dynamic/private';

export const gateway = new braintree.BraintreeGateway({
    environment: braintree.Environment.Sandbox,
    merchantId: env.BRAINTREE_MERCHANT_ID || 'b6bnqwx858gzdsdc',
    publicKey: env.BRAINTREE_PUBLIC_KEY || '7mhg2kbhfkxqrhdb',
    privateKey: env.BRAINTREE_PRIVATE_KEY || '843cf1b5cfc9f6592a30c882795fa18a'
});
