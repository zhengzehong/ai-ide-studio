export interface BuiltinMemoryDimensionDef {
  name: string
  description: string
  prompt: string
}

export const BUILTIN_MEMORY_DIMENSIONS: BuiltinMemoryDimensionDef[] = [
  {
    name: 'lessons',
    description:
      '经验教训——用户纠正过的做法、用户确认过的判断、我自己踩坑复盘出的规律。源头不限,用户教的和自己悟的都算。',
    prompt: `何时记录:
- 用户明确纠正("不要这样"、"应该用 Y")
- 用户确认你做对了("对,就这样"、"保持")
- 你自己踩坑后复盘出规律(没人告诉你,自己试错学到的)
- 用户表达偏好("我喜欢 X 风格")——如果同时是经验,优先记这里

何时使用:
- 开始新任务前 recall 相关关键词
- 做技术选型、写代码、决定流程时
- 用户提到"上次"、"之前说过"时必查

条目结构:
- 一句话标题(规则本身)
- Why: 原因(用户给的 / 踩坑经过)
- How to apply: 什么场景下适用
- 可选 tags: [coding-style / workflow / debug / communication / tooling / self-lesson]

不装:代码具体写法、文件路径、commit hash、fix recipe(这些读代码就有)`,
  },
  {
    name: 'facts',
    description:
      '所有事实类信息——用户个人事实、项目目录与地址、服务器信息、外部系统、对接方信息、用户随口提到的任何"X 是 Y"陈述。不限类型,只要是事实就往这里记。',
    prompt: `何时记录:
- 用户提到任何事实("我的生日是 X"、"服务器在 Y"、"这个项目归 Z 管")
- 发现任何工作相关的地址、目录、配置位置
- 跨 Agent 协作时的对接方信息
- 用户随口说的个人情况、背景事实

何时使用:
- 回复前 recall 相关事实
- 执行任务需要地址、目录、配置时
- 涉及对接方、外部系统时

条目结构:
- 一句话标题
- 事实描述(具体、可验证)
- 可选 tags: [user-personal / workspace / server / external-system / collaborator / project-meta]

边界:
- 装事实("X 是 Y"),不装偏好("喜欢 X")也不装经验("该这么做")
- 凭据只记位置,不记值本身
- 能从代码、配置、CLAUDE.md 直接读到的不记(除非需要快速召回)`,
  },
  {
    name: 'preferences',
    description:
      '用户偏好——回复风格、沟通节奏、代码风格、写作方式、协作习惯、决策授权范围。用户喜欢/讨厌什么都往这里记。',
    prompt: `何时记录:
- 用户表达喜欢/讨厌某种风格("我喜欢简洁回复"、"不要分点")
- 用户对沟通节奏有要求("先确认再动手"、"边做边报")
- 用户对代码风格有偏好(命名、注释、错误处理深度)
- 用户对写作方式有要求(中文/英文、术语统一、详尽/精简)
- 用户授权某些决策("这种小事你自己定就行")

何时使用:
- 每次回复前 recall 风格偏好
- 写代码前 recall 代码风格偏好
- 决定要不要先确认时 recall 决策授权范围

条目结构:
- 一句话标题(偏好本身)
- Why: 用户给的理由(如果有)
- How to apply: 什么场景下适用
- 可选 tags: [reply-style / communication / coding-style / writing / decision-making]

边界:
- 装偏好("喜欢/讨厌 X"),不装事实("X 是 Y")也不装经验("做错了 X")
- 和 lessons 的区分:偏好是"用户喜欢",lessons 是"做对/做错"——如果用户纠正过你,既算偏好也算经验,优先记到 lessons(因为带 Why)`,
  },
]
