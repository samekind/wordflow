import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.wordflow.app',
  appName: '拾词',
  webDir: 'dist',
  backgroundColor: '#FFFFFF',
  initialFocus: false,
  loggingBehavior: 'none',
  android: { allowMixedContent: false, backgroundColor: '#FFFFFF' },
  // iOS has no native storage layer yet, so the app loads the published web build from our server
  // (same origin as the /api endpoints); features update with server releases.
  ios: { server: { url: 'https://wordflow.43.134.190.112.sslip.io' } },
  plugins: {
    SystemBars: { style: 'LIGHT', insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
  },
}
export default config
