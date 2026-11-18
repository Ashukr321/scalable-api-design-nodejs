import mongoose from 'mongoose';

export const ROOM_RE = /^[a-z0-9-]{1,32}$/;

const messageSchema = new mongoose.Schema(
  {
    room: { type: String, required: true, match: ROOM_RE },
    user: { type: String, required: true, trim: true, minlength: 1, maxlength: 32 },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        delete ret._id;
        return ret;
      },
    },
  },
);

// History query: newest messages of one room, paged by _id.
messageSchema.index({ room: 1, _id: -1 });

export const Message = mongoose.model('Message', messageSchema);
