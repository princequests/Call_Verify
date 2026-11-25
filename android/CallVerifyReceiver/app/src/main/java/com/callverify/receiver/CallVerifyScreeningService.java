
package com.callverify.receiver;

import android.net.Uri;
import android.telecom.Call;
import android.telecom.CallScreeningService;
import android.util.Log;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class CallVerifyScreeningService extends CallScreeningService {

    private static final String TAG = "CallVerify";

    // Your PC's Wi-Fi IP address.
    private static final String API_URL =
            "http://192.168.100.7:3000/v1/device/events";

    // Replace this with the DEVICE_KEY from your server .env file.
    // Keep this key private.
    private static final String DEVICE_KEY =
            "CV_TEMP_7f9c2a84b6d13e50a9c7f42d8e6b31a5";

    // Keep network requests short so Android can receive a response in time.
    private static final int CONNECT_TIMEOUT = 2000;
    private static final int READ_TIMEOUT = 2000;

    private final ExecutorService executor =
            Executors.newCachedThreadPool();

    @Override
    public void onScreenCall(Call.Details callDetails) {

        Uri handle = callDetails.getHandle();

        String callerNumber = "";

        if (handle != null) {
            callerNumber = handle.getSchemeSpecificPart();
        }

        Log.d(TAG, "Incoming call screening callback received");

        if (callerNumber == null || callerNumber.trim().isEmpty()) {
            Log.w(TAG, "Caller number unavailable. Allowing call.");

            respondAllow(callDetails);
            return;
        }

        final String numberToSend = callerNumber;

        /*
         * Do not immediately allow the call.
         * First ask the backend whether this is a verified
         * CallVerify session.
         *
         * If the backend cannot confirm quickly, allow the call.
         */
        executor.execute(() -> {

            boolean verified = sendIncomingCallEvent(numberToSend);

            if (verified) {
                Log.d(TAG, "CallVerify match confirmed. Rejecting call.");

                respondReject(callDetails);
            } else {
                Log.d(TAG, "No verified session. Allowing call.");

                respondAllow(callDetails);
            }
        });
    }

    private boolean sendIncomingCallEvent(String callerNumber) {

        HttpURLConnection connection = null;

        try {
            URL url = new URL(API_URL);

            connection = (HttpURLConnection) url.openConnection();

            connection.setRequestMethod("POST");
            connection.setConnectTimeout(CONNECT_TIMEOUT);
            connection.setReadTimeout(READ_TIMEOUT);
            connection.setDoOutput(true);

            connection.setRequestProperty(
                    "Content-Type",
                    "application/json"
            );

            connection.setRequestProperty(
                    "Authorization",
                    "Bearer " + DEVICE_KEY
            );

            JSONObject payload = new JSONObject();

            payload.put("type", "incoming_call_ringing");
            payload.put("callerNumber", callerNumber);
            payload.put(
                    "deviceId",
                    "callverify-android-receiver"
            );

            byte[] body = payload.toString()
                    .getBytes(StandardCharsets.UTF_8);

            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
                output.flush();
            }

            int responseCode = connection.getResponseCode();

            Log.d(
                    TAG,
                    "CallVerify API response: " + responseCode
            );

            if (responseCode != 202) {
                Log.w(
                        TAG,
                        "Backend did not accept call event. Allowing call."
                );

                return false;
            }

            InputStream input = connection.getInputStream();

            StringBuilder responseText = new StringBuilder();

            try (InputStream stream = input) {
                byte[] buffer = new byte[1024];
                int bytesRead;

                while ((bytesRead = stream.read(buffer)) != -1) {
                    responseText.append(
                            new String(
                                    buffer,
                                    0,
                                    bytesRead,
                                    StandardCharsets.UTF_8
                            )
                    );
                }
            }

            JSONObject response = new JSONObject(
                    responseText.toString()
            );

            boolean matched = response.optBoolean(
                    "matched",
                    false
            );

            String status = response.optString(
                    "status",
                    ""
            );

            /*
             * Reject only when the backend explicitly confirms
             * both a caller match and verified status.
             */
            return matched && "verified".equals(status);

        } catch (Exception e) {

            Log.e(
                    TAG,
                    "Could not confirm caller with backend. Allowing call.",
                    e
            );

            return false;

        } finally {

            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void respondAllow(Call.Details callDetails) {

        CallResponse response = new CallResponse.Builder()
                .setDisallowCall(false)
                .setRejectCall(false)
                .setSkipCallLog(false)
                .setSkipNotification(false)
                .build();

        respondToCall(callDetails, response);
    }

    private void respondReject(Call.Details callDetails) {

        CallResponse response = new CallResponse.Builder()
                .setDisallowCall(true)
                .setRejectCall(true)
                .setSkipCallLog(true)
                .setSkipNotification(true)
                .build();

        respondToCall(callDetails, response);
    }

    @Override
    public void onDestroy() {
        executor.shutdown();
        super.onDestroy();
    }
}
