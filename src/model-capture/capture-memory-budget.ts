export type CaptureTruncationReason = 'capture_limit' | 'total_limit'

export interface CaptureMemoryLease {
  retain(bytes: number): CaptureTruncationReason | undefined
  release(): void
}

export interface CaptureMemoryBudget {
  open(): CaptureMemoryLease
}

export function createCaptureMemoryBudget(
  perCaptureBytes: number,
  totalBytes: number,
): CaptureMemoryBudget {
  let totalRetained = 0
  return {
    open(): CaptureMemoryLease {
      let retained = 0
      return {
        retain(bytes: number): CaptureTruncationReason | undefined {
          if (retained + bytes > perCaptureBytes) return 'capture_limit'
          if (totalRetained + bytes > totalBytes) return 'total_limit'
          retained += bytes
          totalRetained += bytes
          return undefined
        },
        release(): void {
          totalRetained -= retained
          retained = 0
        },
      }
    },
  }
}

// Payload accounting leaves headroom for serialization, parsed objects and Node I/O buffers.
export const captureMemoryBudget = createCaptureMemoryBudget(16 * 1024 * 1024, 128 * 1024 * 1024)
