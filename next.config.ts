import type { NextConfig } from 'next';
import { version } from './package.json';

// Explicitly expose only the public release label, never other environment values.
const revision = process.env.VERCEL_GIT_COMMIT_SHA || '';
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_ORBIT_VERSION: version,
    NEXT_PUBLIC_ORBIT_REVISION: /^[a-f0-9]{40}$/i.test(revision)
      ? revision.slice(0, 7)
      : 'локальная',
  },
};

export default nextConfig;
