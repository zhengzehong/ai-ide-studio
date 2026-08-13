package com.aiidestudio.mobile;

import android.annotation.SuppressLint;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;

import androidx.annotation.Nullable;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayDeque;

/** Captures PCM16 and emits one utterance after local speech/silence detection. */
public final class VoicePcmRecorder {
    public interface Listener {
        void onSpeechStarted();
        void onPcm(byte[] pcm);
        void onUtteranceEnded();
        void onError(String message);
    }

    private static final int SAMPLE_RATE = 16_000;
    private static final int FRAME_SAMPLES = 320;
    private static final int PRE_ROLL_FRAMES = 15;

    private final Handler handler;
    private final Listener listener;
    private volatile boolean active;
    private AudioRecord record;
    private Thread worker;

    public VoicePcmRecorder(Handler handler, Listener listener) {
        this.handler = handler;
        this.listener = listener;
    }

    @SuppressLint("MissingPermission")
    public boolean start() {
        stop();
        int minimum = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        );
        if (minimum <= 0) return false;
        try {
            record = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                Math.max(minimum, FRAME_SAMPLES * 8)
            );
            if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                record.release();
                record = null;
                return false;
            }
            active = true;
            record.startRecording();
            worker = new Thread(this::capture, "voice-pcm-capture");
            worker.start();
            return true;
        } catch (RuntimeException error) {
            releaseRecord();
            return false;
        }
    }

    public void stop() {
        active = false;
        releaseRecord();
        Thread current = worker;
        worker = null;
        if (current != null && current != Thread.currentThread()) {
            try { current.join(500L); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        }
    }

    private void capture() {
        VoiceActivityDetector detector = new VoiceActivityDetector();
        ArrayDeque<byte[]> preRoll = new ArrayDeque<>();
        boolean sending = false;
        short[] samples = new short[FRAME_SAMPLES];
        try {
            while (active) {
                AudioRecord current = record;
                if (current == null) break;
                int count = current.read(samples, 0, samples.length, AudioRecord.READ_BLOCKING);
                if (count <= 0) {
                    if (count < 0) postError("AudioRecord read failed: " + count);
                    continue;
                }
                byte[] pcm = toPcm(samples, count);
                VoiceActivityDetector.Result result = detector.accept(samples, count);
                if (!sending) {
                    preRoll.addLast(pcm);
                    while (preRoll.size() > PRE_ROLL_FRAMES) preRoll.removeFirst();
                    if (result != VoiceActivityDetector.Result.STARTED) continue;
                    sending = true;
                    handler.post(listener::onSpeechStarted);
                    for (byte[] frame : preRoll) listener.onPcm(frame);
                    preRoll.clear();
                } else {
                    listener.onPcm(pcm);
                }
                if (result == VoiceActivityDetector.Result.FINISHED
                    || result == VoiceActivityDetector.Result.MAX_DURATION) {
                    active = false;
                    handler.post(listener::onUtteranceEnded);
                }
            }
        } catch (RuntimeException error) {
            postError(error.getMessage() == null ? "Audio capture failed" : error.getMessage());
        } finally {
            releaseRecord();
        }
    }

    private void postError(String message) {
        active = false;
        handler.post(() -> listener.onError(message));
    }

    private static byte[] toPcm(short[] samples, int count) {
        ByteBuffer buffer = ByteBuffer.allocate(count * 2).order(ByteOrder.LITTLE_ENDIAN);
        for (int index = 0; index < count; index += 1) buffer.putShort(samples[index]);
        return buffer.array();
    }

    private synchronized void releaseRecord() {
        AudioRecord current = record;
        record = null;
        if (current == null) return;
        try { current.stop(); } catch (IllegalStateException ignored) { }
        current.release();
    }
}
