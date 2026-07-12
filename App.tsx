import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { parseVideoId } from './src/util/videoId';
import { fetchTranscript, transcriptToText, TranscriptLine } from './src/scrape/youtubeiClient';
import { postTranscript } from './src/backend/api';
import { useBreadcrumbLog } from './src/log/breadcrumbs';
import { useNetworkLog } from './src/log/networkLog';
import { makeInstrumentedFetch } from './src/log/instrumentedFetch';
import { composeShareLog } from './src/log/shareLog';
import {
  describeBadge,
  failRow,
  initialTestRows,
  passRow,
  runningRow,
  summarizeTestRows,
  TestRowState,
  TestVideoFixture,
} from './src/log/testSuite';

const APP_VERSION = '1.0.4';

/**
 * Fixed diagnostic fixtures for the on-device test harness (s157).
 * Marcelo's own naming (msg 6834): "the debate, the rick Ashley and dr k".
 */
const TEST_VIDEOS: readonly TestVideoFixture[] = [
  { id: 'FaDDitH2WtU', label: 'The debate' },
  { id: 'dQw4w9WgXcQ', label: 'Rick Astley' },
  { id: '7-ex2qeAkdc', label: 'Dr K' },
];

export default function App() {
  // ---------- Extract-mode state (top section, unchanged UX) ----------
  const [urlInput, setUrlInput] = useState('');
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [uploadOk, setUploadOk] = useState(false);
  const [extractShareError, setExtractShareError] = useState<string | null>(null);
  const extractBreadcrumbs = useBreadcrumbLog();
  const extractNetLog = useNetworkLog();
  const extractFetch = useMemo(
    () => makeInstrumentedFetch(extractNetLog.push),
    [extractNetLog.push]
  );

  // ---------- Test-suite state (bottom section, s157 diagnostic) ----------
  const [testRows, setTestRows] = useState<TestRowState[]>(() => initialTestRows(TEST_VIDEOS));
  const [isTesting, setIsTesting] = useState(false);
  const [testShareError, setTestShareError] = useState<string | null>(null);
  const testBreadcrumbs = useBreadcrumbLog();
  const testNetLog = useNetworkLog();
  const testFetch = useMemo(
    () => makeInstrumentedFetch(testNetLog.push),
    [testNetLog.push]
  );

  const onExtract = async () => {
    setError(null);
    setUploadOk(false);
    setLines([]);
    setTitle(null);
    extractBreadcrumbs.reset();
    extractNetLog.reset();

    const videoId = parseVideoId(urlInput);
    if (!videoId) {
      setError('Could not parse a video ID from that URL.');
      return;
    }

    setIsExtracting(true);
    try {
      extractBreadcrumbs.push('starting_stub_upload');
      const result = await fetchTranscript(videoId, extractBreadcrumbs.push, extractFetch);
      setLines(result.lines);
      setTitle(result.title);

      extractBreadcrumbs.push('posting');
      await postTranscript(
        {
          video_id: result.videoId,
          transcript_text: transcriptToText(result.lines),
          breadcrumbs: extractBreadcrumbs.formattedLines,
        },
        extractFetch
      );
      extractBreadcrumbs.push('backend_status:ok');
      setUploadOk(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      extractBreadcrumbs.push(`error:${message}`);
      setError(message);
    } finally {
      setIsExtracting(false);
    }
  };

  /**
   * s157 diagnostic sweep. Runs `fetchTranscript` against the 3 fixed IDs
   * back-to-back. Each row transitions pending -> running -> pass|fail so the
   * UI reads like a unit-test panel. Rows are ALWAYS reset to pending at the
   * start so stale state doesn't leak across "Test All 3" presses. Errors are
   * logged into `testBreadcrumbs`, not thrown -- the sweep completes even when
   * one video fails.
   */
  const onTestAll3 = async () => {
    testBreadcrumbs.reset();
    testNetLog.reset();
    setTestShareError(null);
    setTestRows(initialTestRows(TEST_VIDEOS));
    setIsTesting(true);

    let okCount = 0;
    try {
      for (let i = 0; i < TEST_VIDEOS.length; i += 1) {
        const video = TEST_VIDEOS[i];
        // Flip this row to running before the await so the badge updates live.
        setTestRows((prev) => {
          const next = prev.slice();
          next[i] = runningRow();
          return next;
        });
        testBreadcrumbs.push(`--- test: ${video.id} ---`);
        try {
          const result = await fetchTranscript(video.id, testBreadcrumbs.push, testFetch);
          const segments = result.lines.length;
          testBreadcrumbs.push(`TEST_RESULT: ${video.id} = OK segments=${segments}`);
          setTestRows((prev) => {
            const next = prev.slice();
            next[i] = passRow(segments);
            return next;
          });
          okCount += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          testBreadcrumbs.push(`TEST_RESULT: ${video.id} = FAIL ${message.slice(0, 80)}`);
          setTestRows((prev) => {
            const next = prev.slice();
            next[i] = failRow(message);
            return next;
          });
          // Do NOT rethrow -- sweep the remaining IDs.
        }
      }
      testBreadcrumbs.push(`--- test all: done ${okCount}/${TEST_VIDEOS.length} ---`);
    } finally {
      setIsTesting(false);
    }
  };

  /**
   * File-based share (s157 msg 6829). Write the composed log to a temp file
   * and hand the URI to expo-sharing so TG receives an attachment, not
   * truncated chat text. Falls back to inline `Share.share` when
   * `Sharing.isAvailableAsync()` returns false.
   */
  async function shareBlob(
    composed: string,
    setLocalErr: (msg: string | null) => void
  ): Promise<void> {
    setLocalErr(null);
    try {
      const canShareFile = await Sharing.isAvailableAsync();
      const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (canShareFile && baseDir) {
        const fileUri = `${baseDir}yt-log-${Date.now()}.txt`;
        await FileSystem.writeAsStringAsync(fileUri, composed);
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/plain',
          dialogTitle: 'Share log',
        });
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLocalErr(`file-share failed: ${message.slice(0, 80)}`);
      // Fall through to inline-Share fallback below.
    }

    try {
      await Share.share({ message: composed });
    } catch {
      // Share sheet dismissed / unavailable -- no-op.
    }
  }

  const onShareExtractLog = async () => {
    const composed = composeShareLog({
      appVersion: APP_VERSION,
      context: 'extract',
      atMs: Date.now(),
      breadcrumbLines: extractBreadcrumbs.formattedLines,
      networkLines: extractNetLog.formattedLines,
    });
    await shareBlob(composed, setExtractShareError);
  };

  const onShareTestLog = async () => {
    // Prepend the pass/fail matrix so the shared file leads with the verdict.
    const summary = ['--- test-suite summary ---', ...summarizeTestRows(TEST_VIDEOS, testRows), ''];
    const composed = composeShareLog({
      appVersion: APP_VERSION,
      context: 'test suite',
      atMs: Date.now(),
      breadcrumbLines: [...summary, ...testBreadcrumbs.formattedLines],
      networkLines: testNetLog.formattedLines,
    });
    await shareBlob(composed, setTestShareError);
  };

  const hasExtractLog =
    extractBreadcrumbs.formattedLines.length > 0 || extractNetLog.formattedLines.length > 0;
  const hasTestOutput =
    testRows.some((r) => r.status !== 'pending') ||
    testBreadcrumbs.formattedLines.length > 0 ||
    testNetLog.formattedLines.length > 0;

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.scrollBody}>
        {/* ========== Extract section (user mode) ========== */}
        <Text style={styles.heading}>YouTube Caption Extractor</Text>

        <TextInput
          style={styles.input}
          placeholder="Paste a YouTube URL or video ID"
          value={urlInput}
          onChangeText={setUrlInput}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Pressable
          style={[styles.button, isExtracting && styles.buttonDisabled]}
          onPress={onExtract}
          disabled={isExtracting || isTesting}
        >
          {isExtracting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Extract</Text>
          )}
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}
        {uploadOk && <Text style={styles.success}>Uploaded to backend.</Text>}

        {extractBreadcrumbs.formattedLines.length > 0 && (
          <View style={styles.logBox}>
            <ScrollView>
              {extractBreadcrumbs.formattedLines.map((line, idx) => (
                <Text key={idx} style={styles.logLine}>
                  {line}
                </Text>
              ))}
            </ScrollView>
          </View>
        )}

        {extractNetLog.formattedLines.length > 0 && (
          <View style={styles.netLogBox}>
            <Text style={styles.logHeading}>Network</Text>
            <ScrollView>
              {extractNetLog.formattedLines.map((line, idx) => (
                <Text key={idx} style={styles.logLine}>
                  {line}
                </Text>
              ))}
            </ScrollView>
          </View>
        )}

        {hasExtractLog && (
          <Pressable style={styles.shareButton} onPress={onShareExtractLog}>
            <Text style={styles.shareButtonText}>Share log</Text>
          </Pressable>
        )}

        {extractShareError && <Text style={styles.shareErrorText}>{extractShareError}</Text>}

        {title && <Text style={styles.videoTitle}>{title}</Text>}

        {lines.length > 0 && (
          <View style={styles.transcriptBox}>
            {lines.map((line, idx) => (
              <Text key={idx} style={styles.transcriptLine}>
                [{line.startSec.toFixed(1)}s] {line.text}
              </Text>
            ))}
          </View>
        )}

        {/* ========== Test suite section (diagnostic mode) ========== */}
        <View style={styles.divider} />
        <View style={styles.testSection}>
          <Text style={styles.testHeading}>Test Suite</Text>
          <Text style={styles.testSubheading}>
            Diagnostic sweep across 3 fixed videos. Pass = segments &gt; 0.
          </Text>

          <Pressable
            style={[styles.testButton, isTesting && styles.buttonDisabled]}
            onPress={onTestAll3}
            disabled={isExtracting || isTesting}
          >
            {isTesting ? (
              <ActivityIndicator color="#1a73e8" />
            ) : (
              <Text style={styles.testButtonText}>Test All 3</Text>
            )}
          </Pressable>

          <View style={styles.testRows}>
            {TEST_VIDEOS.map((video, idx) => {
              const row = testRows[idx] ?? { status: 'pending' as const, detail: '' };
              const badge = describeBadge(row.status);
              return (
                <View key={video.id} style={styles.testRow}>
                  <View style={styles.testRowHeaderLine}>
                    <Text style={[styles.testBadge, { color: badge.color }]}>
                      {row.status === 'running' ? '' : row.status === 'pass' ? '✓ ' : row.status === 'fail' ? '✗ ' : ''}
                      {badge.text}
                    </Text>
                    <Text style={styles.testRowLabel}>{video.label}</Text>
                  </View>
                  <Text style={styles.testRowSubtitle}>{video.id}</Text>
                  {row.detail !== '' && (
                    <Text style={styles.testRowDetail}>{row.detail}</Text>
                  )}
                </View>
              );
            })}
          </View>

          {testBreadcrumbs.formattedLines.length > 0 && (
            <View style={styles.logBox}>
              <ScrollView>
                {testBreadcrumbs.formattedLines.map((line, idx) => (
                  <Text key={idx} style={styles.logLine}>
                    {line}
                  </Text>
                ))}
              </ScrollView>
            </View>
          )}

          {testNetLog.formattedLines.length > 0 && (
            <View style={styles.netLogBox}>
              <Text style={styles.logHeading}>Network</Text>
              <ScrollView>
                {testNetLog.formattedLines.map((line, idx) => (
                  <Text key={idx} style={styles.logLine}>
                    {line}
                  </Text>
                ))}
              </ScrollView>
            </View>
          )}

          {hasTestOutput && (
            <Pressable style={styles.shareButton} onPress={onShareTestLog}>
              <Text style={styles.shareButtonText}>Share test log</Text>
            </Pressable>
          )}

          {testShareError && <Text style={styles.shareErrorText}>{testShareError}</Text>}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 60,
  },
  scrollBody: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  error: {
    color: '#c00',
    marginBottom: 8,
  },
  success: {
    color: '#0a0',
    marginBottom: 8,
  },
  logBox: {
    maxHeight: 100,
    backgroundColor: '#f2f2f2',
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
  },
  netLogBox: {
    maxHeight: 200,
    backgroundColor: '#f2f2f2',
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
  },
  logHeading: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  logLine: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#555',
  },
  shareButton: {
    backgroundColor: '#666',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  shareErrorText: {
    color: '#888',
    fontSize: 11,
    marginBottom: 8,
  },
  videoTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  transcriptBox: {
    marginTop: 4,
  },
  transcriptLine: {
    fontSize: 13,
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#ddd',
    marginTop: 20,
    marginBottom: 16,
  },
  testSection: {
    backgroundColor: '#f7f9fc',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e1e6ee',
  },
  testHeading: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a73e8',
    marginBottom: 4,
  },
  testSubheading: {
    fontSize: 12,
    color: '#666',
    marginBottom: 10,
  },
  testButton: {
    backgroundColor: '#fff',
    borderColor: '#1a73e8',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  testButtonText: {
    color: '#1a73e8',
    fontWeight: '600',
    fontSize: 13,
  },
  testRows: {
    marginBottom: 12,
  },
  testRow: {
    backgroundColor: '#fff',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e6ebf2',
  },
  testRowHeaderLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  testBadge: {
    fontSize: 12,
    fontWeight: '700',
    marginRight: 8,
    minWidth: 90,
  },
  testRowLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#222',
    flexShrink: 1,
  },
  testRowSubtitle: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#888',
    marginTop: 2,
  },
  testRowDetail: {
    fontSize: 11,
    color: '#444',
    marginTop: 3,
    fontFamily: 'monospace',
  },
});
