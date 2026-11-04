import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default tseslint.config(
  { ignores: ['dist', 'bench', 'node_modules', 'public/vendor', 'firmware', 'scripts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off', // TypeScript prüft Namen; Browser-Globals sind in tsconfig (lib DOM) bekannt
      'svelte/no-at-html-tags': 'error',
      'svelte/no-dom-manipulating': 'off', // Videoelement der Quelle wird bewusst in die Seite gehängt
      'svelte/require-each-key': 'off',
      'svelte/prefer-svelte-reactivity': 'off', // Map/Set werden hier nur lokal/nicht reaktiv genutzt; Änderungen laufen über neue Instanzen
    },
  },
);
