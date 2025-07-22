import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    // This plugin will automatically generate a self-signed certificate
    // and configure the server to use it for HTTPS.
    basicSsl(),
  ],
});