import { useCallback, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import CookieManager from '@react-native-cookies/cookies';
import WebView, { WebViewNavigation } from 'react-native-webview';

import { cookieStringIndicatesLogin } from './loginCheck';

const LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/';
const YOUTUBE_DOMAIN = 'https://www.youtube.com';

interface LoginWebViewProps {
  visible: boolean;
  onClose: () => void;
  onLoggedIn: () => void;
}

/**
 * Visible, one-time sign-in WebView (mock §1 "Connect YouTube" flow, s193
 * D19 Shape A). Opens Google's real login flow on-device -- we never read
 * the password field or any form input; login state is detected purely by
 * polling the WebView's own cookie jar for login-indicating cookie names
 * once navigation settles on a youtube.com destination (mock §2). Nothing
 * leaves the device via this component.
 */
export default function LoginWebView({
  visible,
  onClose,
  onLoggedIn,
}: LoginWebViewProps): React.JSX.Element {
  const checkingRef = useRef(false);

  const checkLoginCookies = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const cookies = await CookieManager.get(YOUTUBE_DOMAIN);
      const cookieString = Object.keys(cookies)
        .map((name) => `${name}=${cookies[name]?.value ?? ''}`)
        .join('; ');
      if (cookieStringIndicatesLogin(cookieString)) {
        onLoggedIn();
      }
    } catch {
      // Best-effort -- a cookie-manager failure just means the user keeps
      // seeing the sign-in WebView and can retry; nothing to recover here.
    } finally {
      checkingRef.current = false;
    }
  }, [onLoggedIn]);

  const handleNavStateChange = useCallback(
    (nav: WebViewNavigation) => {
      if (!nav.loading && nav.url.includes('youtube.com')) {
        void checkLoginCookies();
      }
    },
    [checkLoginCookies]
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
        source={{ uri: LOGIN_URL }}
        onNavigationStateChange={handleNavStateChange}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        javaScriptEnabled
        domStorageEnabled
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
