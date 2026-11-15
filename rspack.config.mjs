import path from 'node:path';
import { rspack } from '@rspack/core';

const coverage = process.env.COVERAGE === 'true';

export default {
  entry: './src/main.tsx',
  output: { path: path.resolve(coverage ? 'dist-coverage' : 'dist'), clean: true },
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  ...(coverage && { devtool: 'source-map' }),
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        loader: 'builtin:swc-loader',
        options: {
          detectSyntax: 'auto',
          jsc: {
            transform: { react: { runtime: 'automatic' } },
            experimental: {
              cacheRoot: path.resolve('node_modules/.cache/swc'),
              plugins: coverage ? [['swc-plugin-coverage-instrument', {}]] : [],
            },
          },
        },
      },
    ],
  },
  plugins: [new rspack.HtmlRspackPlugin({ template: './index.html' })],
};
