import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true, match: /^[A-Z0-9-]{3,32}$/ },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    priceCents: { type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: 'priceCents must be an integer' } },
    stock: { type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'stock must be an integer' } },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

export const Product = mongoose.model('Product', productSchema);
