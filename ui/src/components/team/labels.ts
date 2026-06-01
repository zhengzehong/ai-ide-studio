export function roleLabel(role: string): string {
  return { leader: '负责人', member: '成员', worker: '执行者', planner: '规划', reviewer: '审查' }[role] || role
}
