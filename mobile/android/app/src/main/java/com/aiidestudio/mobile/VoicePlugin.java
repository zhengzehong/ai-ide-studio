package com.aiidestudio.mobile;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;

@CapacitorPlugin(
    name = "Voice",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class VoicePlugin extends Plugin {
    private BroadcastReceiver statusReceiver;

    @Override public void load() {
        statusReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                JSObject data = new JSObject();
                data.put("state", intent.getStringExtra(VoiceForegroundService.EXTRA_STATE));
                data.put("message", intent.getStringExtra(VoiceForegroundService.EXTRA_MESSAGE));
                data.put("audioRoute", intent.getStringExtra(VoiceForegroundService.EXTRA_AUDIO_ROUTE));
                data.put("audioDevice", intent.getStringExtra(VoiceForegroundService.EXTRA_AUDIO_DEVICE));
                if (intent.hasExtra("enabled")) data.put("enabled", intent.getBooleanExtra("enabled", false));
                notifyListeners("status", data);
            }
        };
        IntentFilter filter = new IntentFilter(VoiceForegroundService.ACTION_STATUS);
        ContextCompat.registerReceiver(getContext(), statusReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @PluginMethod public void getStatus(PluginCall call) {
        org.json.JSONObject status = VoiceForegroundService.status(getContext());
        JSObject result = new JSObject();
        result.put("enabled", status.optBoolean("enabled", false));
        result.put("state", status.optString("state", "disabled"));
        result.put("projectId", status.optString("projectId", null));
        result.put("agentId", status.optString("agentId", null));
        result.put("sessionId", status.optString("sessionId", null));
        result.put("audioRoute", status.optString("audioRoute", VoiceAudioRouter.ROUTE_UNKNOWN));
        result.put("audioDevice", status.optString("audioDevice", ""));
        call.resolve(result);
    }

    @PluginMethod public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAliases(new String[] { "microphone", "notifications" }, call, "microphonePermissionCallback");
            return;
        }
        requestOptionalBluetooth(call);
    }

    @PermissionCallback private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("需要麦克风权限才能开启实时对话");
            return;
        }
        requestOptionalBluetooth(call);
    }

    private void requestOptionalBluetooth(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || getPermissionState("bluetooth") == PermissionState.GRANTED) {
            startService(call);
            return;
        }
        // 蓝牙只是音频路由优化。拒绝后仍继续启动，原生服务会回退到手机音频。
        requestPermissionForAliases(new String[] { "bluetooth" }, call, "bluetoothPermissionCallback");
    }

    @PermissionCallback private void bluetoothPermissionCallback(PluginCall call) {
        startService(call);
    }

    private void startService(PluginCall call) {
        String wsUrl = call.getString("wsUrl");
        String token = call.getString("token", "");
        String sessionId = call.getString("sessionId");
        String projectId = call.getString("projectId");
        String agentId = call.getString("agentId");
        if (wsUrl == null || sessionId == null || projectId == null || agentId == null) {
            call.reject("实时对话缺少目标配置");
            return;
        }
        Intent intent = new Intent(getContext(), VoiceForegroundService.class)
            .setAction(VoiceForegroundService.ACTION_START)
            .putExtra(VoiceForegroundService.EXTRA_WS_URL, wsUrl)
            .putExtra(VoiceForegroundService.EXTRA_TOKEN, token)
            .putExtra(VoiceForegroundService.EXTRA_SESSION_ID, sessionId)
            .putExtra(VoiceForegroundService.EXTRA_PROJECT_ID, projectId)
            .putExtra(VoiceForegroundService.EXTRA_AGENT_ID, agentId);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ContextCompat.startForegroundService(getContext(), intent);
        else getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod public void stop(PluginCall call) {
        VoiceForegroundService.markDisabled(getContext());
        getContext().stopService(new Intent(getContext(), VoiceForegroundService.class));
        call.resolve();
    }

    @Override protected void handleOnDestroy() {
        if (statusReceiver != null) getContext().unregisterReceiver(statusReceiver);
        super.handleOnDestroy();
    }
}
