// Demo client: one example of each of the 4 gRPC call types.
// Start the server first (npm run dev), then: npm run client
import { grpc, InventoryService } from './proto.js';

const target = process.env.GRPC_TARGET || 'localhost:50051';
const client = new InventoryService(target, grpc.credentials.createInsecure());

const metadata = new grpc.Metadata();
metadata.set('x-api-key', process.env.API_KEY || '');
const deadline = () => ({ deadline: Date.now() + 3000 }); // always set a deadline

const unary = (method, request) =>
  new Promise((resolve, reject) =>
    client[method](request, metadata, deadline(), (err, res) => (err ? reject(err) : resolve(res))),
  );

const suffix = Date.now().toString(36).toUpperCase(); // unique SKUs on every run

// 1. Unary
const keyboard = await unary('CreateProduct', { sku: `KB-${suffix}`, name: 'Mechanical Keyboard', priceCents: 8950, stock: 10 });
console.log('1. CreateProduct ->', keyboard);

try {
  await unary('GetProduct', { id: '000000000000000000000000' });
} catch (err) {
  console.log('   GetProduct (missing) ->', grpc.status[err.code], '-', err.details);
}

// 2. Client streaming: send many products, get one summary
const summary = await new Promise((resolve, reject) => {
  const call = client.ImportProducts(metadata, deadline(), (err, res) => (err ? reject(err) : resolve(res)));
  call.write({ sku: `MS-${suffix}`, name: 'Mouse', priceCents: 1999, stock: 25 });
  call.write({ sku: `HP-${suffix}`, name: 'Headphones', priceCents: 5999, stock: 0 });
  call.write({ sku: `KB-${suffix}`, name: 'Duplicate', priceCents: 1, stock: 1 }); // fails: sku exists
  call.end();
});
console.log('2. ImportProducts ->', JSON.stringify(summary));

// 3. Server streaming: one request, products arrive one by one
console.log('3. ListProducts (in stock):');
for await (const p of client.ListProducts({ inStockOnly: true }, metadata, deadline())) {
  console.log(`   ${p.sku.padEnd(16)} ${p.name.padEnd(20)} stock=${p.stock}`);
}

// 4. Bidirectional: send stock changes, read new levels as they come back
console.log('4. UpdateStock:');
const stock = client.UpdateStock(metadata, deadline());
stock.on('data', (level) => console.log('  ', JSON.stringify(level)));
const finished = new Promise((resolve, reject) => stock.on('end', resolve).on('error', reject));
stock.write({ sku: `KB-${suffix}`, delta: -3 }); // sold 3
stock.write({ sku: `KB-${suffix}`, delta: -100 }); // more than in stock -> ok: false
stock.write({ sku: `MS-${suffix}`, delta: 5 }); // received 5
stock.end();
await finished;

client.close();
