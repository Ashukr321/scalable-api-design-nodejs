import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;
const options = { timestamps: true, versionKey: false };

const authorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  },
  options,
);

const postSchema = new mongoose.Schema(
  {
    authorId: { type: ObjectId, ref: 'Author', required: true, index: true },
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
    body: { type: String, required: true, maxlength: 20_000 },
    tags: { type: [{ type: String, lowercase: true, trim: true, maxlength: 30 }], default: [], validate: [(t) => t.length <= 10, 'at most 10 tags'] },
    published: { type: Boolean, default: false },
  },
  options,
);
postSchema.index({ tags: 1 });

const commentSchema = new mongoose.Schema(
  {
    postId: { type: ObjectId, ref: 'Post', required: true },
    authorId: { type: ObjectId, ref: 'Author', required: true },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
  },
  options,
);
commentSchema.index({ postId: 1, _id: 1 });

export const Author = mongoose.model('Author', authorSchema);
export const Post = mongoose.model('Post', postSchema);
export const Comment = mongoose.model('Comment', commentSchema);
