package channelhop  // change to your app's package

import android.content.Context
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.security.KeyFactory
import java.security.Principal
import java.security.PrivateKey
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509ExtendedKeyManager
import javax.net.ssl.X509TrustManager

/**
 * ChannelHop: tunes a channel on a set-top box (here Airtel's Xstream IPTV box) over the Android TV
 * Remote protocol v2, the one Google's phone remote uses: TLS on port 6466 with a client certificate
 * the box accepted once (paired from a computer with androidtvremote2), and small protobuf messages.
 *
 * Airtel's TV app takes only the first number key as a key press; the rest of the number goes in as
 * text a moment later, once its number box is open. So: Home (back to Airtel's own TV app, out of
 * any app "channel"), the first digit, then the rest as text. One tune at a time; each opens its
 * own connection.
 *
 * The box's address, certificate and key come in as "box_b64": base64 JSON {host, cert, key},
 * key as PKCS#8 PEM (print it with `tools/channelhop.py couch-tv`), and live in this app's private settings only.
 */
object BoxRemote {
    private const val TAG = "channelhop"
    private const val PORT = 6466
    private const val PREF = "box_remote"
    private const val KEY_HOME = 3
    private const val KEY_0 = 7
    private const val KEY_WAKEUP = 224
    private const val SHORT = 3
    // ping, keys, input method, power, volume, app links (what androidtvremote2 asks for)
    private const val FEATURES = 1 or 2 or 4 or 32 or 64 or 512

    private val busy = AtomicBoolean(false)

    fun readExtras(c: Context, b64: String?) {
        if (b64 == null) return
        val e = c.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
        if (b64.isBlank() || b64 == "none") { e.clear().apply(); return }
        try {
            val j = JSONObject(String(Base64.decode(b64, Base64.DEFAULT), Charsets.UTF_8))
            val host = j.getString("host").trim()
            if (!Regex("^[0-9A-Za-z.:-]{1,64}$").matches(host)) return
            loadCert(j.getString("cert")); loadKey(j.getString("key"))   // refuse anything that does not parse
            e.putString("host", host).putString("cert", j.getString("cert")).putString("key", j.getString("key")).apply()
        } catch (x: Exception) {
            Log.w(TAG, "box remote: settings refused: $x")
        }
    }

    fun ready(c: Context): Boolean = c.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString("host", null) != null

    /** Starts tuning in the background. False: no box set up, a bad number, or a tune still running. */
    fun tune(c: Context, number: String, done: (Boolean) -> Unit): Boolean {
        if (!Regex("^[0-9]{1,5}$").matches(number)) return false
        val p = c.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        val host = p.getString("host", null) ?: return false
        val cert = p.getString("cert", null) ?: return false
        val key = p.getString("key", null) ?: return false
        if (!busy.compareAndSet(false, true)) return false
        Thread {
            var ok = false
            try {
                ok = Session(host, loadCert(cert), loadKey(key)).use { it.tune(number) }
            } catch (x: Exception) {
                Log.w(TAG, "box remote: tune $number failed: $x")
            } finally {
                busy.set(false)
                done(ok)
            }
        }.apply { isDaemon = true; name = "box-remote" }.start()
        return true
    }

    private fun loadCert(pem: String): X509Certificate =
        CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(pem.toByteArray())) as X509Certificate

    private fun loadKey(pem: String): PrivateKey {
        val body = pem.replace(Regex("-----[A-Z ]+-----"), "").replace(Regex("\\s"), "")
        return KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(Base64.decode(body, Base64.DEFAULT)))
    }

    private class Session(host: String, private val cert: X509Certificate, private val key: PrivateKey) : AutoCloseable {
        private val socket: SSLSocket
        private val out: OutputStream
        private val lock = Object()
        @Volatile private var active = false
        @Volatile private var closed = false
        @Volatile private var imeCounter = 0L
        @Volatile private var fieldCounter = 0L
        @Volatile private var imeEdits = 0

        init {
            val km = object : X509ExtendedKeyManager() {
                override fun getClientAliases(t: String?, i: Array<out Principal>?) = arrayOf("c")
                override fun chooseClientAlias(t: Array<out String>?, i: Array<out Principal>?, s: Socket?) = "c"
                override fun getServerAliases(t: String?, i: Array<out Principal>?) = null
                override fun chooseServerAlias(t: String?, i: Array<out Principal>?, s: Socket?) = null
                override fun getCertificateChain(a: String?) = arrayOf(cert)
                override fun getPrivateKey(a: String?) = key
            }
            // the box's own certificate is self-signed; this only ever talks to the address apply.sh set
            val tm = object : X509TrustManager {
                override fun checkClientTrusted(c: Array<out X509Certificate>?, a: String?) {}
                override fun checkServerTrusted(c: Array<out X509Certificate>?, a: String?) {}
                override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
            }
            val ctx = SSLContext.getInstance("TLS")
            ctx.init(arrayOf(km), arrayOf<TrustManager>(tm), null)
            val s = ctx.socketFactory.createSocket() as SSLSocket
            s.connect(InetSocketAddress(host, PORT), 4000)
            s.soTimeout = 30000
            s.startHandshake()
            socket = s
            out = s.outputStream
            Thread { readLoop(s.inputStream) }.apply { isDaemon = true; name = "box-remote-read" }.start()
        }

        fun tune(number: String): Boolean {
            if (!waitFor(6000) { active }) { Log.w(TAG, "box remote: the box did not get ready"); return false }
            key(KEY_WAKEUP); pause(300)
            key(KEY_HOME); pause(1500)
            // Airtel's box opens its number box on the first digit but never reports it (no IME
            // batch edit arrives), and number keys after the first are dropped; the rest typed as
            // text goes in (tested on the box, 14 Nov 2026). Counters stay 0 unless the box sends some.
            key(KEY_0 + (number[0] - '0'))
            val rest = number.substring(1)
            if (rest.isNotEmpty()) {
                pause(800)
                text(rest)
            }
            pause(1200)
            Log.i(TAG, "box remote: tuned $number")
            return !closed
        }

        private fun pause(ms: Long) = Thread.sleep(ms)

        private fun waitFor(ms: Long, cond: () -> Boolean): Boolean {
            val end = System.currentTimeMillis() + ms
            while (System.currentTimeMillis() < end) {
                if (cond()) return true
                if (closed) return false
                Thread.sleep(50)
            }
            return cond()
        }

        private fun key(code: Int) = send(msg(10, Pb().v(1, code.toLong()).v(2, SHORT.toLong())))

        private fun text(t: String) {
            val obj = Pb().v(1, (t.length - 1).toLong()).v(2, (t.length - 1).toLong()).s(3, t)
            val edit = Pb().v(1, 1).m(2, obj)
            send(msg(21, Pb().v(1, imeCounter).v(2, fieldCounter).m(3, edit)))
        }

        private fun msg(field: Int, body: Pb): ByteArray = Pb().m(field, body).bytes()

        private fun send(b: ByteArray) {
            synchronized(lock) {
                val o = ByteArrayOutputStream()
                Pb.varint(o, b.size.toLong())
                o.write(b)
                out.write(o.toByteArray())
                out.flush()
            }
        }

        private fun readLoop(input: InputStream) {
            try {
                while (!closed) {
                    val len = Pb.readVarint(input) ?: break
                    if (len < 0 || len > 1 shl 20) break
                    val buf = ByteArray(len.toInt())
                    var n = 0
                    while (n < buf.size) { val r = input.read(buf, n, buf.size - n); if (r < 0) throw java.io.EOFException(); n += r }
                    handle(buf)
                }
            } catch (_: Exception) {
            } finally {
                closed = true
            }
        }

        private fun handle(b: ByteArray) {
            Pb.parse(b) { field, _, value, raw ->
                when (field) {
                    1 -> {   // remote_configure: answer with what both sides can do
                        var supported = 0L
                        raw?.let { Pb.parse(it) { f, _, v, _ -> if (f == 1) supported = v } }
                        val info = Pb().v(3, 1).s(4, "1").s(5, "atvremote").s(6, "1.0.0")
                        send(msg(1, Pb().v(1, FEATURES.toLong() and supported).m(2, info)))
                    }
                    2 -> { send(msg(2, Pb().v(1, FEATURES.toLong()))); active = true }   // remote_set_active
                    8 -> {   // remote_ping_request
                        var v1 = 0L
                        raw?.let { Pb.parse(it) { f, _, v, _ -> if (f == 1) v1 = v } }
                        send(msg(9, Pb().v(1, v1)))
                    }
                    21 -> {   // remote_ime_batch_edit: an input box opened (Airtel's number box)
                        raw?.let { Pb.parse(it) { f, _, v, _ -> if (f == 1) imeCounter = v else if (f == 2) fieldCounter = v } }
                        imeEdits++
                    }
                }
            }
        }

        override fun close() {
            closed = true
            try { socket.close() } catch (_: Exception) {}
        }
    }

    /** Just enough protobuf: varints, strings and nested messages; proto3 leaves out zero numbers. */
    private class Pb {
        private val o = ByteArrayOutputStream()
        fun v(field: Int, value: Long): Pb { if (value != 0L) { varint(o, (field shl 3).toLong()); varint(o, value) }; return this }
        fun s(field: Int, value: String): Pb = raw(field, value.toByteArray(Charsets.UTF_8))
        fun m(field: Int, value: Pb): Pb = raw(field, value.bytes())
        private fun raw(field: Int, b: ByteArray): Pb { varint(o, ((field shl 3) or 2).toLong()); varint(o, b.size.toLong()); o.write(b); return this }
        fun bytes(): ByteArray = o.toByteArray()

        companion object {
            fun varint(o: ByteArrayOutputStream, value: Long) {
                var v = value
                while (true) {
                    if (v and 0x7FL.inv() == 0L) { o.write(v.toInt()); return }
                    o.write(((v and 0x7F) or 0x80).toInt())
                    v = v ushr 7
                }
            }

            fun readVarint(i: InputStream): Long? {
                var shift = 0
                var result = 0L
                while (shift < 64) {
                    val b = i.read()
                    if (b < 0) return null
                    result = result or ((b and 0x7F).toLong() shl shift)
                    if (b and 0x80 == 0) return result
                    shift += 7
                }
                return null
            }

            /** Calls back with (field, wire type, varint value, bytes of a length-delimited field). */
            fun parse(b: ByteArray, each: (Int, Int, Long, ByteArray?) -> Unit) {
                var p = 0
                fun vr(): Long {
                    var shift = 0; var r = 0L
                    while (true) {
                        val x = b[p++].toInt() and 0xFF
                        r = r or ((x and 0x7F).toLong() shl shift)
                        if (x and 0x80 == 0) return r
                        shift += 7
                    }
                }
                while (p < b.size) {
                    val tag = vr()
                    val field = (tag ushr 3).toInt()
                    when (val wt = (tag and 7).toInt()) {
                        0 -> each(field, wt, vr(), null)
                        2 -> { val n = vr().toInt(); val r = b.copyOfRange(p, p + n); p += n; each(field, wt, 0, r) }
                        1 -> p += 8
                        5 -> p += 4
                        else -> return
                    }
                }
            }
        }
    }
}
