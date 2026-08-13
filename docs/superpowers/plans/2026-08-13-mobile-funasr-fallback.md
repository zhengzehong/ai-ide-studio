# Android FunASR Fallback Implementation Plan

## Goal

Add a production-safe fallback for Android realtime voice when the device has no
system `RecognitionService`. The phone connects only to the configured AI IDE
Studio server; Gateway proxies authenticated PCM WebSocket traffic to the
internal FunASR service.

## Constraints

- Keep Android `SpeechRecognizer` as the preferred path.
- Do not expose the internal FunASR endpoint to the phone or public network.
- Reuse the existing AI IDE Studio local token and voice foreground service.
- Do not change the database, session command schema, PC UI, or Web UI.
- Do not restart the running PRD service during implementation or packaging.

## Implementation Steps

1. Add `FUNASR_WS_URL` configuration and a dedicated authenticated Gateway
   WebSocket upgrade route at `/api/v1/voice/asr`.
2. Implement a bounded binary/text proxy to FunASR with connection timeout,
   cleanup, structured logs, and explicit close reasons.
3. Add integration coverage for disabled configuration, authentication,
   upstream forwarding, final result forwarding, and cleanup.
4. Add an Android FunASR socket and `AudioRecord` capture path using 16 kHz,
   mono, PCM16 audio with speech/silence segmentation.
5. Select system ASR when available and automatically use Gateway/FunASR when
   unavailable; preserve the existing Prompt, response, TTS, and restart loop.
6. Update architecture/configuration documentation and focused source-contract
   tests for the native fallback path.
7. Run focused tests, full tests, lint, server/mobile builds, and Android debug
   packaging. Review the final diff, commit to `prd`, and provide the APK path.

## Acceptance Criteria

- A device without `RecognitionService` enters listening state instead of an
  immediate error when the Gateway ASR proxy is configured.
- Speech is segmented, transcribed by FunASR, and sent once to the selected
  Session as a normal voice Prompt.
- AI speech playback cannot be captured as a new user utterance.
- Unauthorized ASR WebSocket requests never reach FunASR.
- FunASR/network failure remains recoverable and does not stop the foreground
  voice service or existing realtime connection.
- Existing browser, desktop, and realtime WebSocket behavior remains intact.
