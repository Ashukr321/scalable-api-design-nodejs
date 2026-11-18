// Demo client: reads the WSDL, then calls operations like plain async functions.
// Start the server first (npm run dev), then: npm run client
import soap from 'soap';

const WSDL = process.env.WSDL_URL || 'http://localhost:3000/soap/bank?wsdl';
// endpoint overrides the WSDL's <soap:address>, so the client follows WSDL_URL's host/port.
const client = await soap.createClientAsync(WSDL, { endpoint: WSDL.replace(/\?wsdl$/i, '') });

console.log('Operations:', Object.keys(client.describe().BankService.BankPort).join(', '));

const [created] = await client.CreateAccountAsync({ ownerName: 'Asha Verma', currency: 'INR' });
const { accountNumber } = created.account;
console.log('Created  :', created.account);

const [afterDeposit] = await client.DepositAsync({ accountNumber, amount: '1500.75' });
console.log('Deposit  :', afterDeposit.account.balance);

const [afterWithdraw] = await client.WithdrawAsync({ accountNumber, amount: '500.25' });
console.log('Withdraw :', afterWithdraw.account.balance);

try {
  await client.WithdrawAsync({ accountNumber, amount: '999999' });
} catch (err) {
  // err.root.Envelope.Body.Fault holds the parsed soap:Fault
  const f = err.root?.Envelope?.Body?.Fault;
  console.log('Fault    :', f?.faultcode, '-', f?.faultstring, f?.detail?.BankFault);
}

console.log('\nLast request XML:\n' + client.lastRequest);
