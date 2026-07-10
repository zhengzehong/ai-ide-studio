import { taskStepManager, type StepReportInput } from './task-steps.js'
import { dispatchReadySteps, type DispatchReadyStepsResult } from './step-ready-dispatch.js'

export interface StepReportDispatchResult extends ReturnType<typeof taskStepManager.reportStep> {
  dispatchedSteps: string[]
  dispatchFailure?: Pick<DispatchReadyStepsResult, 'failedStepId' | 'failureMessage'>
}

export async function reportStepAndDispatch(input: StepReportInput): Promise<StepReportDispatchResult> {
  const result = taskStepManager.reportStep(input)
  const dispatch = result.taskCompleted ? { dispatchedSteps: [] } : await dispatchReadySteps(input.taskId, result.unlockedSteps)
  return {
    ...result,
    dispatchedSteps: dispatch.dispatchedSteps,
    dispatchFailure: dispatch.failedStepId
      ? { failedStepId: dispatch.failedStepId, failureMessage: dispatch.failureMessage }
      : undefined,
  }
}
