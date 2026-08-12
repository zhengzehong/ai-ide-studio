package com.aiidestudio.mobile;

import android.content.Context;
import android.os.Handler;

import androidx.annotation.Nullable;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/** Keeps the foreground service's realtime transport independent from ASR/TTS. */
public final class VoiceRealtimeSocket {
    public interface Listener {
        void onOpen();
        void onMessage(String text);
        void onReconnecting(@Nullable String reason);
    }

    private static final long RETRY_MS = 1_500L;
    private static final long HEARTBEAT_INTERVAL_MS = 15_000L;
    private static final long HEARTBEAT_TIMEOUT_MS = 30_000L;
    private static final String PREF_STREAM_GENERATION = "streamGeneration";
    private static final String PREF_SEQUENCE = "sequence";

    private final Context context;
    private final Handler handler;
    private final OkHttpClient client;
    private final Listener listener;
    private final Runnable heartbeat = this::heartbeat;
    private volatile WebSocket socket;
    private volatile boolean socketOpen;
    private String wsUrl;
    private String token;
    private String sessionId;
    private String streamGeneration;
    private long sequence;
    private volatile long lastInboundAt;
    private volatile boolean active;
    private volatile boolean retryScheduled;

    public VoiceRealtimeSocket(Context context, Handler handler, Listener listener) {
        this.context = context.getApplicationContext();
        this.handler = handler;
        this.client = new OkHttpClient.Builder().retryOnConnectionFailure(true).build();
        this.listener = listener;
    }

    public void start(String wsUrl, String token, String sessionId) {
        this.wsUrl = wsUrl;
        this.token = token;
        if (!sessionId.equals(this.sessionId)) clearCursor();
        this.sessionId = sessionId;
        loadCursor();
        active = true;
        connect();
    }

    public boolean isOpen() {
        return socket != null && socketOpen;
    }

    public boolean sendPrompt(String content) {
        if (!isOpen()) return false;
        try {
            JSONObject prompt = new JSONObject();
            prompt.put("type", "prompt");
            prompt.put("sessionId", sessionId);
            prompt.put("content", content);
            prompt.put("clientMessageId", "voice-" + UUID.randomUUID());
            return socket.send(prompt.toString());
        } catch (JSONException ignored) {
            return false;
        }
    }

    public void sendResume() {
        if (!isOpen()) return;
        try {
            JSONObject resume = new JSONObject().put("type", "resume");
            if (streamGeneration == null || sequence <= 0) {
                resume.put("cursors", new JSONObject());
            } else {
                JSONObject cursor = new JSONObject()
                    .put("streamGeneration", streamGeneration)
                    .put("sequence", sequence);
                resume.put("cursors", new JSONObject().put(sessionId, cursor));
            }
            socket.send(resume.toString());
        } catch (JSONException ignored) {
            // The cursor payload is composed only from validated primitive values.
        }
    }

    public void captureCursor(JSONObject message) {
        String generation = message.optString("streamGeneration", null);
        long nextSequence = message.optLong("sequence", -1L);
        if (generation == null || generation.isEmpty() || nextSequence < 0) return;
        if (streamGeneration != null && !streamGeneration.equals(generation)) sequence = 0L;
        streamGeneration = generation;
        sequence = Math.max(sequence, nextSequence);
        context.getSharedPreferences(VoiceForegroundService.PREFS, Context.MODE_PRIVATE).edit()
            .putString(PREF_STREAM_GENERATION, streamGeneration)
            .putLong(PREF_SEQUENCE, sequence)
            .apply();
    }

    public void clearCursor() {
        streamGeneration = null;
        sequence = 0L;
        context.getSharedPreferences(VoiceForegroundService.PREFS, Context.MODE_PRIVATE).edit()
            .remove(PREF_STREAM_GENERATION)
            .remove(PREF_SEQUENCE)
            .apply();
    }

    public void stop() {
        active = false;
        retryScheduled = false;
        handler.removeCallbacks(heartbeat);
        handler.removeCallbacksAndMessages(this);
        closeSocket();
        client.dispatcher().cancelAll();
    }

    private void connect() {
        if (!active || wsUrl == null || sessionId == null) return;
        closeSocket();
        String endpoint = wsUrl;
        if (token != null && !token.isEmpty() && !endpoint.contains("token=")) {
            endpoint += (endpoint.contains("?") ? "&" : "?") + "token=" + android.net.Uri.encode(token);
        }
        final Request request;
        try {
            request = new Request.Builder().url(endpoint).build();
        } catch (IllegalArgumentException error) {
            listener.onReconnecting("实时对话服务器地址无效");
            return;
        }
        socket = client.newWebSocket(request, new WebSocketListener() {
            @Override public void onOpen(WebSocket next, Response response) {
                if (!active || socket != next) return;
                socketOpen = true;
                try {
                    next.send(new JSONObject()
                        .put("type", "subscribe")
                        .put("sessionIds", new org.json.JSONArray().put(sessionId))
                        .toString());
                } catch (JSONException ignored) {
                    listener.onReconnecting("订阅语音会话失败");
                    return;
                }
                if (streamGeneration != null && sequence > 0) sendResume();
                retryScheduled = false;
                startHeartbeat();
                handler.post(() -> { if (active && socket == next) listener.onOpen(); });
            }

            @Override public void onMessage(WebSocket current, String text) {
                if (!active || socket != current) return;
                lastInboundAt = System.currentTimeMillis();
                handler.post(() -> { if (active && socket == current) listener.onMessage(text); });
            }

            @Override public void onFailure(WebSocket current, Throwable error, @Nullable Response response) {
                handler.post(() -> onSocketLost(current, error.getMessage()));
            }

            @Override public void onClosed(WebSocket current, int code, String reason) {
                handler.post(() -> onSocketLost(current, reason));
            }
        });
        lastInboundAt = System.currentTimeMillis();
    }

    private void onSocketLost(WebSocket current, @Nullable String reason) {
        if (!active || socket != current) return;
        closeSocket();
        handler.removeCallbacks(heartbeat);
        listener.onReconnecting(reason);
        if (!retryScheduled) {
            retryScheduled = true;
            handler.postAtTime(() -> {
                retryScheduled = false;
                connect();
            }, this, android.os.SystemClock.uptimeMillis() + RETRY_MS);
        }
    }

    private void heartbeat() {
        if (!active || !isOpen()) return;
        if (System.currentTimeMillis() - lastInboundAt >= HEARTBEAT_TIMEOUT_MS) {
            closeSocket();
            listener.onReconnecting("实时连接无响应");
            scheduleReconnect();
            return;
        }
        try {
            socket.send(new JSONObject().put("type", "ping").put("timestamp", System.currentTimeMillis()).toString());
        } catch (JSONException ignored) {
            // Fixed heartbeat payload.
        }
        handler.postDelayed(heartbeat, HEARTBEAT_INTERVAL_MS);
    }

    private void startHeartbeat() {
        handler.removeCallbacks(heartbeat);
        lastInboundAt = System.currentTimeMillis();
        handler.postDelayed(heartbeat, HEARTBEAT_INTERVAL_MS);
    }

    private void loadCursor() {
        android.content.SharedPreferences prefs = context.getSharedPreferences(VoiceForegroundService.PREFS, Context.MODE_PRIVATE);
        streamGeneration = prefs.getString(PREF_STREAM_GENERATION, null);
        sequence = prefs.getLong(PREF_SEQUENCE, 0L);
    }

    private void closeSocket() {
        WebSocket current = socket;
        socket = null;
        socketOpen = false;
        if (current != null) current.close(1000, "voice stopped");
    }

    private void scheduleReconnect() {
        if (!active || retryScheduled) return;
        retryScheduled = true;
        handler.postAtTime(() -> {
            retryScheduled = false;
            connect();
        }, this, android.os.SystemClock.uptimeMillis() + RETRY_MS);
    }
}
