import DataLoader from 'dataloader';
import { Author, Comment } from '../models/index.js';

// DataLoader fixes the N+1 problem: 10 posts asking for their author become ONE
// `Author.find({ _id: { $in: [...] } })` instead of 10 queries.
// Create new loaders per request, so the cache never leaks data between users.
export function createLoaders({ cache = true } = {}) {
  return {
    authorById: new DataLoader(
      async (ids) => {
        const authors = await Author.find({ _id: { $in: ids } });
        const byId = new Map(authors.map((a) => [a.id, a]));
        return ids.map((id) => byId.get(String(id)) ?? null); // same order as ids, as DataLoader requires
      },
      { cache, cacheKeyFn: String },
    ),

    commentsByPostId: new DataLoader(
      async (postIds) => {
        // shortcut: loads every comment of each post; add pagination if posts get thousands of comments.
        const comments = await Comment.find({ postId: { $in: postIds } }).sort({ _id: 1 });
        const byPost = Map.groupBy(comments, (c) => String(c.postId));
        return postIds.map((id) => byPost.get(String(id)) ?? []);
      },
      { cache, cacheKeyFn: String },
    ),
  };
}
