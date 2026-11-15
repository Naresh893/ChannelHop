package tv.boxcheck

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

/** Does nothing. Only here to see whether the box lists it and lets it be switched on. */
class TestA11y : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}
}
