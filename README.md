# PayPal Payment Integration Demo

A SvelteKit application demonstrating PayPal payment integration with support for:
- One-time payments
- Recurring payments (vaulting)
- Guest checkout (pay with card)
- Tax calculation by state
- Address management

## Getting Started

### Prerequisites

- Node.js 18+
- PayPal Sandbox Account (for testing)

### Installation

```sh
npm install
```

### Environment Variables

Create a `.env` file with your PayPal credentials:

```env
VITE_PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_secret
PAYPAL_SANDBOX_EMAIL=your_sandbox_buyer_email
```

### Development

Start the development server:

```sh
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Testing with Playwright

This project uses [Playwright](https://playwright.dev/) for end-to-end testing.

### Install Playwright

```sh
npx playwright install
```

### Test Files

| File | Purpose |
|------|---------|
| `paypal-e2e.spec.js` | Core E2E tests: API, UI, payment flows |
| `edge-cases-e2e.spec.js` | Error handling & edge cases |
| `security-audit.spec.js` | Security vulnerability tests |
| `new-account-flow.spec.js` | Guest checkout (pay with card) |

### Running Tests

```sh
# Run ALL tests (headless)
npx playwright test

# Run ALL tests with browser visible
npx playwright test --headed

# Run specific test file
npx playwright test tests/paypal-e2e.spec.js --headed

# Run tests matching pattern
npx playwright test --grep "API"

# Run with single worker (sequential)
npx playwright test --workers=1

# Show HTML test report
npx playwright show-report
```

### Test Commands Quick Reference

```sh
# Full E2E suite (recommended for CI)
npx playwright test

# Interactive testing (see browser)
npx playwright test --headed --workers=1

# Debug mode
npx playwright test --debug

# Specific test by name
npx playwright test --grep "Standard one-time payment"

# API tests only
npx playwright test --grep "Backend API"

# Payment flow tests only
npx playwright test --grep "Payment Flow"
```

### Sandbox Credentials

For full E2E testing, set the sandbox email in your environment:

```sh
export PAYPAL_SANDBOX_EMAIL=your_buyer_email@sandbox.com
```

The test OTP code for sandbox is always: `111111`

### Test Results

Test results are saved to:
- `playwright-report/` - HTML report
- `test-results/` - Screenshots and videos of failed tests

View the report:
```sh
npx playwright show-report
```

---

## Building for Production

```sh
npm run build
npm run preview
```

---

## Project Structure

```
├── src/
│   ├── routes/
│   │   ├── +page.svelte          # Main checkout page
│   │   ├── api/paypal/           # PayPal API endpoints
│   │   │   ├── create-order/
│   │   │   ├── capture-order/
│   │   │   ├── create-setup-token/
│   │   │   └── create-payment-token/
│   │   └── prod/                 # Production page
│   └── lib/                      # Shared utilities
├── tests/                        # Playwright E2E tests
├── playwright.config.js
└── package.json
```

---

## License

MIT
