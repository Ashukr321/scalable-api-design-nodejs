import mongoose from 'mongoose';
import { Author, Post, Comment } from './models/index.js';

await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/graphql_blog_demo');
await Promise.all([Author.deleteMany(), Post.deleteMany(), Comment.deleteMany()]);
await Author.syncIndexes();

const [asha, ravi] = await Author.create([
  { name: 'Asha Verma', email: 'asha@example.com' },
  { name: 'Ravi Kumar', email: 'ravi@example.com' },
]);

const posts = await Post.create([
  { authorId: asha._id, title: 'Why GraphQL?', body: 'Ask for exactly what you need.', tags: ['graphql', 'api'], published: true },
  { authorId: asha._id, title: 'DataLoader explained', body: 'Batch and cache per request.', tags: ['graphql', 'performance'], published: true },
  { authorId: ravi._id, title: 'MongoDB indexes', body: 'Index what you filter and sort on.', tags: ['mongodb'], published: true },
  { authorId: ravi._id, title: 'Draft: subscriptions', body: 'Coming soon.', tags: ['graphql'] },
]);

await Comment.create([
  { postId: posts[0]._id, authorId: ravi._id, text: 'Great intro!' },
  { postId: posts[0]._id, authorId: asha._id, text: 'Thanks Ravi.' },
  { postId: posts[2]._id, authorId: asha._id, text: 'Compound indexes next?' },
]);

console.log(`Seeded 2 authors, ${posts.length} posts, 3 comments. Post id for subscriptions: ${posts[0].id}`);
await mongoose.disconnect();
