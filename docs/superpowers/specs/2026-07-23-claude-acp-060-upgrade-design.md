# Claude ACP 0.60 Upgrade Design

## Goal

Upgrade the Claude ACP runtime from `0.37.0` to the conservative stable pair provided by `claude-agent-acp 0.60.0` and its transitive `claude-agent-sdk 0.3.215` dependency.

## Scope

- Pin `@agentclientprotocol/claude-agent-acp` to exact version `0.60.0`.
- Regenerate `package-lock.json` through npm.
- Keep the platform's direct `@agentclientprotocol/sdk` dependency unchanged at `^0.22.1`; the ACP process owns its nested SDK `1.2.1`.
- Do not change database schemas, HTTP APIs, PC/mobile clients, runtime code, or PRD processes.

## Compatibility

The ACP wire protocol remains version 1. AI IDE Studio already falls back from the removed legacy `session/set_model` method to `setSessionConfigOption(configId='model')`. Node.js 22 or newer is required; the current PRD host uses Node.js 24.

## Verification

Run dependency resolution checks, TypeScript, full tests, server/PC/mobile build, lint, and `git diff --check`. A separate runtime canary is required before restarting PRD.

