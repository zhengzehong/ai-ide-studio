package com.aiidestudio.mobile;

import android.os.Handler;

import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/** One-utterance FunASR stream through the authenticated AI IDE Gateway. */
public final class VoiceFunAsrSocket {
    public interface Listener {
        void onReady();
        void onFinalText(String text);
        void onError(String message);
    }

    private final Handler handler;
    private final Listener listener;
    private final OkHttpClient client;
    private final Runnable finalTimeout = () -> fail("FunASR result timed out");
    private WebSocket socket;
    private boolean active;
    private boolean ready;
    private boolean finalDelivered;

    public VoiceFunAsrSocket(Handler handler, Listener listener) {
        this.handler = handler;
        this.listener = listener;
        client = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(true)
            .build();
    }

    public void start(String url, String token) {
        stop();
        active = true;
        ready = false;
        finalDelivered = false;
        final Request request;
        try {
            Request.Builder builder = new Request.Builder().url(url);
            if (token != null && !token.isEmpty()) builder.header("x-ai-ide-token", token);
            request = builder.build();
        } catch (IllegalArgumentException error) {
            fail("ASR Gateway address is invalid");
            return;
        }
        socket = client.newWebSocket(request, new WebSocketListener() {
            @Override public void onOpen(WebSocket current, Response response) {
                if (!active || socket != current) return;
                current.send(initialRequest().toString());
            }

            @Override public void onMessage(WebSocket current, String text) {
                if (!active || socket != current) return;
                try {
                    JSONObject message = new JSONObject(text);
                    if ("ready".equals(message.optString("type"))) {
                        ready = true;
                        handler.post(() -> { if (active) listener.onReady(); });
                        return;
                    }
                    if ("error".equals(message.optString("type"))) {
                        fail(message.optString("message", "FunASR unavailable"));
                        return;
                    }
                    if (message.optBoolean("is_final", false) && !finalDelivered) {
                        finalDelivered = true;
                        handler.removeCallbacks(finalTimeout);
                        String result = message.optString("text", "").trim();
                        handler.post(() -> { if (active) listener.onFinalText(result); });
                    }
                } catch (JSONException error) {
                    fail("FunASR returned an invalid response");
                }
            }

            @Override public void onFailure(WebSocket current, Throwable error, @Nullable Response response) {
                if (socket == current) fail(error.getMessage() == null ? "FunASR connection failed" : error.getMessage());
            }

            @Override public void onClosed(WebSocket current, int code, String reason) {
                if (socket == current && active && !finalDelivered) fail(reason.isEmpty() ? "FunASR connection closed" : reason);
            }
        });
    }

    public boolean sendPcm(byte[] pcm) {
        return active && ready && socket != null && socket.send(ByteString.of(pcm));
    }

    public boolean finish() {
        WebSocket current = socket;
        if (!active || !ready || current == null) return false;
        try {
            JSONObject request = new JSONObject()
                .put("chunk_size", new JSONArray().put(5).put(10).put(5))
                .put("wav_name", "android")
                .put("is_speaking", false)
                .put("chunk_interval", 10)
                .put("mode", "2pass");
            boolean sent = current.send(request.toString());
            if (sent) handler.postDelayed(finalTimeout, 15_000L);
            return sent;
        } catch (JSONException ignored) {
            return false;
        }
    }

    public void stop() {
        active = false;
        ready = false;
        handler.removeCallbacks(finalTimeout);
        WebSocket current = socket;
        socket = null;
        if (current != null) current.close(1000, "ASR utterance ended");
        client.dispatcher().cancelAll();
    }

    private static JSONObject initialRequest() {
        try {
            return new JSONObject()
                .put("chunk_size", new JSONArray().put(5).put(10).put(5))
                .put("wav_name", "android")
                .put("is_speaking", true)
                .put("chunk_interval", 10)
                .put("itn", true)
                .put("mode", "2pass")
                .put("wav_format", "PCM")
                .put("audio_fs", 16_000);
        } catch (JSONException impossible) {
            return new JSONObject();
        }
    }

    private void fail(String message) {
        if (!active) return;
        active = false;
        ready = false;
        handler.post(() -> listener.onError(message));
    }
}
