# SOAP API: Bank Accounts Service (Node.js + Express + MongoDB)

A small SOAP 1.1 web service for **bank accounts**: the kind of contract-first, XML API that banks, payment gateways and legacy enterprise systems still use. It puts the ideas from [key-terminologies.md](key-terminologies.md) into working code.

**Stack:** Node.js 22+, Express 5, MongoDB + Mongoose, [`soap`](https://www.npmjs.com/package/soap) (node-soap), helmet. Tests use `node:test` + supertest + a WSDL-generated client.

## Run it

```bash
cd soap
npm install
cp .env.example .env     # set MONGO_URI if MongoDB is not on localhost:27017
npm run dev              # http://localhost:3000/soap/bank
npm run client           # in a 2nd terminal: demo client that reads the WSDL and calls every operation
npm test                 # needs MongoDB running; uses the soap_api_test database
```

Open [requests.http](requests.http) in VS Code (REST Client extension) to send raw XML envelopes, or import `http://localhost:3000/soap/bank?wsdl` into SoapUI / Postman.

## Endpoint

SOAP uses **one URL** for everything. The operation is named by the Body element (and the `SOAPAction` header), not by the URL or HTTP method.

| Method | URL | What it does |
|--------|-----|--------------|
| `GET` | `/soap/bank?wsdl` | Returns the WSDL contract ([src/bank.wsdl](src/bank.wsdl)) |
| `POST` | `/soap/bank` | Takes a SOAP Envelope, returns a SOAP Envelope |
| `GET` | `/health` | Liveness + DB status (JSON) |

## Operations

| Operation | Request element | Input | Returns |
|-----------|-----------------|-------|---------|
| `CreateAccount` | `CreateAccountRequest` | `ownerName`, `currency?` (`INR` default, `USD`, `EUR`) | `AccountResponse` |
| `GetAccount` | `GetAccountRequest` | `accountNumber` | `AccountResponse` |
| `Deposit` | `DepositRequest` | `accountNumber`, `amount` | `AccountResponse` |
| `Withdraw` | `WithdrawRequest` | `accountNumber`, `amount` | `AccountResponse` |

`accountNumber` is 10 digits. `amount` is a positive decimal with at most 2 places, up to 100000000.

### Request

```xml
POST /soap/bank HTTP/1.1
Content-Type: text/xml; charset=utf-8
SOAPAction: "http://example.com/bank/Deposit"

<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bank="http://example.com/bank">
  <soap:Body>
    <bank:DepositRequest>
      <bank:accountNumber>1542578099</bank:accountNumber>
      <bank:amount>1500.75</bank:amount>
    </bank:DepositRequest>
  </soap:Body>
</soap:Envelope>
```

### Response (`200 OK`)

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://example.com/bank">
  <soap:Body>
    <AccountResponse xmlns="http://example.com/bank">
      <account>
        <accountNumber>1542578099</accountNumber>
        <ownerName>Asha Verma</ownerName>
        <currency>INR</currency>
        <balance>1500.75</balance>
        <createdAt>2026-11-18T14:05:49.655Z</createdAt>
      </account>
    </AccountResponse>
  </soap:Body>
</soap:Envelope>
```

### Errors: `soap:Fault` (HTTP `500`, as SOAP 1.1 requires)

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Client</faultcode>
      <faultstring>Balance is lower than the amount requested</faultstring>
      <detail>
        <BankFault>
          <code>INSUFFICIENT_FUNDS</code>
          <message>Balance is lower than the amount requested</message>
        </BankFault>
      </detail>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>
```

| `faultcode` | `BankFault.code` | When |
|-------------|------------------|------|
| `soap:Client` | `INVALID_ACCOUNT_NUMBER` | `accountNumber` is not 10 digits |
| `soap:Client` | `INVALID_AMOUNT` | Amount ≤ 0, more than 2 decimals, too large, not a number |
| `soap:Client` | `INVALID_CURRENCY` | Currency not `INR` / `USD` / `EUR` |
| `soap:Client` | `VALIDATION_FAILED` | Schema validation (e.g. `ownerName` too short) |
| `soap:Client` | `ACCOUNT_NOT_FOUND` | No such account |
| `soap:Client` | `INSUFFICIENT_FUNDS` | Withdraw more than the balance |
| `soap:Server` | `INTERNAL_ERROR` | Unexpected error (logged, never sent to the client) |

`soap:Client` = fix the request, do not retry. `soap:Server` = our problem, safe to retry later.

## Calling it from Node

```js
import soap from 'soap';

const client = await soap.createClientAsync('http://localhost:3000/soap/bank?wsdl');
const [{ account }] = await client.CreateAccountAsync({ ownerName: 'Asha Verma' });
await client.DepositAsync({ accountNumber: account.accountNumber, amount: '1500.75' });
```

The client builds its methods from the WSDL. See [src/client.js](src/client.js) for the full demo, including fault handling.

## Project structure

```
soap/
├── src/
│   ├── bank.wsdl               # The contract: types, messages, portType, binding, service
│   ├── bank.service.js         # Operation handlers + fault mapping
│   ├── models/account.model.js # Mongoose schema (money in integer minor units)
│   ├── app.js                  # Express app, mounts the SOAP endpoint
│   ├── server.js               # DB connect, listen, graceful shutdown
│   └── client.js               # Demo WSDL client
├── tests/bank.test.js
└── requests.http               # Raw XML envelopes
```

## SOAP concepts shown in the code

| Concept | Where |
|---------|-------|
| Contract-first WSDL (types, message, portType, binding, service, port) | `src/bank.wsdl` |
| Document/literal style, SOAP 1.1 binding over HTTP | `<soap:binding style="document">` |
| `SOAPAction` per operation | `<soap:operation soapAction=...>` |
| XSD validation rules in the contract (`pattern`, `decimal`, `dateTime`) | `<types>` in the WSDL |
| Envelope / Body parsing and building | node-soap (`soap.listen`) |
| `soap:Fault` with `faultcode`, `faultstring`, custom `detail` | `fault()` in `bank.service.js` |
| Client vs Server faults; internals never leaked | `safe()` wrapper, `suppressStack: true` |
| WSDL-generated client (`CreateAccountAsync` ...) | `src/client.js`, tests |
| Exact money: decimal string → integer paise | `toMinor()`, `balanceMinor` |
| Atomic check-and-debit (no overdraft under concurrency) | `Withdraw` uses one `findOneAndUpdate` |
| Request body-size limit | `express.raw({ limit: '100kb' })` in `app.js` |
| Health check, graceful shutdown | `app.js`, `server.js` |

## Next steps (not in this example)

- WS-Security (`UsernameToken` or X.509 signatures) in the SOAP Header; node-soap supports both
- Transfers between accounts with a MongoDB transaction and an idempotency key
- SOAP 1.2 binding (`application/soap+xml`, `env:Sender` / `env:Receiver` fault codes)
- MTOM attachments for documents (statements, KYC files)
