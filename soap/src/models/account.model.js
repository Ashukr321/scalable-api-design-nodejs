import mongoose from 'mongoose';

export const CURRENCIES = ['INR', 'USD', 'EUR'];

const accountSchema = new mongoose.Schema(
  {
    accountNumber: { type: String, required: true, unique: true, match: /^\d{10}$/ },
    ownerName: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    currency: { type: String, enum: CURRENCIES, default: 'INR' },
    // Money is stored as integer minor units (paise/cents) so 0.1 + 0.2 never happens.
    balanceMinor: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'balanceMinor must be an integer' },
    },
  },
  { timestamps: true, versionKey: false },
);

export const Account = mongoose.model('Account', accountSchema);
