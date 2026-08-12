package com.aiidestudio.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;
public class VoiceForegroundService extends Service implements RecognitionListener, TextToSpeech.OnInitListener {
    public static final String ACTION_START = "com.aiidestudio.mobile.voice.START";
    public static final String ACTION_STOP = "com.aiidestudio.mobile.voice.STOP";
    public static final String ACTION_STATUS = "com.aiidestudio.mobile.voice.STATUS";
    public static final String EXTRA_WS_URL = "wsUrl";
    public static final String EXTRA_TOKEN = "token";
    public static final String EXTRA_SESSION_ID = "sessionId";
    public static final String EXTRA_PROJECT_ID = "projectId";
    public static final String EXTRA_AGENT_ID = "agentId";
    public static final String EXTRA_STATE = "state";
    public static final String EXTRA_MESSAGE = "message";
    public static final String EXTRA_AUDIO_ROUTE = "audioRoute";
    public static final String EXTRA_AUDIO_DEVICE = "audioDevice";
    public static final String PREFS = "ai_ide_voice";
    public static final String PREF_ENABLED = "enabled";
    public static final String PREF_WS_URL = "wsUrl";
    public static final String PREF_TOKEN = "token";
    public static final String PREF_SESSION_ID = "sessionId";
    public static final String PREF_PROJECT_ID = "projectId";
    public static final String PREF_AGENT_ID = "agentId";

    private static final int NOTIFICATION_ID = 731;
    private static final String CHANNEL_ID = "realtime_voice";
    private static final long LISTEN_RETRY_MS = 1_500L;
    private static final long LISTEN_AFTER_SPEAK_MS = 450L;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private VoiceRealtimeSocket realtimeSocket;
    private SpeechRecognizer recognizer;
    private TextToSpeech textToSpeech;
    private AudioManager audioManager;
    private boolean ttsReady;
    private boolean stopping;
    private String wsUrl;
    private String token;
    private String sessionId;
    private String projectId;
    private String agentId;
    private String state = "starting";
    private String responseText = "";
    private String responseMessageId;
    private String audioRoute = VoiceAudioRouter.ROUTE_UNKNOWN;
    private String audioDeviceName = "";

    public static JSONObject status(Context context) {
        JSONObject result = new JSONObject();
        android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        try {
            result.put("enabled", prefs.getBoolean(PREF_ENABLED, false));
            result.put("state", prefs.getBoolean(PREF_ENABLED, false) ? prefs.getString("state", "starting") : "disabled");
            result.put("sessionId", prefs.getString(PREF_SESSION_ID, null));
            result.put("projectId", prefs.getString(PREF_PROJECT_ID, null));
            result.put("agentId", prefs.getString(PREF_AGENT_ID, null));
            result.put("audioRoute", prefs.getString(EXTRA_AUDIO_ROUTE, VoiceAudioRouter.ROUTE_UNKNOWN));
            result.put("audioDevice", prefs.getString(EXTRA_AUDIO_DEVICE, ""));
        } catch (JSONException ignored) {
            // JSONObject writes above are primitive and cannot fail in practice.
        }
        return result;
    }

    public static void markDisabled(Context context) {
        context.getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putBoolean(PREF_ENABLED, false)
            .putString("state", "disabled")
            .apply();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            disableAndStop();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_START.equals(intent.getAction())) {
            saveConfiguration(intent);
        } else if (!getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(PREF_ENABLED, false)) {
            stopSelf();
            return START_NOT_STICKY;
        } else {
            loadConfiguration();
        }
        stopping = false;
        startForegroundNotification();
        initializeRuntime();
        return START_STICKY;
    }

    private void saveConfiguration(Intent intent) {
        String previousSessionId = sessionId;
        wsUrl = intent.getStringExtra(EXTRA_WS_URL);
        token = intent.getStringExtra(EXTRA_TOKEN);
        sessionId = intent.getStringExtra(EXTRA_SESSION_ID);
        projectId = intent.getStringExtra(EXTRA_PROJECT_ID);
        agentId = intent.getStringExtra(EXTRA_AGENT_ID);
        if (realtimeSocket != null && previousSessionId != null && !previousSessionId.equals(sessionId)) realtimeSocket.clearCursor();
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putBoolean(PREF_ENABLED, true)
            .putString(PREF_WS_URL, wsUrl)
            .putString(PREF_TOKEN, token)
            .putString(PREF_SESSION_ID, sessionId)
            .putString(PREF_PROJECT_ID, projectId)
            .putString(PREF_AGENT_ID, agentId)
            .apply();
    }

    private void loadConfiguration() {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        wsUrl = prefs.getString(PREF_WS_URL, null);
        token = prefs.getString(PREF_TOKEN, null);
        sessionId = prefs.getString(PREF_SESSION_ID, null);
        projectId = prefs.getString(PREF_PROJECT_ID, null);
        agentId = prefs.getString(PREF_AGENT_ID, null);
    }

    private void initializeRuntime() {
        if (wsUrl == null || wsUrl.isEmpty() || sessionId == null || sessionId.isEmpty()) {
            fail("实时对话目标配置不完整");
            return;
        }
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        VoiceAudioRouter.Result route = VoiceAudioRouter.apply(audioManager);
        audioRoute = route.route;
        audioDeviceName = route.deviceName;
        saveAudioRoute();
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            fail("系统语音识别服务不可用，请启用系统语音输入或安装语音服务");
            return;
        }
        if (textToSpeech == null) textToSpeech = new TextToSpeech(this, this);
        if (realtimeSocket == null) {
            realtimeSocket = new VoiceRealtimeSocket(this, handler, new VoiceRealtimeSocket.Listener() {
                @Override public void onOpen() {
                    if (!stopping && !"sending".equals(state) && !"speaking".equals(state)) {
                        publish("listening", null);
                        startListening();
                    }
                }
                @Override public void onMessage(String text) { handleServerMessage(text); }
                @Override public void onReconnecting(@Nullable String reason) {
                    if (!stopping) publish("reconnecting", reason);
                }
            });
        }
        publish("connecting", null);
        realtimeSocket.start(wsUrl, token, sessionId);
    }

    private void handleServerMessage(String text) {
        try {
            JSONObject message = new JSONObject(text);
            if (realtimeSocket != null) realtimeSocket.captureCursor(message);
            String type = message.optString("type");
            if ("pong".equals(type) || "resume:ack".equals(type) || "result".equals(type)) return;
            if ("resync_required".equals(type)) {
                if (message.has("sessionId") && !sessionId.equals(message.optString("sessionId"))) return;
                if (realtimeSocket != null) {
                    realtimeSocket.clearCursor();
                    realtimeSocket.sendResume();
                }
                responseText = "";
                responseMessageId = null;
                publish("reconnecting", "会话流已重新同步");
                return;
            }
            if ("error".equals(type)) {
                publish("error", message.optString("message", "实时对话请求失败"));
                handler.post(() -> { if (!stopping && realtimeSocket != null && realtimeSocket.isOpen()) startListening(); });
                return;
            }
            if (!"session:update".equals(type) && !"session:done".equals(type)) return;
            if (!sessionId.equals(message.optString("sessionId"))) return;
            if ("session:update".equals(type)) {
                JSONObject data = message.optJSONObject("data");
                if (data == null) return;
                if (!"agent".equals(data.optString("role")) || isLifecycleUpdate(data)) return;
                String messageId = data.optString("messageId", "");
                if (!messageId.isEmpty() && !messageId.equals(responseMessageId)) {
                    responseMessageId = messageId;
                    responseText = "";
                }
                if (data.has("contentDelta")) responseText += data.optString("contentDelta", "");
                else if (data.has("content")) responseText = data.optString("content", responseText);
                return;
            }
            if (!"sending".equals(state)) return;
            publish("speaking", null);
            speak(responseText.trim());
        } catch (org.json.JSONException error) {
            publish("error", "收到无效的实时消息");
        }
    }

    private void startListening() {
        if (stopping || realtimeSocket == null || !realtimeSocket.isOpen() || !ttsReady || "sending".equals(state) || "speaking".equals(state)) return;
        if (recognizer != null) recognizer.destroy();
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(this);
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.SIMPLIFIED_CHINESE.toLanguageTag());
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        publish("listening", null);
        recognizer.startListening(intent);
    }

    private void sendPrompt(String content) {
        if (realtimeSocket == null || content.trim().isEmpty() || stopping) return;
        if ("sending".equals(state) || "speaking".equals(state)) return;
        if (recognizer != null) { recognizer.cancel(); recognizer.destroy(); recognizer = null; }
        responseText = "";
        responseMessageId = null;
        publish("sending", content.trim());
        if (!realtimeSocket.sendPrompt(content.trim())) fail("发送语音 Prompt 失败");
    }

    private void speak(String content) {
        if (content.isEmpty()) {
            publish("listening", null);
            handler.postDelayed(this::startListening, LISTEN_AFTER_SPEAK_MS);
            return;
        }
        if (textToSpeech == null || !ttsReady) {
            publish("error", "系统 TTS 不可用");
            handler.postDelayed(this::startListening, LISTEN_AFTER_SPEAK_MS);
            return;
        }
        textToSpeech.speak(content, TextToSpeech.QUEUE_FLUSH, null, "voice-reply");
        publish("speaking", content);
    }

    private void saveAudioRoute() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(EXTRA_AUDIO_ROUTE, audioRoute)
            .putString(EXTRA_AUDIO_DEVICE, audioDeviceName)
            .apply();
    }

    private void startForegroundNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "实时对话", NotificationManager.IMPORTANCE_LOW));
        }
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pending = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("实时对话运行中")
            .setContentText("正在监听指定 Agent")
            .setOngoing(true)
            .setContentIntent(pending)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void publish(String nextState, @Nullable String message) {
        state = nextState;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("state", nextState).apply();
        Intent intent = new Intent(ACTION_STATUS);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_STATE, nextState);
        if (message != null) intent.putExtra(EXTRA_MESSAGE, message);
        intent.putExtra("enabled", getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(PREF_ENABLED, false));
        intent.putExtra(EXTRA_AUDIO_ROUTE, audioRoute);
        intent.putExtra(EXTRA_AUDIO_DEVICE, audioDeviceName);
        sendBroadcast(intent);
    }

    private void fail(String message) {
        publish("error", message);
    }

    private boolean isLifecycleUpdate(JSONObject data) {
        String eventType = data.optString("eventType", "");
        return eventType.startsWith("lifecycle.");
    }

    private void disableAndStop() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(PREF_ENABLED, false).apply();
        stopping = true;
        if (recognizer != null) { recognizer.cancel(); recognizer.destroy(); recognizer = null; }
        if (textToSpeech != null) { textToSpeech.stop(); textToSpeech.shutdown(); textToSpeech = null; }
        if (realtimeSocket != null) realtimeSocket.stop();
        if (audioManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) audioManager.clearCommunicationDevice();
        else if (audioManager != null) {
            audioManager.setBluetoothScoOn(false);
            audioManager.stopBluetoothSco();
            audioManager.setSpeakerphoneOn(false);
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        publish("disabled", null);
        stopSelf();
    }

    @Override public void onDestroy() {
        stopping = true;
        handler.removeCallbacksAndMessages(null);
        if (realtimeSocket != null) realtimeSocket.stop();
        if (recognizer != null) recognizer.destroy();
        if (textToSpeech != null) textToSpeech.shutdown();
        if (audioManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) audioManager.clearCommunicationDevice();
        else if (audioManager != null) {
            audioManager.setBluetoothScoOn(false);
            audioManager.stopBluetoothSco();
            audioManager.setSpeakerphoneOn(false);
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
    @Nullable @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onInit(int status) {
        ttsReady = status == TextToSpeech.SUCCESS;
        if (!ttsReady) { fail("系统 TTS 不可用"); return; }
        textToSpeech.setLanguage(Locale.SIMPLIFIED_CHINESE);
        textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String utteranceId) { }
            @Override public void onDone(String utteranceId) { handler.postDelayed(() -> { if (!stopping) startListening(); }, LISTEN_AFTER_SPEAK_MS); }
            @Override public void onError(String utteranceId) { handler.postDelayed(() -> { if (!stopping) startListening(); }, LISTEN_AFTER_SPEAK_MS); }
        });
        startListening();
    }

    @Override public void onReadyForSpeech(android.os.Bundle params) { publish("listening", null); }
    @Override public void onBeginningOfSpeech() { }
    @Override public void onRmsChanged(float rmsdB) { }
    @Override public void onBufferReceived(byte[] buffer) { }
    @Override public void onEndOfSpeech() { }
    @Override public void onError(int error) { if (!stopping && !"sending".equals(state) && !"speaking".equals(state)) { publish("reconnecting", "语音识别暂时不可用"); handler.postDelayed(this::startListening, LISTEN_RETRY_MS); } }
    @Override public void onResults(android.os.Bundle results) { ArrayList<String> values = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION); if (values != null && !values.isEmpty()) sendPrompt(values.get(0)); }
    @Override public void onPartialResults(android.os.Bundle partialResults) { }
    @Override public void onEvent(int eventType, android.os.Bundle params) { }
}
