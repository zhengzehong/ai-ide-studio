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
  win: { target: string[] }
}

const builderConfig: BuilderConfiguration = {
  appId: 'studio.ai-ide.desktop',
  productName: 'AI IDE Studio',
  directories: {
    output: 'release',
  },
  files: [
    'dist/**',
    'ui/dist/**',
    {
      from: process.env.AI_IDE_ELECTRON_BUILD_DIR || 'electron/dist',
      to: 'electron/dist',
      filter: ['backend-launch.js', 'builder.config.js', 'main.js', 'preload.js'],
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
    target: ['nsis', 'portable'],
  },
}

export default builderConfig
