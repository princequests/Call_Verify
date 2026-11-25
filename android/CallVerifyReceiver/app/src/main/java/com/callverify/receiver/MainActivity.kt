
package com.callverify.receiver

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.telephony.TelephonyManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private val executor = Executors.newSingleThreadExecutor()

    private lateinit var apiStatus: TextView
    private lateinit var receiverStatus: TextView
    private lateinit var callStatus: TextView

    private var receiverRegistered = false

    private val apiUrl =
        "http://192.168.100.7:3000/v1/health"

    companion object {
        private const val PHONE_PERMISSION_REQUEST = 100
    }

    private val phoneStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {

            if (intent?.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) {
                return
            }

            val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE)

            when (state) {
                TelephonyManager.EXTRA_STATE_RINGING -> {
                    updateCallStatus("INCOMING CALL DETECTED", Color.rgb(20, 140, 75))
                }

                TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                    updateCallStatus("CALL ACTIVE / ANSWERED", Color.rgb(30, 100, 200))
                }

                TelephonyManager.EXTRA_STATE_IDLE -> {
                    updateCallStatus("NO ACTIVE CALL", Color.DKGRAY)
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
            setBackgroundColor(Color.rgb(247, 248, 250))
        }

        val title = TextView(this).apply {
            text = "CallVerify"
            textSize = 30f
            setTextColor(Color.rgb(25, 35, 50))
        }

        val subtitle = TextView(this).apply {
            text = "Android Receiving Station"
            textSize = 15f
            setTextColor(Color.GRAY)
            setPadding(0, 8, 0, 35)
        }

        apiStatus = TextView(this).apply {
            text = "API: Checking connection..."
            textSize = 17f
            setTextColor(Color.DKGRAY)
            setPadding(0, 20, 0, 20)
        }

        val phone = TextView(this).apply {
            text = "Dedicated number\n+234 813 878 4705"
            textSize = 18f
            setTextColor(Color.DKGRAY)
            setPadding(0, 20, 0, 20)
        }

        receiverStatus = TextView(this).apply {
            text = "SIM Receiver: Checking permission..."
            textSize = 16f
            setTextColor(Color.GRAY)
            setPadding(0, 20, 0, 20)
        }

        callStatus = TextView(this).apply {
            text = "Call status: Waiting for permission"
            textSize = 17f
            setTextColor(Color.DKGRAY)
            setPadding(0, 20, 0, 20)
        }

        val notice = TextView(this).apply {
            text = "Keep this app open during the initial call detection test."
            textSize = 14f
            setTextColor(Color.DKGRAY)
            setPadding(0, 24, 0, 24)
        }

        val testButton = Button(this).apply {
            text = "Test API Connection"
            setOnClickListener { checkApi() }
        }

        layout.addView(title)
        layout.addView(subtitle)
        layout.addView(apiStatus)
        layout.addView(phone)
        layout.addView(receiverStatus)
        layout.addView(callStatus)
        layout.addView(notice)
        layout.addView(testButton)

        setContentView(layout)

        checkApi()
        requestPhonePermission()
    }

    private fun requestPhonePermission() {
        if (
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.READ_PHONE_STATE
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            startListening()
        } else {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.READ_PHONE_STATE),
                PHONE_PERMISSION_REQUEST
            )
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)

        if (requestCode == PHONE_PERMISSION_REQUEST) {
            if (
                grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED
            ) {
                startListening()
            } else {
                receiverStatus.text = "SIM Receiver: Permission denied"
                callStatus.text = "Call status: Cannot monitor calls"
            }
        }
    }

    private fun startListening() {
        if (receiverRegistered) return

        val filter = IntentFilter(
            TelephonyManager.ACTION_PHONE_STATE_CHANGED
        )

        ContextCompat.registerReceiver(
            this,
            phoneStateReceiver,
            filter,
            ContextCompat.RECEIVER_EXPORTED
        )

        receiverRegistered = true

        receiverStatus.text = "SIM Receiver: Permission granted"
        receiverStatus.setTextColor(Color.rgb(20, 140, 75))

        callStatus.text = "Call status: Waiting for incoming call"
    }

    private fun updateCallStatus(message: String, color: Int) {
        runOnUiThread {
            callStatus.text = "Call status: $message"
            callStatus.setTextColor(color)
        }
    }

    private fun checkApi() {
        apiStatus.text = "API: Checking connection..."

        executor.execute {
            val result = try {
                val connection =
                    URL(apiUrl).openConnection() as HttpURLConnection

                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                connection.requestMethod = "GET"

                val successful = connection.responseCode == 200
                connection.disconnect()

                if (successful) {
                    "API: Connected"
                } else {
                    "API: Server error"
                }
            } catch (e: Exception) {
                "API: Connection failed - ${e.message}"
            }

            runOnUiThread {
                apiStatus.text = result
                apiStatus.setTextColor(
                    if (result == "API: Connected") {
                        Color.rgb(20, 140, 75)
                    } else {
                        Color.RED
                    }
                )
            }
        }
    }

    override fun onDestroy() {
        if (receiverRegistered) {
            unregisterReceiver(phoneStateReceiver)
            receiverRegistered = false
        }

        executor.shutdown()
        super.onDestroy()
    }
}
