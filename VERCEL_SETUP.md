# Vercel Environment Variables Setup

This guide will help you configure both sandbox and production PayPal credentials in Vercel.

## Overview

The application now supports both sandbox and production environments:
- **Sandbox** (default): `https://yourdomain.com/`
- **Production**: `https://yourdomain.com/prod`

## Environment Variables Required

You need to set up **8 environment variables** in Vercel:

### Adyen Variables (3)
```
ADYEN_API_KEY=<your_adyen_api_key>
ADYEN_MERCHANT_ACCOUNT=<your_merchant_account>
VITE_ADYEN_CLIENT_KEY=<your_adyen_client_key>
```

### PayPal Sandbox Variables (2)
```
PUBLIC_PAYPAL_CLIENT_ID=<your_sandbox_client_id>
PAYPAL_CLIENT_SECRET=<your_sandbox_secret>
```

### PayPal Production Variables (2)
```
PUBLIC_PAYPAL_PROD_CLIENT_ID=<your_production_client_id>
PAYPAL_PROD_CLIENT_SECRET=<your_production_secret>
```

## Step-by-Step Vercel Configuration

### 1. Access Your Vercel Project Settings

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Click on **Settings** tab
4. Navigate to **Environment Variables** section

### 2. Get Your PayPal Credentials

#### For Sandbox Credentials:
1. Go to [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/)
2. Navigate to **Apps & Credentials**
3. Make sure you're on the **Sandbox** tab
4. Select your sandbox app (or create one if you don't have one)
5. Copy the **Client ID** and **Secret**

#### For Production Credentials:
1. In the same PayPal Developer Dashboard
2. Switch to the **Live** tab
3. Select your production app (or create one)
4. Copy the **Client ID** and **Secret**

### 3. Add Environment Variables to Vercel

For each variable, click **Add New** and enter:

#### Adyen Variables
| Key | Value | Environment |
|-----|-------|-------------|
| `ADYEN_API_KEY` | Your Adyen API Key | Production, Preview, Development |
| `ADYEN_MERCHANT_ACCOUNT` | Your Merchant Account | Production, Preview, Development |
| `VITE_ADYEN_CLIENT_KEY` | Your Adyen Client Key | Production, Preview, Development |

#### PayPal Sandbox Variables
| Key | Value | Environment |
|-----|-------|-------------|
| `PUBLIC_PAYPAL_CLIENT_ID` | Your Sandbox Client ID (starts with `AT...`) | Production, Preview, Development |
| `PAYPAL_CLIENT_SECRET` | Your Sandbox Secret | Production, Preview, Development |

#### PayPal Production Variables
| Key | Value | Environment |
|-----|-------|-------------|
| `PUBLIC_PAYPAL_PROD_CLIENT_ID` | Your Production Client ID (starts with `AR...` or `AY...`) | Production, Preview, Development |
| `PAYPAL_PROD_CLIENT_SECRET` | Your Production Secret | Production, Preview, Development |

### 4. Important Notes

- ✅ Make sure the **Client ID** and **Secret** are from the **SAME PayPal app**
- ✅ Production credentials start with different prefixes than sandbox
- ✅ All `PUBLIC_*` variables are exposed to the client-side
- ✅ Variables without `PUBLIC_` prefix are server-side only
- ⚠️ Never commit real credentials to git

### 5. Apply Changes

After adding all variables:
1. Click **Save**
2. Redeploy your application for changes to take effect

You can trigger a redeploy by:
- Going to **Deployments** tab
- Clicking the **...** menu on the latest deployment
- Selecting **Redeploy**

## Verification

### Test Sandbox Environment
1. Visit `https://yourdomain.com/`
2. You should see "Sandbox Environment - Test Mode" in the footer
3. Click the PayPal button
4. You'll be redirected to PayPal sandbox checkout

### Test Production Environment
1. Visit `https://yourdomain.com/prod`
2. You should see "🔴 PRODUCTION Environment - LIVE MODE" in the footer (red warning)
3. Click the PayPal button
4. You'll be redirected to **real PayPal checkout** (⚠️ this will process real payments!)

## Troubleshooting

### Error: "Client Authentication failed"

**Cause**: Client ID and Secret don't match

**Solution**:
1. Verify both credentials are from the same PayPal app
2. Check you're using the correct environment (sandbox vs production)
3. Make sure there are no extra spaces in the values
4. Redeploy after updating

### Error: "Failed to get access token"

**Cause**: Invalid credentials or network issue

**Solution**:
1. Double-check credentials in Vercel dashboard
2. Ensure credentials are from the correct environment
3. Check PayPal Developer Dashboard for any app restrictions
4. Verify your PayPal app is active

### PayPal button doesn't load

**Cause**: Missing `PUBLIC_PAYPAL_CLIENT_ID` or `PUBLIC_PAYPAL_PROD_CLIENT_ID`

**Solution**:
1. Check the browser console for errors
2. Verify the `PUBLIC_*` variables are set in Vercel
3. Make sure variable names are **exactly** as specified
4. Redeploy after adding missing variables

## Security Best Practices

1. **Never** share your production credentials publicly
2. **Restrict** access to `/prod` route using middleware or authentication
3. **Monitor** production transactions regularly
4. **Use** different credentials for development/staging/production
5. **Rotate** credentials periodically for security

## Next Steps

After setup is complete:
- Test both sandbox and production flows
- Set up authentication for the `/prod` route (recommended)
- Monitor transactions in PayPal dashboard
- Configure webhooks for payment notifications (optional)

## Support

If you encounter issues:
1. Check Vercel deployment logs
2. Verify all environment variables are set correctly
3. Test credentials in PayPal Postman collection
4. Contact PayPal Developer Support if issues persist
