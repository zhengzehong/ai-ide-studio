const electronBuildDir = process.env.AI_IDE_ELECTRON_BUILD_DIR || 'electron/dist'

const builderConfig = {
  appId: 'studio.ai-ide.desktop',
  productName: 'AI IDE Studio',
  directories: {
    output: 'release',
  },
  files: [
    'dist/**',
    'ui/dist/**',
    {
      from: electronBuildDir,
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
    { from: electronBuildDir, to: 'app/electron', filter: ['backend-main.js'] },
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
