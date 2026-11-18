import { randomInt } from 'node:crypto';
import { Account, CURRENCIES } from './models/account.model.js';

const MAX_AMOUNT_MINOR = 100_000_000_00; // 10 crore per call

// node-soap turns a thrown { Fault } into a SOAP 1.1 <soap:Fault> with HTTP 500.
// faultcode soap:Client = caller's fault (do not retry), soap:Server = ours (may retry).
export function fault(code, message, faultcode = 'soap:Client') {
  return { Fault: { faultcode, faultstring: message, detail: { BankFault: { code, message } }, statusCode: 500 } };
}

function accountNumberOf(args) {
  const n = String(args?.accountNumber ?? '');
  if (!/^\d{10}$/.test(n)) throw fault('INVALID_ACCOUNT_NUMBER', 'accountNumber must be 10 digits');
  return n;
}

// "12.50" -> 1250. Rejects <= 0, more than 2 decimals, and absurd amounts.
export function toMinor(amount) {
  const s = String(amount ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw fault('INVALID_AMOUNT', 'amount must be a positive number with at most 2 decimals');
  const [whole, frac = ''] = s.split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (minor <= 0 || minor > MAX_AMOUNT_MINOR) throw fault('INVALID_AMOUNT', 'amount must be between 0.01 and 100000000');
  return minor;
}

const toSoap = (a) => ({
  account: {
    accountNumber: a.accountNumber,
    ownerName: a.ownerName,
    currency: a.currency,
    balance: (a.balanceMinor / 100).toFixed(2),
    createdAt: a.createdAt.toISOString(),
  },
});

async function findOrFault(accountNumber) {
  const account = await Account.findOne({ accountNumber });
  if (!account) throw fault('ACCOUNT_NOT_FOUND', `Account ${accountNumber} does not exist`);
  return account;
}

// Unknown errors become a generic soap:Server fault; the real error is only logged.
const safe = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (err) {
    if (err?.Fault) throw err;
    if (err?.name === 'ValidationError') {
      throw fault('VALIDATION_FAILED', Object.values(err.errors).map((e) => e.message).join('; '));
    }
    console.error(err);
    throw fault('INTERNAL_ERROR', 'Internal server error', 'soap:Server');
  }
};

const operations = {
  async CreateAccount({ ownerName, currency = 'INR' } = {}) {
    if (!CURRENCIES.includes(currency)) throw fault('INVALID_CURRENCY', `currency must be one of ${CURRENCIES.join(', ')}`);
    // shortcut: random 10-digit number, retried on the rare collision; use a sequence/IBAN generator for real banks.
    for (let attempt = 0; ; attempt++) {
      try {
        const account = await Account.create({ accountNumber: String(randomInt(1e9, 1e10)), ownerName: String(ownerName ?? ''), currency });
        return toSoap(account);
      } catch (err) {
        if (err?.code !== 11000 || attempt >= 2) throw err;
      }
    }
  },

  async GetAccount(args) {
    return toSoap(await findOrFault(accountNumberOf(args)));
  },

  async Deposit(args) {
    const accountNumber = accountNumberOf(args);
    const minor = toMinor(args.amount);
    const account = await Account.findOneAndUpdate({ accountNumber }, { $inc: { balanceMinor: minor } }, { returnDocument: 'after' });
    if (!account) throw fault('ACCOUNT_NOT_FOUND', `Account ${accountNumber} does not exist`);
    return toSoap(account);
  },

  async Withdraw(args) {
    const accountNumber = accountNumberOf(args);
    const minor = toMinor(args.amount);
    // Check and debit in ONE atomic update, so two parallel withdrawals can never overdraw.
    const account = await Account.findOneAndUpdate(
      { accountNumber, balanceMinor: { $gte: minor } },
      { $inc: { balanceMinor: -minor } },
      { returnDocument: 'after' },
    );
    if (account) return toSoap(account);
    await findOrFault(accountNumber); // throws ACCOUNT_NOT_FOUND if missing
    throw fault('INSUFFICIENT_FUNDS', 'Balance is lower than the amount requested');
  },
};

// Shape node-soap expects: { ServiceName: { PortName: { Operation: fn } } }, matching the WSDL.
export const bankService = {
  BankService: {
    BankPort: Object.fromEntries(Object.entries(operations).map(([name, fn]) => [name, safe(fn)])),
  },
};
