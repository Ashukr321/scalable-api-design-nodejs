import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import soap from 'soap';
import app from '../src/app.js';
import { Account } from '../src/models/account.model.js';
import { toMinor } from '../src/bank.service.js';

// Needs a running MongoDB. Uses its own database and drops it afterwards.
const MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/soap_api_test';

let server;
let client;

const faultOf = (err) => err.root?.Envelope?.Body?.Fault;

before(async () => {
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.dropDatabase();
  await Account.syncIndexes();
  server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/soap/bank`;
  client = await soap.createClientAsync(`${base}?wsdl`, { endpoint: base });
});

after(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('toMinor converts decimals exactly and rejects bad amounts', () => {
  assert.equal(toMinor('0.1'), 10);
  assert.equal(toMinor('1500.75'), 150075);
  assert.equal(toMinor(20), 2000);
  for (const bad of ['0', '-5', '1.234', 'abc', '', '1e3', '100000000.01']) {
    assert.throws(() => toMinor(bad), (e) => e.Fault.detail.BankFault.code === 'INVALID_AMOUNT', bad);
  }
});

test('GET ?wsdl returns the contract', async () => {
  const res = await request(app).get('/soap/bank?wsdl').expect(200);
  assert.match(res.headers['content-type'], /xml/);
  assert.match(res.text, /<service name="BankService">/);
});

test('full flow through a WSDL-generated client: create, deposit, withdraw, get', async () => {
  const [created] = await client.CreateAccountAsync({ ownerName: 'Asha Verma' });
  const { accountNumber } = created.account;
  assert.match(accountNumber, /^\d{10}$/);
  assert.equal(created.account.currency, 'INR');
  assert.equal(Number(created.account.balance), 0);

  await client.DepositAsync({ accountNumber, amount: '0.10' });
  await client.DepositAsync({ accountNumber, amount: '0.20' });
  const [w] = await client.WithdrawAsync({ accountNumber, amount: '0.05' });
  assert.equal(Number(w.account.balance), 0.25); // no floating-point drift

  const [got] = await client.GetAccountAsync({ accountNumber });
  assert.equal(got.account.ownerName, 'Asha Verma');
});

test('withdraw more than balance -> soap:Client fault INSUFFICIENT_FUNDS, HTTP 500', async () => {
  const [{ account }] = await client.CreateAccountAsync({ ownerName: 'Ravi' });
  await assert.rejects(client.WithdrawAsync({ accountNumber: account.accountNumber, amount: '1' }), (err) => {
    assert.equal(err.response.status, 500);
    const f = faultOf(err);
    assert.equal(f.faultcode, 'soap:Client');
    assert.equal(f.detail.BankFault.code, 'INSUFFICIENT_FUNDS');
    return true;
  });
});

test('parallel withdrawals never overdraw (atomic check-and-debit)', async () => {
  const [{ account }] = await client.CreateAccountAsync({ ownerName: 'Meera' });
  const { accountNumber } = account;
  await client.DepositAsync({ accountNumber, amount: '100' });

  const results = await Promise.allSettled(Array.from({ length: 5 }, () => client.WithdrawAsync({ accountNumber, amount: '30' })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);

  const [got] = await client.GetAccountAsync({ accountNumber });
  assert.equal(Number(got.account.balance), 10);
});

test('unknown account -> ACCOUNT_NOT_FOUND; bad input -> validation faults', async () => {
  const cases = [
    [() => client.GetAccountAsync({ accountNumber: '0000000000' }), 'ACCOUNT_NOT_FOUND'],
    [() => client.DepositAsync({ accountNumber: '0000000000', amount: '5' }), 'ACCOUNT_NOT_FOUND'],
    [() => client.GetAccountAsync({ accountNumber: '12' }), 'INVALID_ACCOUNT_NUMBER'],
    [() => client.CreateAccountAsync({ ownerName: 'Bob', currency: 'BTC' }), 'INVALID_CURRENCY'],
    [() => client.CreateAccountAsync({ ownerName: 'X' }), 'VALIDATION_FAILED'],
  ];
  for (const [call, code] of cases) {
    await assert.rejects(call(), (err) => faultOf(err)?.detail?.BankFault?.code === code, code);
  }
});

test('raw XML envelope over plain HTTP works (what any non-Node client sends)', async () => {
  const [{ account }] = await client.CreateAccountAsync({ ownerName: 'Kiran' });
  const envelope = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bank="http://example.com/bank">
  <soap:Body>
    <bank:GetAccountRequest><bank:accountNumber>${account.accountNumber}</bank:accountNumber></bank:GetAccountRequest>
  </soap:Body>
</soap:Envelope>`;
  const res = await request(app)
    .post('/soap/bank')
    .set('Content-Type', 'text/xml; charset=utf-8')
    .set('SOAPAction', '"http://example.com/bank/GetAccount"')
    .send(envelope)
    .expect(200);
  assert.match(res.text, /<soap:Envelope/);
  assert.match(res.text, /Kiran/);
});

test('malformed XML -> 500 without a stack trace', async () => {
  const res = await request(app).post('/soap/bank').set('Content-Type', 'text/xml').send('<soap:Envelope><oops').expect(500);
  assert.doesNotMatch(res.text, /\bat .*\.js:\d+/);
});

test('body over 100kb -> 413', async () => {
  await request(app).post('/soap/bank').set('Content-Type', 'text/xml').send('x'.repeat(101 * 1024)).expect(413);
});
