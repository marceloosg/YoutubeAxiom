import { useCallback, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import WebView, { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';

import { LOGIN_DETECT_INJECTED_JS, parseLoginStatusMessage } from './loginDetectScript';

const LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/';

// s194: dropped the desktop-UA spoof here (Marcelo msg 12408 device test --
// login blocked outright by Google's "this browser or app may not be
// secure" page, https://support.google.com/accounts/answer/7675428).
// Google's own doc frames this as a block on embedded/automated browsers in
// general, not a UA-string check, but a UA that mismatches the WebView's
// real capabilities is one more signal that can trip it, so this is a cheap
// thing to rule out first. Detection (loginDetectScript.ts) reads
// `window.ytcfg.LOGGED_IN`, which YouTube sets on every page load regardless
// of UA/layout, so dropping this doesn't break login-status detection.
// ExtractionWebView.tsx keeps its own desktop UA unchanged -- cookies set
// here are usable there regardless of which UA later reads them.

interface LoginWebViewProps {
  visible: boolean;
  onClose: () => void;
  onLoggedIn: () => void;
}

/**
 * Visible, one-time sign-in WebView (mock §1 "Connect YouTube" flow, s193
 * D19 Shape A). Opens Google's real login flow on-device -- we never read
 * the password field or any form input; login state is detected via
 * `window.ytcfg`'s `LOGGED_IN` flag (OR a secondary avatar-element check) --
 * see `loginDetectScript.ts` for the full detection writeup, including why
 * this replaced both the originally-planned cookie-jar signal and the
 * avatar-only detector that shipped first and failed device-test (mobile UA
 * meant no desktop avatar DOM ever rendered). Nothing leaves the device via
 * this component.
 *
 * The Google login flow crosses several pages (form, possible 2FA, then a
 * redirect to youtube.com), so `injectJavaScript` is re-fired on every
 * navigation via `onNavigationStateChange` (and again on `onLoadEnd`, in
 * case a nav-state event is missed) rather than relying solely on the
 * `injectedJavaScript` prop's initial-load-only injection.
 */
export default function LoginWebView({
  visible,
  onClose,
  onLoggedIn,
}: LoginWebViewProps): React.JSX.Element {
  const webViewRef = useRef<React.ElementRef<typeof WebView>>(null);
  const loggedInRef = useRef(false);

  const handleNavStateChange = useCallback((nav: WebViewNavigation) => {
    if (!nav.loading) {
      webViewRef.current?.injectJavaScript(LOGIN_DETECT_INJECTED_JS);
    }
  }, []);

  const handleLoadEnd = useCallback(() => {
    webViewRef.current?.injectJavaScript(LOGIN_DETECT_INJECTED_JS);
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const msg = parseLoginStatusMessage(event.nativeEvent.data);
      if (msg?.signedIn && !loggedInRef.current) {
        loggedInRef.current = true;
        onLoggedIn();
      }
    },
    [onLoggedIn]
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Sign in to YouTube</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
      <Text style={styles.disclaimer}>
        We never see your password; nothing leaves your phone. The session stays in this
        WebView, on this device only.
      </Text>
      <WebView
        ref={webViewRef}
        source={{ uri: LOGIN_URL }}
        injectedJavaScript={LOGIN_DETECT_INJECTED_JS}
        onNavigationStateChange={handleNavStateChange}
        onLoadEnd={handleLoadEnd}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        style={styles.webview}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 48,
  },
  headerText: { fontSize: 18, fontWeight: '600' },
  closeText: { fontSize: 16, color: '#0066cc' },
  disclaimer: { paddingHorizontal: 16, paddingBottom: 8, color: '#666', fontSize: 12 },
  webview: { flex: 1 },
});
