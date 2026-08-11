interface BuilderConfiguration {
  appId: string
  productName: string
  directories: { output: string }
  files: Array<string | { from: string; to: string; filter?: string[] }>
  extraResources: Array<{ from: string; to: string; filter?: string[] }>
  asar: boolean
  asarUnpack: string[]
  extraFiles: Array<{ from: string; to: string }>
  npmRebuild: boolean
  win: { icon: string; target: string[] }
}

const builderConfig: BuilderConfiguration = {
  appId: 'studio.ai-ide.desktop',
  productName: 'AI IDE Studio',
  directories: {
    output: process.env.AI_IDE_ELECTRON_OUTPUT_DIR || 'release',
  },
  files: [
    'dist/**',
    'ui/dist/**',
    'mobile/dist/**',
    {
      from: process.env.AI_IDE_ELECTRON_BUILD_DIR || 'electron/dist',
      to: 'electron/dist',
      filter: [
        'backend-launch.js',
        'builder.config.js',
        'desktop-connection-probe.js',
        'desktop-connection.js',
        'desktop-credentials.js',
        'desktop-download-policy.js',
        'desktop-download.js',
        'desktop-icon.js',
        'desktop-ipc.js',
        'desktop-ipc-policy.js',
        'desktop-preload.cjs',
        'desktop-security.js',
        'desktop-target.js',
        'desktop-window-settings.js',
        'main.js',
        'load-recovery.js',
        'setup-preload.cjs',
        'setup-submission.js',
        'setup-window.js',
        'widget-preload.cjs',
        'widget-navigation.js',
        'widget-window-layout.js',
        'widget-window.js',
      ],
    },
    'package.json',
    'node_modules/**',
    '!node_modules/electron/**',
    '!node_modules/electron-builder/**',
    '!node_modules/app-builder-lib/**',
    '!node_modules/app-builder-bin/**',
    '!node_modules/7zip-bin/**',
  ],
  extraResources: [
    { from: 'dist', to: 'app/dist' },
    { from: process.env.AI_IDE_ELECTRON_BUILD_DIR || 'electron/dist', to: 'app/electron', filter: ['backend-main.js'] },
    { from: 'ui/dist', to: 'app/ui/dist' },
    { from: 'mobile/dist', to: 'app/mobile/dist' },
    { from: 'ui/public/app-icon.png', to: 'app-icon.png' },
  ],
  asar: false,
  asarUnpack: [
    '**/*.node',
  ],
  npmRebuild: false,
  extraFiles: [
    { from: process.execPath, to: 'resources/node/node.exe' },
  ],
  win: {
    icon: 'ui/public/app-icon.png',
    target: ['nsis', 'portable'],
  },
}

export default builderConfig
