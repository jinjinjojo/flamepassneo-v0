import { defineConfig } from '@farmfe/core';

export default defineConfig({
  compilation: {
    input: {
      index: './src/rammerhead.js'
    },
    output: {
      path: 'dist',
      publicPath: '/',
      targetEnv: 'browser'
    }
  },
});
