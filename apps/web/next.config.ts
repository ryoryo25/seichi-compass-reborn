import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@seichi/shared', '@seichi/db'],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.ts': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
};

export default nextConfig;
