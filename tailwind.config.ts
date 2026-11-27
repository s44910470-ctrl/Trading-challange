import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: { colors: { arena: { bg: '#061222', panel: '#0C1B30', elevated: '#102640', line: '#203B5A', blue: '#38BDF8', cyan: '#67E8F9' } }, boxShadow: { glow: '0 0 36px rgba(56,189,248,.12)' } } },
  plugins: []
};
export default config;
