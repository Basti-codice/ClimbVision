import { mount } from 'svelte';
import './design/base.css';
import App from './ui/App.svelte';

mount(App, { target: document.getElementById('app') as HTMLElement });
