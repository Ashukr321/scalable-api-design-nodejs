import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const protoFile = (name) => fileURLToPath(new URL(`../proto/${name}`, import.meta.url));

// Dynamic loading: no generated code. Field names become camelCase (price_cents -> priceCents),
// int64 becomes a JS number, enums become strings, unset fields get proto3 defaults.
const definition = protoLoader.loadSync([protoFile('inventory.proto'), protoFile('health.proto')], {
  keepCase: false,
  longs: Number,
  enums: String,
  defaults: true,
});

const loaded = grpc.loadPackageDefinition(definition);

export const InventoryService = loaded.inventory.v1.InventoryService;
export const Health = loaded.grpc.health.v1.Health;
export { grpc };
