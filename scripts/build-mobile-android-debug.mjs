import { existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const mobileDir = join(root, 'mobile')
const androidDir = join(mobileDir, 'android')
const releaseDir = join(root, 'release')
const apkSource = join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
const apkTarget = join(releaseDir, 'AI-IDE-Studio-Mobile-prd-0.2.0-debug.apk')

function run(command, args, options = {}) {
  const isWindows = process.platform === 'win32'
  const finalCommand = isWindows ? 'cmd.exe' : command
  const finalArgs = isWindows ? ['/d', '/s', '/c', [command, ...args].join(' ')] : args
  const result = spawnSync(finalCommand, finalArgs, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function defaultAndroidSdk() {
  if (process.env.ANDROID_HOME) return process.env.ANDROID_HOME
  if (process.env.ANDROID_SDK_ROOT) return process.env.ANDROID_SDK_ROOT
  return join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local'), 'Android', 'Sdk')
}

function javaMajorVersion(javaHome) {
  if (!javaHome) return 0
  const javaBin = join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  if (!existsSync(javaBin)) return 0
  const result = spawnSync(javaBin, ['-version'], { encoding: 'utf8' })
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const match = text.match(/version "(\d+)/)
  return match ? Number(match[1]) : 0
}

function defaultJavaHome() {
  const studioJbr = 'D:\\softs\\android_sto\\jbr'
  const candidates = [process.env.JAVA_HOME, studioJbr].filter((value) => !!value)
  return candidates.find((candidate) => javaMajorVersion(candidate) >= 21) ?? ''
}

const env = { ...process.env }
env.ANDROID_HOME = defaultAndroidSdk()
env.ANDROID_SDK_ROOT = env.ANDROID_HOME
env.MOBILE_BUILD_TARGET = 'android'
env.VITE_MOBILE_BUILD_TARGET = 'android'

const javaHome = defaultJavaHome()
if (javaHome) {
  env.JAVA_HOME = javaHome
  env.Path = `${join(javaHome, 'bin')};${env.Path ?? ''}`
}

run('npm', ['run', 'build'], { cwd: mobileDir, env })
run('npx', ['cap', 'sync', 'android'], { cwd: mobileDir, env })
run(process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew', ['assembleDebug'], { cwd: androidDir, env })

mkdirSync(releaseDir, { recursive: true })
copyFileSync(apkSource, apkTarget)
console.log(`APK written to ${apkTarget}`)
