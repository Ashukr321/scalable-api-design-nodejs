import mongoose from 'mongoose';

export const CATEGORIES = ['electronics', 'books', 'fashion', 'home', 'sports'];

// Fields a client may write. Anything else in the body (_id, createdAt, ...) is ignored.
export const WRITABLE_FIELDS = ['name', 'sku', 'description', 'price', 'category', 'stock', 'tags', 'isActive'];

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true, match: /^[A-Z0-9-]{3,32}$/ },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    price: { type: Number, required: true, min: 0 },
    category: { type: String, required: true, enum: CATEGORIES },
    stock: { type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'stock must be an integer' } },
    tags: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true, // adds `id`
      versionKey: false,
      transform: (_doc, ret) => {
        delete ret._id;
        return ret;
      },
    },
  },
);

// Supports the common list query: filter by category, sort by price.
productSchema.index({ category: 1, price: 1 });

export const Product = mongoose.model('Product', productSchema);
