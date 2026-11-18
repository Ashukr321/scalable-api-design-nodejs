import mongoose from 'mongoose';

// ONE database schema for every API version. Versions differ only in how they
// read/write it (serializers), never in how data is stored.
const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, trim: true, maxlength: 60, default: '' },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^\S+@\S+\.\S+$/ },
    phone: { type: String, trim: true, default: null },
    status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
  },
  { timestamps: true },
);

userSchema.index({ status: 1, _id: -1 });

export const User = mongoose.model('User', userSchema);
