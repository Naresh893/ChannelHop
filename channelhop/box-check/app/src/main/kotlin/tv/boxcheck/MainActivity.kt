package tv.boxcheck

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.media.tv.TvContract
import android.media.tv.TvInputManager
import android.net.ConnectivityManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.accessibility.AccessibilityManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.net.Inet4Address
import java.net.ServerSocket
import kotlin.concurrent.thread

/**
 * Read-only check of what this TV box allows. It changes nothing: it only reads and shows.
 * While open, the same report is also served at http://<box-ip>:8090/ on the home network.
 */
class MainActivity : Activity() {

    private lateinit var out: TextView
    @Volatile private var report = ""
    private var server: ServerSocket? = null

    private val epgPerms = arrayOf("com.android.providers.tv.permission.READ_EPG_DATA")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (24 * resources.displayMetrics.density).toInt()

        val title = TextView(this).apply {
            text = "Box Check  ·  read-only, changes nothing"
            setTextColor(Color.WHITE); textSize = 22f; setTypeface(typeface, Typeface.BOLD)
        }
        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.START }
        fun btn(label: String, onClick: () -> Unit) = Button(this).apply {
            text = label; isAllCaps = false; textSize = 15f
            setOnClickListener { onClick() }
            buttons.addView(this)
        }
        btn("Refresh") { refresh() }
        btn("Accessibility settings") { openSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS) }
        btn("Home app settings") { openSettings(Settings.ACTION_HOME_SETTINGS) }
        btn("Developer options") { openSettings(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS) }

        out = TextView(this).apply {
            setTextColor(Color.parseColor("#e8e8e8")); textSize = 15f
            typeface = Typeface.MONOSPACE; setTextIsSelectable(false)
        }
        val scroll = ScrollView(this).apply {
            isFocusable = true; isFocusableInTouchMode = true
            setBackgroundColor(Color.parseColor("#111111"))
            setPadding(pad / 2, pad / 2, pad / 2, pad / 2)
            addView(out)
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad)
            addView(title); addView(buttons)
            addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        setContentView(root)
        scroll.requestFocus()

        startServer()
        if (Build.VERSION.SDK_INT >= 23 && epgPerms.any { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }) {
            try { requestPermissions(epgPerms, 1) } catch (_: Throwable) {}
        }
        refresh()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        refresh()
    }

    override fun onResume() { super.onResume(); if (::out.isInitialized) refresh() }

    override fun onDestroy() {
        try { server?.close() } catch (_: Throwable) {}
        super.onDestroy()
    }

    private fun openSettings(action: String) {
        try { startActivity(Intent(action)) }
        catch (e: Throwable) { out.text = "Could not open that screen on this box (${e.javaClass.simpleName}).\n\n$report" }
    }

    private fun refresh() {
        out.text = "Checking…"
        thread {
            val r = try { build() } catch (e: Throwable) { "Check failed: $e" }
            report = r
            runOnUiThread { out.text = r }
        }
    }

    // ---------------------------------------------------------------- report

    private val pm: PackageManager get() = packageManager

    private fun build(): String {
        val sb = StringBuilder()
        fun line(s: String = "") { sb.append(s).append('\n') }

        val tvInputs = tvInputs()
        val homes = homeApps()
        val a11y = a11yState()
        val chans = channels()
        val interesting = interestingPackages(tvInputs.map { it.second } + homes.map { it.first })

        line("SUMMARY")
        line("  Box:            ${Build.MANUFACTURER} ${Build.MODEL}  (${Build.DEVICE})")
        line("  Android:        ${Build.VERSION.RELEASE}  (SDK ${Build.VERSION.SDK_INT})")
        line("  Box address:    ${ip() ?: "?"}   report also at http://${ip() ?: "<box-ip>"}:8090/")
        line("  Install apps:   yes (this app is running)")
        line("  Home apps:      ${homes.size} found  ·  Home chooser screen: ${yesNo(resolves(Settings.ACTION_HOME_SETTINGS))}")
        line("  Accessibility:  screen ${yesNo(resolves(Settings.ACTION_ACCESSIBILITY_SETTINGS))}  ·  our test service listed: ${yesNo(a11y.first)}  ·  switched on: ${yesNo(a11y.second)}")
        line("  Developer opts: ${globalSetting("development_settings_enabled")}  ·  USB/ADB debugging: ${globalSetting("adb_enabled")}")
        line("  TV inputs:      ${tvInputs.size}")
        line("  Channels list:  ${chans.first}")
        line("  Tune handlers:  ${tuneHandlers().ifEmpty { "none" }}")
        line()

        line("HOME APPS (what can be the home screen)")
        val def = pm.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)
        homes.forEach { (pkg, cls) -> line("  $pkg/$cls" + if (def?.activityInfo?.packageName == pkg) "   <- current" else "") }
        line()

        line("TV INPUTS")
        if (tvInputs.isEmpty()) line("  none / not readable")
        tvInputs.forEach { (id, pkg, desc) -> line("  $id\n      app: $pkg   $desc") }
        line()

        line("CHANNELS (first 40)")
        chans.second.take(40).forEach { line("  $it") }
        if (chans.second.isEmpty()) line("  ${chans.first}")
        line()

        line("ACCESSIBILITY SERVICES")
        a11y.third.forEach { line("  $it") }
        line()

        line("APPS THAT LOOK RELEVANT (Airtel / TV / home)")
        interesting.forEach { pkg ->
            line("■ $pkg   ${label(pkg)}   v${version(pkg)}")
            line(manifestSummary(pkg).prependIndent("    "))
        }
        line()

        line("ALL OPENABLE APPS")
        allOpenable().forEach { line("  $it") }
        return sb.toString()
    }

    private fun yesNo(b: Boolean) = if (b) "YES" else "no"

    private fun resolves(action: String) = try {
        Intent(action).resolveActivity(pm) != null
    } catch (_: Throwable) { false }

    private fun globalSetting(key: String) = try {
        when (Settings.Global.getString(contentResolver, key)) { "1" -> "on"; "0" -> "off"; null -> "not set"; else -> "?" }
    } catch (_: Throwable) { "not readable" }

    private fun ip(): String? = try {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        cm.getLinkProperties(cm.activeNetwork)?.linkAddresses
            ?.map { it.address }?.firstOrNull { it is Inet4Address }?.hostAddress
    } catch (_: Throwable) { null }

    private fun label(pkg: String) = try {
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Throwable) { "" }

    private fun version(pkg: String) = try { pm.getPackageInfo(pkg, 0).versionName ?: "?" } catch (_: Throwable) { "?" }

    private fun homeApps(): List<Pair<String, String>> = try {
        pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)
            .map { it.activityInfo.packageName to it.activityInfo.name }
    } catch (_: Throwable) { emptyList() }

    /** (listed, enabled, lines) */
    private fun a11yState(): Triple<Boolean, Boolean, List<String>> = try {
        val am = getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
        val installed = am.installedAccessibilityServiceList
        val enabled = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK).map { it.id }.toSet()
        val mine = ComponentName(this, TestA11y::class.java).flattenToShortString()
        val lines = installed.map { it.id + if (it.id in enabled) "   (on)" else "" }
        Triple(installed.any { it.id == mine }, mine in enabled, lines.ifEmpty { listOf("none listed") })
    } catch (e: Throwable) { Triple(false, false, listOf("not readable: ${e.javaClass.simpleName}")) }

    /** (id, package, description) */
    private fun tvInputs(): List<Triple<String, String, String>> = try {
        val tim = getSystemService(Context.TV_INPUT_SERVICE) as? TvInputManager
        tim?.tvInputList?.map { i ->
            val label = try { i.loadLabel(this).toString() } catch (_: Throwable) { "" }
            Triple(i.id, i.serviceInfo.packageName, "type=${i.type} passthrough=${i.isPassthroughInput} \"$label\"")
        } ?: emptyList()
    } catch (_: Throwable) { emptyList() }

    private fun channels(): Pair<String, List<String>> = try {
        val c = contentResolver.query(
            TvContract.Channels.CONTENT_URI,
            arrayOf(TvContract.Channels._ID, TvContract.Channels.COLUMN_INPUT_ID,
                TvContract.Channels.COLUMN_DISPLAY_NUMBER, TvContract.Channels.COLUMN_DISPLAY_NAME),
            null, null, null)
        if (c == null) "not available" to emptyList()
        else c.use {
            val rows = ArrayList<String>()
            while (it.moveToNext() && rows.size < 400)
                rows += "#${it.getString(2)}  ${it.getString(3)}   (id ${it.getLong(0)}, input ${it.getString(1)})"
            "${it.count} readable" to rows
        }
    } catch (e: SecurityException) { "blocked (no permission)" to emptyList() }
    catch (e: Throwable) { "not available (${e.javaClass.simpleName})" to emptyList() }

    /** Which apps would open a "watch channel" link. */
    private fun tuneHandlers(): String = try {
        val i = Intent(Intent.ACTION_VIEW, TvContract.buildChannelUri(1))
        pm.queryIntentActivities(i, 0).joinToString { it.activityInfo.packageName + "/" + it.activityInfo.name }
    } catch (_: Throwable) { "" }

    private fun allOpenable(): List<String> {
        val seen = LinkedHashMap<String, String>()
        for (cat in listOf("android.intent.category.LEANBACK_LAUNCHER", Intent.CATEGORY_LAUNCHER)) {
            try {
                pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(cat), 0).forEach {
                    seen.getOrPut(it.activityInfo.packageName) { it.loadLabel(pm).toString() }
                }
            } catch (_: Throwable) {}
        }
        return seen.map { (p, l) -> "$l  —  $p" }.sorted()
    }

    private val keywords = listOf("airtel", "xstream", "vantiva", "technicolor", "sagemcom", "iptv", "dth",
        "livetv", "live.tv", "tvinput", "tv.input", "epg", "launcher", "tvsettings", "mediatek.tv", "skyworth", "sdmc")

    private fun interestingPackages(extra: List<String>): List<String> {
        val all = try { pm.getInstalledPackages(0).map { it.packageName } } catch (_: Throwable) { emptyList() }
        return (all.filter { p -> keywords.any { p.lowercase().contains(it) } } + extra)
            .distinct().filter { it != packageName }.sorted()
    }

    // ------------------------------------------------- manifest reading

    private val A_NAME = 0x01010003
    private val A_EXPORTED = 0x01010010
    private val A_PERMISSION = 0x01010006
    private val A_AUTHORITIES = 0x01010018
    private val A_MIME = 0x01010026
    private val A_SCHEME = 0x01010027
    private val A_HOST = 0x01010028
    private val A_PORT = 0x01010029
    private val A_PATH = 0x0101002a
    private val A_PATH_PREFIX = 0x0101002b
    private val A_PATH_PATTERN = 0x0101002c

    /** Components with intent filters (deep links, TV input / accessibility services, providers). */
    private fun manifestSummary(pkg: String): String = try {
        val parser = createPackageContext(pkg, 0).assets.openXmlResourceParser("AndroidManifest.xml")
        val sb = StringBuilder()
        var comp: String? = null
        var compTag = ""
        var filter: MutableList<String>? = null
        var lines = 0
        fun attrs(): Map<Int, String> {
            val m = HashMap<Int, String>()
            for (i in 0 until parser.attributeCount) {
                val id = parser.getAttributeNameResource(i)
                if (id != 0) m[id] = parser.getAttributeValue(i) ?: ""
            }
            return m
        }
        while (true) {
            val ev = parser.next()
            if (ev == org.xmlpull.v1.XmlPullParser.END_DOCUMENT || lines > 160) break
            val tag = parser.name ?: continue
            if (ev == org.xmlpull.v1.XmlPullParser.START_TAG) {
                if (tag == "manifest" && parser.getAttributeValue(null, "package") != pkg)
                    throw IllegalStateException("wrong manifest")
                when (tag) {
                    "activity", "activity-alias", "service", "receiver", "provider" -> {
                        val a = attrs()
                        compTag = tag
                        comp = (a[A_NAME] ?: "?").removePrefix(pkg)
                        val extra = buildList {
                            a[A_EXPORTED]?.let { add("exported=$it") }
                            a[A_PERMISSION]?.let { add("perm=${it.substringAfterLast('.')}") }
                            a[A_AUTHORITIES]?.let { add("authorities=$it") }
                        }
                        if (tag == "provider") { sb.append("provider $comp ${extra.joinToString(" ")}\n"); lines++ }
                        else if (a[A_EXPORTED] == "true") { sb.append("$tag $comp ${extra.joinToString(" ")}\n"); lines++; comp = null }
                    }
                    "intent-filter" -> filter = mutableListOf()
                    "action", "category" -> filter?.add(attrs()[A_NAME] ?: parser.getAttributeValue(0) ?: "")
                    "data" -> filter?.let { f ->
                        val a = attrs()
                        val parts = listOfNotNull(
                            a[A_SCHEME]?.let { "$it://" }, a[A_HOST], a[A_PORT]?.let { ":$it" },
                            a[A_PATH] ?: a[A_PATH_PREFIX]?.let { "$it*" } ?: a[A_PATH_PATTERN]?.let { "~$it" },
                            a[A_MIME]?.let { "type=$it" })
                        if (parts.isNotEmpty()) f.add("data " + parts.joinToString(""))
                    }
                }
            } else if (ev == org.xmlpull.v1.XmlPullParser.END_TAG) {
                when (tag) {
                    "intent-filter" -> {
                        val f = filter
                        if (f != null && f.isNotEmpty()) {
                            val short = f.map { it.removePrefix("android.intent.action.").removePrefix("android.intent.category.") }
                            sb.append("$compTag ${comp ?: "(exported, see above)"}\n    ${short.joinToString("  ")}\n"); lines += 2
                        }
                        filter = null
                    }
                    "activity", "activity-alias", "service", "receiver", "provider" -> comp = null
                }
            }
        }
        parser.close()
        sb.toString().ifBlank { "(no intent filters)" }
    } catch (e: Throwable) {
        // Fallback: exported components only, from the package manager.
        try {
            @Suppress("DEPRECATION")
            val info = pm.getPackageInfo(pkg, PackageManager.GET_ACTIVITIES or PackageManager.GET_SERVICES or PackageManager.GET_PROVIDERS)
            val l = mutableListOf("(manifest not readable: ${e.javaClass.simpleName}; exported parts only)")
            info.activities?.filter { it.exported }?.forEach { l += "activity ${it.name}" }
            info.services?.filter { it.exported }?.forEach { l += "service ${it.name} ${it.permission ?: ""}" }
            info.providers?.forEach { l += "provider ${it.name} authorities=${it.authority}" }
            l.take(80).joinToString("\n")
        } catch (e2: Throwable) { "(not readable: ${e2.javaClass.simpleName})" }
    }

    // ------------------------------------------------- tiny report server (home network only, while open)

    private fun startServer() {
        thread(isDaemon = true) {
            try {
                val s = ServerSocket(8090); server = s
                while (!s.isClosed) {
                    val c = s.accept()
                    thread(isDaemon = true) {
                        try {
                            c.soTimeout = 3000
                            c.getInputStream().bufferedReader().readLine()
                            val body = (report.ifEmpty { "still checking, try again" }).toByteArray()
                            c.getOutputStream().apply {
                                write("HTTP/1.0 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
                                write(body); flush()
                            }
                        } catch (_: Throwable) {} finally { try { c.close() } catch (_: Throwable) {} }
                    }
                }
            } catch (_: Throwable) {}
        }
    }
}
