import { describe, expect, test } from 'vitest'
import { toolCallTitle } from '../../src/acp/update-mapper.ts'
import { toolSummary } from '../../ui/src/pages/workspace/helpers.ts'

describe('tool call title and summary', () => {
  test('uses MCP server and tool name instead of a generic tool-call id', () => {
    const tool = {
      toolCallId: 'BpxX8M',
      rawInput: {
        server: 'filesystem',
        tool: 'read_text_file',
        arguments: {
          path: 'C:\\Users\\lenovo\\.codex\\memories\\MEMORY.md',
        },
      },
    }

    expect(toolCallTitle(tool)).toBe('filesystem.read_text_file')
    expect(toolSummary({
      id: 'BpxX8M',
      title: toolCallTitle(tool),
      rawInput: tool.rawInput,
      status: 'completed',
    })).toBe('filesystem.read_text_file C:\\Users\\lenovo\\.codex\\memories\\MEMORY.md')
  })

  test('falls back to readable MCP arguments when title is generic', () => {
    expect(toolSummary({
      id: 'kVimi',
      title: '工具调用 #kVimi',
      rawInput: {
        server: 'filesystem',
        tool: 'search_files',
        arguments: {
          path: 'D:\\code_space\\python_space\\ai-ide-studio',
          pattern: '*.test.ts',
        },
      },
      status: 'completed',
    })).toBe('filesystem.search_files D:\\code_space\\python_space\\ai-ide-studio *.test.ts')
  })
})
