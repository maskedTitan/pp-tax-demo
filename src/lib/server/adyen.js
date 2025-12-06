// Hardcoded credentials for demo purposes
const ADYEN_API_KEY = 'AQE7hmfxLYrJbBNCw0m/n3Q5qf3VYIpfHptLdWRE1HGFvVV+t8lyBdV1FD5kHVmBNfLre52enhFL24tNbX4QwV1bDb7kfNy1WIxIIkxgBw==-xWeNX+7m3nms0+J8QmU3UvvYkEAC/Oj95fo7Z8D613k=-i1i%n<_q7f.9YNg_5sN'.trim();
const ADYEN_MERCHANT_ACCOUNT = 'HarshaMarriNCSUIndustriesECOM'.trim();

const ADYEN_API_URL = 'https://checkout-test.adyen.com/v71';

/**
 * Make a request to the Adyen API
 * @param {string} endpoint - API endpoint (e.g., '/payments')
 * @param {object} data - Request body
 */
export async function adyenRequest(endpoint, data, includeMerchantAccount = true) {
    if (!ADYEN_API_KEY || !ADYEN_MERCHANT_ACCOUNT) {
        throw new Error('Adyen configuration missing. Set ADYEN_API_KEY and ADYEN_MERCHANT_ACCOUNT.');
    }

    // console.log(`Adyen Request to ${endpoint} with Merchant Account: ${ADYEN_MERCHANT_ACCOUNT}`);

    const body = { ...data };
    if (includeMerchantAccount) {
        body.merchantAccount = ADYEN_MERCHANT_ACCOUNT;
    }

    const response = await fetch(`${ADYEN_API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ADYEN_API_KEY
        },
        body: JSON.stringify(body)
    });

    const responseData = await response.json();

    if (!response.ok) {
        console.error('Adyen API Response Error:', response.status, responseData);
        throw new Error(`Adyen API Error: ${response.status} ${responseData.message || response.statusText}`);
    }

    return responseData;
}
