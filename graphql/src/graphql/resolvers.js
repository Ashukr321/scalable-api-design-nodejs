import { GraphQLError, GraphQLScalarType, Kind } from 'graphql';
import { PubSub, withFilter } from 'graphql-subscriptions';
import mongoose from 'mongoose';
import { Author, Post, Comment } from '../models/index.js';

// shortcut: in-memory PubSub only reaches subscribers on THIS process.
// Run several instances? Swap in graphql-redis-subscriptions (same API).
export const pubsub = new PubSub();
const COMMENT_ADDED = 'COMMENT_ADDED';

const MAX_PAGE = 50;

const userError = (message, code = 'BAD_USER_INPUT', extra = {}) => new GraphQLError(message, { extensions: { code, ...extra } });

function objectId(value, field) {
  if (!mongoose.isValidObjectId(value)) throw userError(`${field} is not a valid id`, 'BAD_USER_INPUT', { field });
  return value;
}

// Turns Mongoose errors into client errors with a stable `extensions.code`.
async function db(work) {
  try {
    return await work();
  } catch (err) {
    if (err.name === 'ValidationError') {
      const fields = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
      throw userError('Validation failed', 'BAD_USER_INPUT', { fields });
    }
    if (err.code === 11000) throw userError(`${Object.keys(err.keyValue).join(', ')} already exists`, 'CONFLICT');
    throw err; // unknown: masked by formatError
  }
}

// Cursor = base64 of the last _id seen. Opaque to clients; stable when new posts are added.
const encodeCursor = (id) => Buffer.from(String(id)).toString('base64url');
function decodeCursor(cursor) {
  const id = Buffer.from(cursor, 'base64url').toString();
  if (!mongoose.isValidObjectId(id)) throw userError('after is not a valid cursor');
  return id;
}

async function paginate(filter, first, after) {
  if (!Number.isInteger(first) || first < 1 || first > MAX_PAGE) throw userError(`first must be between 1 and ${MAX_PAGE}`);
  const query = { ...filter, ...(after && { _id: { $lt: decodeCursor(after) } }) };
  const docs = await Post.find(query).sort({ _id: -1 }).limit(first + 1); // +1 tells us if there is a next page
  const page = docs.slice(0, first);
  return {
    edges: page.map((node) => ({ cursor: encodeCursor(node._id), node })),
    pageInfo: { hasNextPage: docs.length > first, endCursor: page.length ? encodeCursor(page.at(-1)._id) : null },
  };
}

function postFilter(filter = {}) {
  const query = {};
  if (filter.authorId != null) query.authorId = objectId(filter.authorId, 'filter.authorId');
  if (filter.tag != null) query.tags = String(filter.tag).toLowerCase(); // a plain string, never an operator object
  if (filter.published != null) query.published = filter.published;
  return query;
}

async function mustExist(Model, id, field) {
  const doc = await Model.findById(objectId(id, field));
  if (!doc) throw userError(`${Model.modelName} ${id} not found`, 'NOT_FOUND');
  return doc;
}

const DateTime = new GraphQLScalarType({
  name: 'DateTime',
  serialize: (value) => new Date(value).toISOString(),
  parseValue(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw userError('Invalid DateTime');
    return date;
  },
  parseLiteral(ast) {
    if (ast.kind !== Kind.STRING) throw userError('DateTime must be a string');
    return DateTime.parseValue(ast.value);
  },
});

export const resolvers = {
  DateTime,

  Query: {
    author: (_, { id }) => Author.findById(objectId(id, 'id')).exec(), // .exec(): a real Promise; graphql-js may call .then twice
    authors: () => Author.find().sort({ name: 1 }).limit(100).exec(),
    post: (_, { id }) => Post.findById(objectId(id, 'id')).exec(),
    posts: (_, { first, after, filter }) => paginate(postFilter(filter), first, after),
  },

  Mutation: {
    createAuthor: (_, { input }) => db(() => Author.create(input)),

    createPost: async (_, { input }) => {
      await mustExist(Author, input.authorId, 'authorId');
      return db(() => Post.create(input));
    },

    updatePost: async (_, { id, input }) => {
      const changes = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const post = await db(() =>
        Post.findByIdAndUpdate(objectId(id, 'id'), { $set: changes }, { returnDocument: 'after', runValidators: true }),
      );
      if (!post) throw userError(`Post ${id} not found`, 'NOT_FOUND');
      return post;
    },

    deletePost: async (_, { id }) => {
      const post = await Post.findByIdAndDelete(objectId(id, 'id'));
      if (!post) return false;
      // shortcut: two writes, not a transaction; a crash in between leaves orphan comments (harmless, never shown).
      await Comment.deleteMany({ postId: post._id });
      return true;
    },

    addComment: async (_, { input }) => {
      await Promise.all([mustExist(Post, input.postId, 'postId'), mustExist(Author, input.authorId, 'authorId')]);
      const comment = await db(() => Comment.create(input));
      await pubsub.publish(COMMENT_ADDED, { commentAdded: comment });
      return comment;
    },
  },

  Subscription: {
    commentAdded: {
      // Every subscriber listens on one channel; withFilter only lets through comments for its post.
      subscribe: withFilter(
        () => pubsub.asyncIterableIterator(COMMENT_ADDED),
        (payload, { postId }) => String(payload.commentAdded.postId) === postId,
      ),
    },
  },

  // Field resolvers: run only when the client asks for that field.
  Author: {
    posts: (author, { first, after }) => paginate({ authorId: author._id }, first, after),
  },
  Post: {
    author: (post, _, { loaders }) => loaders.authorById.load(post.authorId),
    comments: (post, _, { loaders }) => loaders.commentsByPostId.load(post._id),
  },
  Comment: {
    author: (comment, _, { loaders }) => loaders.authorById.load(comment.authorId),
    post: (comment) => Post.findById(comment.postId).exec(),
  },
};
