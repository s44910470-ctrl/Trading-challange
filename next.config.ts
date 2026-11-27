import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const isUserSite = Boolean(repoName?.endsWith('.github.io'));
const useCustomDomain = process.env.GITHUB_PAGES_CUSTOM_DOMAIN === 'true';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  ...(isGitHubPages && repoName && !isUserSite && !useCustomDomain
    ? { basePath: `/${repoName}` }
    : {})
};

export default nextConfig;
