import mongoose from 'mongoose';
import { Product } from './models/product.model.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/rest_api_demo';

const products = [
  { name: 'Wireless Headphones', sku: 'EL-HP-001', price: 59.99, category: 'electronics', stock: 40, tags: ['audio'] },
  { name: 'Mechanical Keyboard', sku: 'EL-KB-002', price: 89.5, category: 'electronics', stock: 15, tags: ['pc'] },
  { name: 'Node.js Design Patterns', sku: 'BK-NODE-01', price: 39, category: 'books', stock: 25, tags: ['nodejs'] },
  { name: 'Clean Code', sku: 'BK-CC-002', price: 32, category: 'books', stock: 0 },
  { name: 'Running Shoes', sku: 'SP-RS-001', price: 120, category: 'sports', stock: 8 },
  { name: 'Cotton T-Shirt', sku: 'FA-TS-001', price: 15, category: 'fashion', stock: 100 },
  { name: 'Coffee Mug', sku: 'HM-MG-001', price: 9.99, category: 'home', stock: 60, isActive: false },
];

await mongoose.connect(MONGO_URI);
await Product.deleteMany({});
await Product.insertMany(products);
console.log(`Seeded ${products.length} products into ${mongoose.connection.name}`);
await mongoose.disconnect();
