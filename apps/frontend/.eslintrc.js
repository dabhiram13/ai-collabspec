module.exports = {
  extends: [
    '../../.eslintrc.js',
    'next/core-web-vitals',
  ],
  env: {
    browser: true,
    es2022: true,
  },
  rules: {
    // React-specific rules for consistent component development
    'react/prop-types': 'off', // Using TypeScript for prop validation
    'react-hooks/exhaustive-deps': 'warn',
    '@next/next/no-img-element': 'error',
  },
};