declare module '*.svelte' { import type { Component } from 'svelte'; const c: Component<Record<string, unknown>>; export default c; }
