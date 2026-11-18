// The schema (SDL): the contract between clients and server. Clients can only ask for what is here.
export const typeDefs = /* GraphQL */ `
  "ISO-8601 date-time string, e.g. 2026-11-18T10:00:00.000Z"
  scalar DateTime

  type Author {
    id: ID!
    name: String!
    email: String!
    "Posts by this author, newest first"
    posts(first: Int = 10, after: String): PostConnection!
    createdAt: DateTime!
  }

  type Post {
    id: ID!
    title: String!
    body: String!
    tags: [String!]!
    published: Boolean!
    author: Author!
    comments: [Comment!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Comment {
    id: ID!
    text: String!
    author: Author!
    post: Post!
    createdAt: DateTime!
  }

  # Relay-style cursor pagination
  type PostEdge {
    cursor: String!
    node: Post!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type PostConnection {
    edges: [PostEdge!]!
    pageInfo: PageInfo!
  }

  input PostFilter {
    authorId: ID
    tag: String
    published: Boolean
  }

  type Query {
    author(id: ID!): Author
    "First 100 authors by name"
    authors: [Author!]!
    post(id: ID!): Post
    "Newest first. first: 1-50"
    posts(first: Int = 10, after: String, filter: PostFilter): PostConnection!
  }

  input CreateAuthorInput {
    name: String!
    email: String!
  }

  input CreatePostInput {
    authorId: ID!
    title: String!
    body: String!
    tags: [String!] = []
    published: Boolean = false
  }

  "Only the fields you send are changed"
  input UpdatePostInput {
    title: String
    body: String
    tags: [String!]
    published: Boolean
  }

  input AddCommentInput {
    postId: ID!
    authorId: ID!
    text: String!
  }

  type Mutation {
    createAuthor(input: CreateAuthorInput!): Author!
    createPost(input: CreatePostInput!): Post!
    updatePost(id: ID!, input: UpdatePostInput!): Post!
    "Also deletes the post's comments. Returns false if the post did not exist."
    deletePost(id: ID!): Boolean!
    addComment(input: AddCommentInput!): Comment!
  }

  type Subscription {
    "Fires for every new comment on this post (over WebSocket)"
    commentAdded(postId: ID!): Comment!
  }
`;
