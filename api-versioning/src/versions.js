// Single place that says which versions exist and where each one is in its lifecycle.
// To release v3: add it here, give v2 a `deprecation`, and announce the sunset date.
export const VERSIONS = {
  v1: {
    status: 'deprecated',
    deprecation: {
      since: '2026-11-01',
      sunset: '2027-06-30',
      successor: '/api/v2',
      docs: 'https://example.com/docs/migrate-v1-to-v2',
    },
  },
  v2: { status: 'current' },
};

export const LATEST = 'v2';
