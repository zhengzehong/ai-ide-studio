export function shouldForceRuntimeCancel(cancelCompleted: boolean, promptActive: boolean): boolean {
  return !cancelCompleted && promptActive
}
