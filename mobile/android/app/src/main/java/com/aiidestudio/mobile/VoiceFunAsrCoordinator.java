package com.aiidestudio.mobile;

import android.os.Handler;

/** Coordinates one fallback utterance without coupling capture details to the Service. */
public final class VoiceFunAsrCoordinator {
    public interface Listener {
        void onStatus(String message);
        void onFinalText(String text);
        void onRetry(String message);
    }

    private final Handler handler;
    private final Listener listener;
    private VoiceFunAsrSocket socket;
    private VoicePcmRecorder recorder;
    private boolean active;

    public VoiceFunAsrCoordinator(Handler handler, Listener listener) {
        this.handler = handler;
        this.listener = listener;
    }

    public void start(String asrWsUrl, String token) {
        stop();
        active = true;
        socket = new VoiceFunAsrSocket(handler, new VoiceFunAsrSocket.Listener() {
            @Override public void onReady() { startCapture(); }
            @Override public void onFinalText(String text) {
                if (!active) return;
                stop();
                listener.onFinalText(text);
            }
            @Override public void onError(String message) { retry(message); }
        });
        listener.onStatus("正在连接 FunASR");
        socket.start(asrWsUrl, token);
    }

    public void stop() {
        active = false;
        VoicePcmRecorder currentRecorder = recorder;
        recorder = null;
        if (currentRecorder != null) currentRecorder.stop();
        VoiceFunAsrSocket currentSocket = socket;
        socket = null;
        if (currentSocket != null) currentSocket.stop();
    }

    private void startCapture() {
        if (!active) return;
        recorder = new VoicePcmRecorder(handler, new VoicePcmRecorder.Listener() {
            @Override public void onSpeechStarted() { listener.onStatus("正在识别语音"); }
            @Override public void onPcm(byte[] pcm) {
                VoiceFunAsrSocket current = socket;
                if (current != null && !current.sendPcm(pcm)) handler.post(() -> retry("语音数据发送失败"));
            }
            @Override public void onUtteranceEnded() {
                if (!active) return;
                listener.onStatus("正在完成识别");
                VoiceFunAsrSocket current = socket;
                if (current == null || !current.finish()) retry("语音识别结束失败");
            }
            @Override public void onError(String message) { retry(message); }
        });
        if (!recorder.start()) retry("无法启动麦克风录音");
        else listener.onStatus("FunASR 监听中");
    }

    private void retry(String message) {
        if (!active) return;
        stop();
        listener.onRetry(message);
    }
}
