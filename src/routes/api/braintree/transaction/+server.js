import { json } from '@sveltejs/kit';
import { braintreeGraphql } from '$lib/server/braintree.js';

const TRANSACTION_QUERY = `
query SearchTransaction($input: TransactionSearchInput!) {
  search {
    transactions(input: $input) {
      edges {
        node {
          id
          legacyId
          status
          createdAt
          amount {
            value
            currencyCode
          }
          orderId
          statusHistory {
            status
            terminal
          }
          paymentMethodSnapshot {
            ... on PayPalTransactionDetails {
              payer {
                payerId
                email
              }
            }
          }
        }
      }
    }
  }
}`;

export async function GET({ url }) {
    try {
        const transactionId = url.searchParams.get('id');
        if (!transactionId) {
            return json({ success: false, error: 'Missing transaction id' }, { status: 400 });
        }

        const input = { id: { is: transactionId } };
        const data = await braintreeGraphql(TRANSACTION_QUERY, { input });

        if (data.errors?.length) {
            const errorMessage = data.errors.map(e => e.message).join('; ');
            return json({ success: false, error: errorMessage, query: { input }, graphql: data }, { status: 400 });
        }

        const edges = data.data?.search?.transactions?.edges || [];
        const transaction = edges[0]?.node || null;

        return json({
            success: true,
            transaction,
            query: { input },
            graphql: data,
        });
    } catch (error) {
        console.error('Transaction lookup error:', error);
        return json({ success: false, error: 'Failed to look up transaction' }, { status: 500 });
    }
}
