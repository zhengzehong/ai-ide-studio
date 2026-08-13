package com.aiidestudio.mobile;

/** Small energy-based utterance detector tuned for 16 kHz, 20 ms PCM frames. */
public final class VoiceActivityDetector {
    public enum Result { WAITING, STARTED, SPEAKING, FINISHED, MAX_DURATION }

    private static final int SPEECH_RMS = 550;
    private static final int START_FRAMES = 3;
    private static final int END_SILENCE_FRAMES = 45;
    private static final int MIN_SPEECH_FRAMES = 12;
    private static final int MAX_UTTERANCE_FRAMES = 1_000;

    private int consecutiveSpeech;
    private int silenceFrames;
    private int utteranceFrames;
    private boolean started;

    public Result accept(short[] samples, int count) {
        boolean speech = rms(samples, count) >= SPEECH_RMS;
        if (!started) {
            consecutiveSpeech = speech ? consecutiveSpeech + 1 : 0;
            if (consecutiveSpeech < START_FRAMES) return Result.WAITING;
            started = true;
            utteranceFrames = consecutiveSpeech;
            return Result.STARTED;
        }

        utteranceFrames += 1;
        silenceFrames = speech ? 0 : silenceFrames + 1;
        if (utteranceFrames >= MAX_UTTERANCE_FRAMES) return Result.MAX_DURATION;
        if (utteranceFrames >= MIN_SPEECH_FRAMES && silenceFrames >= END_SILENCE_FRAMES) {
            return Result.FINISHED;
        }
        return Result.SPEAKING;
    }

    public static int rms(short[] samples, int count) {
        if (samples == null || count <= 0) return 0;
        double sum = 0;
        int safeCount = Math.min(count, samples.length);
        for (int index = 0; index < safeCount; index += 1) {
            double value = samples[index];
            sum += value * value;
        }
        return (int) Math.sqrt(sum / safeCount);
    }
}
