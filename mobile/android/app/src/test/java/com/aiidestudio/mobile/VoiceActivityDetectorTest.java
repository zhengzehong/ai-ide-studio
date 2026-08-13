package com.aiidestudio.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class VoiceActivityDetectorTest {
    @Test public void detectsSpeechThenSilence() {
        VoiceActivityDetector detector = new VoiceActivityDetector();
        short[] speech = frame((short) 2_000);
        short[] silence = frame((short) 0);

        assertEquals(VoiceActivityDetector.Result.WAITING, detector.accept(speech, speech.length));
        assertEquals(VoiceActivityDetector.Result.WAITING, detector.accept(speech, speech.length));
        assertEquals(VoiceActivityDetector.Result.STARTED, detector.accept(speech, speech.length));
        for (int index = 0; index < 9; index += 1) detector.accept(speech, speech.length);
        for (int index = 0; index < 44; index += 1) {
            assertEquals(VoiceActivityDetector.Result.SPEAKING, detector.accept(silence, silence.length));
        }
        assertEquals(VoiceActivityDetector.Result.FINISHED, detector.accept(silence, silence.length));
    }

    @Test public void ignoresBackgroundNoise() {
        VoiceActivityDetector detector = new VoiceActivityDetector();
        short[] noise = frame((short) 200);
        for (int index = 0; index < 100; index += 1) {
            assertEquals(VoiceActivityDetector.Result.WAITING, detector.accept(noise, noise.length));
        }
    }

    private static short[] frame(short value) {
        short[] samples = new short[320];
        java.util.Arrays.fill(samples, value);
        return samples;
    }
}
