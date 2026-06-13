module.exports = {
  root: true,
  env: {
    'jest/globals': true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:jsdoc/recommended-typescript',
    'plugin:jest/recommended',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'jsdoc', 'jest', 'prettier'],
  rules: {
    // Enforce no unused variables. Variables and parameters prefixed with
    // underscore are ignored, but this convention should be used sparingly,
    // only for genuinely unused parameters (e.g., callback args you don't
    // need). For ESLint false positives on interface method parameters or
    // type annotation names, use scoped disable/enable blocks or inline
    // disable-next-line comments instead of prefixing with underscore.
    // The base no-unused-vars rule is disabled because
    // @typescript-eslint/no-unused-vars handles everything including
    // type-only positions.
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        args: 'all',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],

    // Enforce Prettier formatting as an ESLint rule to ensure consistency.
    'prettier/prettier': 'error',

    // React prop-types are not needed as we use TypeScript for type checking.
    'react/prop-types': 'off',

    // React 17+ doesn't require React to be in scope for JSX.
    'react/react-in-jsx-scope': 'off',

    // Do not require explicit return types on module boundaries to allow TS
    // inference.
    '@typescript-eslint/explicit-module-boundary-types': 'off',

    // Enforce JSDoc comments for functions, methods, and classes to maintain
    // documentation.
    'jsdoc/require-jsdoc': [
      'error',
      {
        require: {
          FunctionDeclaration: true,
          MethodDefinition: true,
          ClassDeclaration: true,
          ArrowFunctionExpression: false,
          FunctionExpression: false,
        },
        contexts: [
          'VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
          'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
        ],
      },
    ],

    // Require descriptions for JSDoc parameters to improve documentation quality.
    'jsdoc/require-param-description': 'error',

    // Require descriptions for JSDoc return values.
    'jsdoc/require-returns-description': 'error',

    // Ensure all function parameters are documented in JSDoc.
    'jsdoc/require-param': 'error',

    // Ensure function return values are documented in JSDoc.
    'jsdoc/require-returns': 'error',

    // Allow flexible line spacing in JSDoc tags to accommodate different styles.
    // This was added to avoid errors when tags are separated by empty lines or
    // directly follow descriptions.
    'jsdoc/tag-lines': ['error', 'any', { startLines: 1 }],

    // Warn about unknown JSDoc tags, but allow custom '@category' tag.
    'jsdoc/check-tag-names': ['warn', { definedTags: ['category'] }],

    // Enforce a maximum line length for code and comments to ensure readability.
    // Code is limited to 99 characters, while comments are stricter at 88.
    'max-len': [
      'error',
      {
        code: 99,
        tabWidth: 2,
        comments: 88,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
      },
    ],
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
  ignorePatterns: ['node_modules/', 'android/', 'ios/', '*.config.js', '**/coverage/**', 'tools/'],
};
