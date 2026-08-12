# App 后台实时语音 V1 实施计划

## 目标

只修改 Android App，实现设置页选择项目/Agent/Session 后，打开“实时对话”开关即启动或停止后台语音对话。使用系统 SpeechRecognizer + TextToSpeech，普通蓝牙耳机优先、手机音频回退，锁屏后由 Android Foreground Service 继续运行。复用现有后端文本 Prompt 和 Realtime 协议，不改 Gateway、数据库、ACP 或 Web。

## 设计边界

- 首版采用半双工轮次：ASR 结束后发送文本，等待 Session 完成，再 TTS 播放，播放结束后重新监听。
- 语音状态和后台工作放在原生 Android Service；WebView 只负责配置和展示状态。
- 目标 Session 必须属于所选项目/Agent；首版复用设置页选中的空闲活动 Session，不自动创建专用 Session。
- App 本地保存开关、目标项目/Agent/Session 和服务状态，不写服务端 settings。
- 不实现唤醒词、全双工打断、逐句流式 TTS、开机自启或自定义 BLE GATT 音频。

## 文件范围

- Android：前台服务、Capacitor Plugin、MainActivity 注册、Manifest 权限/Service、字符串资源。
- Mobile：语音 bridge、Zustand voice store、设置页目标选择/开关/状态。
- Tests：纯状态机/配置映射测试和移动端构建检查。
- Docs：更新实施计划和移动端架构说明。

## 步骤

- [x] 设计并实现原生 VoiceForegroundService 状态机、SpeechRecognizer、TTS、音频路由和通知。
- [x] 实现 Capacitor Voice Plugin，暴露状态读取、目标配置、启动/停止和事件监听。
- [x] 接入移动端 voice store 与 SettingsPage，完成项目/Agent/Session 选择和开关直启。
- [x] 处理目标 Session 校验、Prompt 发送和最终回复回传；活动列表过滤运行中的 Session。
- [x] 增加回归测试，运行移动端 lint/build、Android debug APK 构建。
- [x] 审查改动范围，确认未改后端/数据库、未重启服务。

## 验收标准

- 设置页打开开关后启动前台服务并显示持续通知；关闭后释放麦克风、TTS、音频和网络资源。
- 选择目标后，语音文本只发送到该项目/Agent/Session；Session 忙碌时不重复提交。
- SpeechRecognizer 最终结果触发一次 Prompt；Session 完成后 TTS 播放最终文本并自动进入下一轮。
- 无蓝牙设备时回退手机音频；蓝牙断开时显示可恢复错误，不崩溃、不串 Session。
- Android 工程构建通过；现有后端源码和正在运行服务不受影响。

## 当前实现说明

- V1 使用已有活动 Session，不自动创建“实时语音”专用 Session；同一 Session 已有 Prompt 时由设置页过滤，原生层也不会重复提交。
- 原生 Realtime 连接使用 `ping/pong`、`resume` 和 `resync_required`，游标保存在应用私有 SharedPreferences；语音回复只采集 `role=agent` 且非生命周期的内容。
- Android 锁屏运行依赖 Foreground Service。系统仍可能因用户手动停止应用、厂商电池策略或撤销麦克风权限而终止服务，这些情况会在通知/设置页显示异常。
