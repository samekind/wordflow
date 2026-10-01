import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.wordflow.app',
  appName: '拾词',
  webDir: 'dist',
  backgroundColor: '#FFFFFF',
  initialFocus: false,
  loggingBehavior: 'none',
  android: { allowMixedContent: false, backgroundColor: '#FFFFFF' },
  plugins: {
    SystemBars: { style: 'LIGHT', insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
  },
}
export default config
