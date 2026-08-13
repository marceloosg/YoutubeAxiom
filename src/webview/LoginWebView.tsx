import { useCallback, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import WebView, { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';

import { LOGIN_DETECT_INJECTED_JS, parseLoginStatusMessage } from './loginDetectScript';

const LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/';

interface LoginWebViewProps {
  visible: boolean;
  onClose: () => void;
  onLoggedIn: () => void;
}

/**
 * Visible, one-time sign-in WebView (mock §1 "Connect YouTube" flow, s193
 * D19 Shape A). Opens Google's real login flow on-device -- we never read
 * the password field or any form input; login state is detected purely by
 * an injected DOM check for YouTube's account-avatar element (see
 * `loginDetectScript.ts` for why this replaced the cookie-jar signal
 * originally planned). Nothing leaves the device via this component.
 *
 * The Google login flow crosses several pages (form, possible 2FA, then a
 * redirect to youtube.com), so `injectJavaScript` is re-fired on every
 * navigation via `onNavigationStateChange` rather than relying on the
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
