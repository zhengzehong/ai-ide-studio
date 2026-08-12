package com.aiidestudio.mobile;

import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;

/** Selects a communication route without making Bluetooth a hard dependency. */
public final class VoiceAudioRouter {
    public static final String ROUTE_BLUETOOTH = "bluetooth";
    public static final String ROUTE_WIRED = "wired";
    public static final String ROUTE_SPEAKER = "speaker";
    public static final String ROUTE_UNKNOWN = "unknown";

    public static final class Result {
        public final String route;
        public final String deviceName;

        private Result(String route, String deviceName) {
            this.route = route;
            this.deviceName = deviceName;
        }
    }

    private VoiceAudioRouter() { }

    public static Result apply(AudioManager audioManager) {
        if (audioManager == null) return result(ROUTE_UNKNOWN, "");
        audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? applyModern(audioManager)
            : applyLegacy(audioManager);
    }

    private static Result applyModern(AudioManager audioManager) {
        AudioDeviceInfo speaker = null;
        try {
            for (AudioDeviceInfo device : audioManager.getAvailableCommunicationDevices()) {
                String route = routeFor(device.getType());
                if (ROUTE_BLUETOOTH.equals(route) || ROUTE_WIRED.equals(route)) {
                    try {
                        if (audioManager.setCommunicationDevice(device)) {
                            return result(route, productName(device));
                        }
                    } catch (SecurityException ignored) {
                        // A denied Bluetooth permission should still reach the speaker fallback.
                    }
                } else if (ROUTE_SPEAKER.equals(route)) {
                    speaker = device;
                }
            }
            if (speaker != null && audioManager.setCommunicationDevice(speaker)) {
                return result(ROUTE_SPEAKER, productName(speaker));
            }
        } catch (SecurityException ignored) {
            // Device enumeration itself can be denied when Bluetooth permission is absent.
        }

        // Some vendor ROMs omit the built-in speaker from the communication list.
        try {
            audioManager.clearCommunicationDevice();
            audioManager.setSpeakerphoneOn(true);
            return result(ROUTE_SPEAKER, "手机扬声器");
        } catch (RuntimeException ignored) {
            return result(ROUTE_UNKNOWN, "");
        }
    }

    private static Result applyLegacy(AudioManager audioManager) {
        try {
            for (AudioDeviceInfo device : audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                String route = routeFor(device.getType());
                if (ROUTE_BLUETOOTH.equals(route) && audioManager.isBluetoothScoAvailableOffCall()) {
                    audioManager.startBluetoothSco();
                    audioManager.setBluetoothScoOn(true);
                    return result(ROUTE_BLUETOOTH, productName(device));
                }
                if (ROUTE_WIRED.equals(route)) {
                    audioManager.setSpeakerphoneOn(false);
                    return result(ROUTE_WIRED, productName(device));
                }
            }
        } catch (RuntimeException ignored) {
            // Continue to the phone speaker fallback.
        }
        try {
            audioManager.setSpeakerphoneOn(true);
            return result(ROUTE_SPEAKER, "手机扬声器");
        } catch (RuntimeException ignored) {
            return result(ROUTE_UNKNOWN, "");
        }
    }

    private static String routeFor(int type) {
        if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
            || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET)) {
            return ROUTE_BLUETOOTH;
        }
        if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
            || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_USB_HEADSET)) {
            return ROUTE_WIRED;
        }
        if (type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return ROUTE_SPEAKER;
        return ROUTE_UNKNOWN;
    }

    private static String productName(AudioDeviceInfo device) {
        CharSequence name = device.getProductName();
        return name == null || name.length() == 0 ? "" : name.toString();
    }

    private static Result result(String route, String deviceName) {
        return new Result(route, deviceName == null ? "" : deviceName);
    }
}
