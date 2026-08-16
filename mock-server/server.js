// Kapture Finance — Mock Collections Webhook Server
// Implements the tool endpoints referenced in vapi/tool_definitions.json
// Run: node server.js   (then `ngrok http 3000` to expose it to Vapi)

const express = require('express');
const app = express();
app.use(express.json());

// --- In-memory "database" for the demo account -----------------------------
const ACCOUNTS = {
  'ACC-88392': {
    account_id: 'ACC-88392',
    customer_name: 'Rahul Sharma',
    pan_last4: '1234',
    dob_year: '1995',
    loan_type: 'Personal Loan',
    overdue_amount: 8499,
    dpd: 12,
    phone: '+91XXXXXXXXXX'
  }
};

const CALL_LOG = []; // simple in-memory disposition/ptp log for the demo

function maskName(name) {
  // e.g. "Rahul Sharma" -> "Rahul S****"
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(' ')} ${last[0]}${'*'.repeat(Math.max(last.length - 1, 3))}`;
}

app.post('/webhook', (req, res) => {
  const { message } = req.body || {};

  if (!message || message.type !== 'tool-calls') {
    // Other Vapi lifecycle events (status-update, end-of-call-report, etc.)
    console.log('[event]', message && message.type);
    return res.status(200).json({ status: 'acknowledged' });
  }

  const results = message.toolCalls.map((toolCall) => {
    const { name, arguments: args } = toolCall.function;
    const callId = toolCall.id;
    let result = {};

    console.log(`[tool-call] ${name}`, JSON.stringify(args));

    switch (name) {
      case 'verify_customer': {
        const account = ACCOUNTS[args.account_id];
        if (!account) {
          result = { verified: false, message: 'Unknown account.' };
          break;
        }
        const expected =
          args.verification_type === 'DOB_YEAR' ? account.dob_year : account.pan_last4;
        const verified = args.verification_code === expected;
        result = verified
          ? { verified: true, customer_name: maskName(account.customer_name) }
          : { verified: false, message: 'Verification failed. Code does not match records.' };
        break;
      }

      case 'get_account_details': {
        const account = ACCOUNTS[args.account_id];
        if (!account) {
          result = { success: false, message: 'Unknown account.' };
          break;
        }
        result = {
          success: true,
          overdue_amount: account.overdue_amount,
          dpd: account.dpd,
          loan_type: account.loan_type
        };
        break;
      }

      case 'log_promise_to_pay': {
        const entry = {
          type: 'PTP',
          account_id: args.account_id,
          ptp_date: args.ptp_date,
          amount: args.amount,
          partial_payment: !!args.partial_payment,
          logged_at: new Date().toISOString()
        };
        CALL_LOG.push(entry);
        result = {
          success: true,
          ptp_id: `PTP-${Math.floor(1000 + Math.random() * 9000)}`,
          confirmed_date: args.ptp_date,
          amount: args.amount
        };
        break;
      }

      case 'send_payment_link': {
        result = {
          success: true,
          message: `Mock payment link sent via ${args.channel} to registered number.`
        };
        break;
      }

      case 'escalate_to_agent': {
        const entry = {
          type: 'ESCALATION',
          account_id: args.account_id,
          reason: args.reason,
          notes: args.notes || '',
          logged_at: new Date().toISOString()
        };
        CALL_LOG.push(entry);
        result = { success: true, escalation_id: `ESC-${Math.floor(1000 + Math.random() * 9000)}` };
        break;
      }

      case 'mark_disposition': {
        const entry = {
          type: 'DISPOSITION',
          account_id: args.account_id,
          status: args.status,
          notes: args.notes || '',
          logged_at: new Date().toISOString()
        };
        CALL_LOG.push(entry);
        result = { success: true, disposition_logged: args.status, timestamp: entry.logged_at };
        break;
      }

      default:
        result = { success: false, message: `Unknown function: ${name}` };
    }

    return { toolCallId: callId, result: JSON.stringify(result) };
  });

  return res.status(200).json({ results });
});

// Simple endpoint to eyeball what's been logged during testing
app.get('/log', (req, res) => res.json(CALL_LOG));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kapture mock collections webhook server running on port ${PORT}`);
});
