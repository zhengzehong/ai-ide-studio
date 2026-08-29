# APP 端「截屏发送到灵感/会话」技术可行性调研与方案设计

> 任务 task-ef9911b2 / step-266b4648 · 2026-08-29 · 状态:初稿(5 个决策点待确认后定稿)

## 1. 可行性结论(TL;DR)

**可行,工作量集中在原生触发层 + 入口 UI,后端与 JS 发送链路已全部就绪。**

| 环节 | 现状 | 缺口 |
|------|------|------|
| 会话发图 | ✅ 全通:`ChatInput.tsx` 选图 → FileReader base64 → `{data,mimeType,name}` → `chat.store.sendPrompt(content, images)` → ws `{type:'prompt', images}` | 无 |
| 灵感收图 | ✅ 后端 `inspiration.note.create` 已校验并接收 `images`(≤10 张、单张 ≤15MB、`image/*`);PC 端已在用 | 移动端 `saveNote` 未透出 images 参数(加一个参数即可) |
| 原生截屏 | ⚠️ **有先例但无此能力**:android 层已有 9 个 Java 原生文件,`MainActivity.registerPlugin(VoicePlugin.class)` 是现成的 Capacitor 插件范式,`VoiceForegroundService` 是前台服务范式 | 需新增 `ScreenshotPlugin`(Java,仿 VoicePlugin) |
| 权限 | Manifest 目前无存储类权限(targetSdk=36) | 按所选路径新增(见 §4) |

> 对任务描述的一处修正:step 写"当前 0 个 .kt 所以零原生基础"——.kt 确实为 0,但**原生插件基础设施已存在**(VoicePlugin.java 系列即是)。截图插件照抄该范式用 Java 写即可,不需要引入 Kotlin,风险和未知面更小。

## 2. 捕获路径对比(路径 D 为调研新增建议)

| 路径 | 原理 | 权限 | 用户体验 | 主要缺点 | 结论 |
|------|------|------|----------|----------|------|
| **A. 监听系统截图** | `ContentObserver` 监听 `MediaStore.Images`,新记录 `RELATIVE_PATH` 命中 `Pictures/Screenshots` 即触发 | `READ_MEDIA_IMAGES`(33+,运行时) | ⭐ 最好:用户照常截屏,APP 内自动弹卡片 | 需存储权限;进程被杀时漏检 | **推荐(主路径)** |
| **B. MediaProjection 主动截屏** | 应用内按钮 → 系统授权弹窗 → VirtualDisplay+ImageReader 抓帧 | `FOREGROUND_SERVICE_MEDIA_PROJECTION` + 前台服务(14+ 强制) | 差:**每次截屏都要过系统授权弹窗**(Android 14 起不允许缓存授权) | 授权链重、实现量最大 | 备选(仅当要求"截 APP 内部内容"且不接受路径 A 时) |
| **C. AccessibilityService** | 无障碍事件探测截图行为 | 无障碍权限(引导用户去系统设置开启) | 差:需用户手动到系统设置开无障碍 | 过度授权、OEM 行为不一、审核敏感、脆弱 | **否决** |
| **D. 系统分享转发**(新增建议) | 截图后系统菜单"分享"→ 本 APP(`ACTION_SEND image/*` intent-filter) | **零权限** | 良好:多一步"分享"操作,但系统原生支持 | 多一次手动操作;只能作为补充 | **建议与 A 组合** |

**推荐组合:A(自动监听)+ D(分享兜底)**。A 覆盖高频场景(截屏即弹出),D 零权限兜底(权限被拒/进程被杀漏检时用户仍可主动分享进来),两者共用同一套"发送目标 UI"(§6)。B 不建议首发——单是"每次授权弹窗"就足以劝退高频使用。

**路径 A 关键设计:防漏检双保险**
1. 前台实时:APP 运行期间注册 ContentObserver,命中即发 `screenshotCaptured` 事件。
2. Resume 兜底:每次 APP 回到前台,查询 `DATE_ADDED > lastSeenTimestamp` 的 Screenshots 新图(时间戳存 localStorage),有则补弹。进程被杀期间截的图不会丢。

## 3. (并入 §4)

## 4. 权限与 Manifest 改动清单

```xml
<!-- 路径 A:AndroidManifest.xml 新增 -->
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<!-- Android 14+ 部分授权(必须声明,否则 14+ 上部分授权流程不可用) -->
<uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" />
<!-- Android 12 及以下(targetSdk 36 时 runtime 不会走到,但声明无害) -->
<uses-permission android:maxSdkVersion="32" android:name="android.permission.READ_EXTERNAL_STORAGE" />

<!-- 路径 B(仅当选 B 时才加) -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
<service android:name=".ScreenshotForegroundService"
         android:foregroundServiceType="mediaProjection" />
```

**授权流程设计(路径 A):**
1. 入口:灵感页设置区 / 设置页加「截屏发送」开关(默认关)。
2. 开启 → `requestPermission()` → 系统 `READ_MEDIA_IMAGES` 运行时弹窗(附用途说明文案:"用于检测你的新截图,方便发送到灵感或会话")。
3. 授权成功 → `startListening()`;拒绝 → 开关保持关,入口显示引导文案(不阻塞其他功能)。
4. Android 14+ 用户选"部分访问":截图(系统生成、非用户手动挑选)大概率不出现给应用 → 检测到 `partial` 授权时,弹一次说明引导用户改为"全部访问",或自动降级为路径 D(分享入口)+ 路径 A2(点击"检查新截图"按钮主动扫一次)。
5. 运行时权限被系统收回(用户在设置里关掉)→ `checkPermission()` 在 onResume 校验,失效则静默停监听 + 开关置回。

## 5. 原生插件接口设计(`ScreenshotPlugin.java`,仿 VoicePlugin 范式)

```typescript
// mobile/src/plugins/screenshot.ts(Java 侧 @CapacitorPlugin(name = "Screenshot"))
export interface ScreenshotPlugin {
  // ── 权限 ──
  checkPermission(): Promise<{ granted: boolean; partial: boolean }>
  requestPermission(): Promise<{ granted: boolean; partial: boolean }>   // 不弹时跳系统设置页

  // ── 路径 A:监听 ──
  startListening(): Promise<void>          // 注册 ContentObserver
  stopListening(): Promise<void>
  scanPending(options: { since: number }): Promise<ScreenshotMeta[]>  // resume 兜底扫描

  // ── 图片读取(拉取式,避免事件里塞 15MB base64)──
  readImage(options: { uri: string; maxDimension?: number }): Promise<
    { data: string; mimeType: string; width: number; height: number }>  // data=base64

  // ── 路径 B(可选,选 B 才实现)──
  captureScreen(): Promise<{ data: string; mimeType: string }>

  // ── 事件 ──
  addListener('screenshotCaptured', (e: { uri: string; takenAt: number }) => void): PluginListenerHandle
}
```

Java 侧要点(全部有 VoicePlugin 先例可抄):
- `@CapacitorPlugin` + `MainActivity.registerPlugin(ScreenshotPlugin.class)`(照抄 VoicePlugin);
- `ContentObserver` 注册到 `MediaStore.Images.Media.EXTERNAL_CONTENT_URI`,回调里查最新一条,`RELATIVE_PATH LIKE '%Screenshots%'`(API 29+)过滤,防抖 300ms(一次截屏 MediaStore 会写多条记录);
- `notifyListeners("screenshotCaptured", ...)` 抛给 JS;JS 拿 uri 后再调 `readImage`(内置降采样:长边压到 ≤2048,质量 85 JPEG,确保 ≤15MB 后端限制);
- 路径 B 需 `ScreenshotForegroundService`(照抄 VoiceForegroundService 的前台服务骨架)+ `MediaProjectionManager.createScreenCaptureIntent()` 授权回调。

## 6. 发送目标 UI(截图 → 灵感/会话)

```
[screenshotCaptured 事件 / 分享进入 / scanPending 补检]
        ↓
底部卡片(全局悬浮,任意页面可弹):缩略图 + 「发送到 ▾」
   ├─ 📌 项目灵感 → 跳灵感快记页并预填截图(images=[截图]),复用现有保存流程
   ├─ 💬 指定会话 → 会话选择(最近 5 个会话 chips + 搜索)→ sendPrompt('', [截图])
   │                (chat 允许纯图发送,已验证 handleSubmit 逻辑)
   └─ ✕ 忽略(标记 lastSeen,不再弹)
```

改动点:
- `inspiration.store.ts` `saveNote` 加 `images?: ImageAttachmentInfo[]` 参数透传(后端零改动);
- 截图卡片组件 `ScreenshotSendSheet`(新增,复用 CandidateTaskSheet 的底部弹层样式体系);
- 分享入口:MainActivity `onNewIntent`/`onCreate` 处理 `ACTION_SEND`(Capacitor `App` 插件 `appUrlOpen` 不覆盖 SEND,需在原生层转 event 或直接用现有 VoicePlugin 的 intent 监听模式)。

## 7. 工作量估算(路径 A+D 组合)

| 项 | 估算 |
|----|------|
| ScreenshotPlugin.java(权限+监听+scanPending+readImage+降采样) | 1.5~2 天 |
| saveNote images 透传 + ScreenshotSendSheet + 分享入口 | 1~1.5 天 |
| 联调 + 真机回归(6/10/12/14+ 各测一轮权限流) | 1 天 |
| **合计** | **约 3.5~4.5 天** |

## 8. 待定决策点(需 PM/用户确认后定稿)

| # | 问题 | 我的建议 |
|---|------|----------|
| 1 | 触发路径选型(A 监听 / B 主动截屏 / C 无障碍) | **A+D 组合**(A 自动+D 零权限兜底),C 否决,B 首发不做 |
| 2 | 若选 B:是否接受 MediaProjection 每次授权弹窗 | 若选 A 则此问不成立;B 的授权弹窗无法绕过(Android 14+ 政策) |
| 3 | "节选会 A 卷"具体含义 | 原文语义不明(疑为输入误差)。猜测①:截图后可**框选局部区域**再发?猜测②:发送目标限定某会话?需澄清 |
| 4 | "消息发送增强"具体范围 | 待具体化(指 @指定 Agent?快捷指令?图文混排编辑?)明确后纳入 §6 扩展 |
| 5 | 是否需要 OCR(截图文字提取) | 建议不做独立 OCR:截图发到灵感后会走 AI 整理会话(视觉模型直接读图);若要"发送前预提取文字",需引入 tesseract.js(重)或后端 OCR 服务(新依赖),性价比低 |
