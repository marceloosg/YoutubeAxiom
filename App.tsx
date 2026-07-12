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

const APP_VERSION = '1.0.4';

/**
 * Fixed diagnostic fixtures for the on-device test harness (s157).
 * The 3 IDs cover the caption-class matrix Marcelo needs classified:
 *   - ASR-only (no manual tracks)
 *   - Multi-track with manual EN
 *   - Unknown (probe)
 */
const TEST_VIDEOS = [
  { id: 'FaDDitH2WtU', label: 'FaDDitH2WtU (ASR-only, philosophy)' },
  { id: 'dQw4w9WgXcQ', label: 'dQw4w9WgXcQ (music, 6 tracks incl manual EN)' },
  { id: '7-ex2qeAkdc', label: '7-ex2qeAkdc (unknown class)' },
];

export default function App() {
  const [urlInput, setUrlInput] = useState('');
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [uploadOk, setUploadOk] = useState(false);
  /** Tracks the last run context so the shared log header can label it. */
  const [lastRunContext, setLastRunContext] = useState<string>('none');
  /** Silent log-only state for share failures (no UI banner). */
  const [shareError, setShareError] = useState<string | null>(null);
  const breadcrumbs = useBreadcrumbLog();
  const netLog = useNetworkLog();
  const instrumentedFetch = useMemo(() => makeInstrumentedFetch(netLog.push), [netLog.push]);

  const onExtract = async () => {
    setError(null);
    setUploadOk(false);
    setLines([]);
    setTitle(null);
    breadcrumbs.reset();
    netLog.reset();

    const videoId = parseVideoId(urlInput);
    if (!videoId) {
      setError('Could not parse a video ID from that URL.');
      return;
    }

    setLastRunContext(videoId);
    setIsWorking(true);
    try {
      breadcrumbs.push('starting_stub_upload');
      const result = await fetchTranscript(videoId, breadcrumbs.push, instrumentedFetch);
      setLines(result.lines);
      setTitle(result.title);

      breadcrumbs.push('posting');
      await postTranscript(
        {
          video_id: result.videoId,
          transcript_text: transcriptToText(result.lines),
          breadcrumbs: breadcrumbs.formattedLines,
        },
        instrumentedFetch
      );
      breadcrumbs.push('backend_status:ok');
      setUploadOk(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      breadcrumbs.push(`error:${message}`);
      setError(message);
    } finally {
      setIsWorking(false);
    }
  };

  /**
   * s157 diagnostic harness: run fetchTranscript against the 3 fixed IDs
   * back-to-back, appending divider + result breadcrumbs so a single share
   * captures the full caption-class matrix. Errors are logged, not thrown --
   * the sweep completes even when one video fails.
   */
  const onTestAll3 = async () => {
    setError(null);
    setUploadOk(false);
    setLines([]);
    setTitle(null);
    breadcrumbs.reset();
    netLog.reset();
    setLastRunContext('test all');
    setIsWorking(true);

    let okCount = 0;
    try {
      for (const video of TEST_VIDEOS) {
        breadcrumbs.push(`--- test: ${video.id} ---`);
        try {
          const result = await fetchTranscript(
            video.id,
            breadcrumbs.push,
            instrumentedFetch
          );
          breadcrumbs.push(`TEST_RESULT: ${video.id} = OK segments=${result.lines.length}`);
          okCount += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const truncated = message.slice(0, 80);
          breadcrumbs.push(`TEST_RESULT: ${video.id} = FAIL ${truncated}`);
          // Do NOT rethrow -- keep sweeping the remaining IDs.
        }
      }
      breadcrumbs.push(`--- test all: done ${okCount}/${TEST_VIDEOS.length} ---`);
    } finally {
      setIsWorking(false);
    }
  };

  /**
   * File-based share (s157). Marcelo hit TG truncation on inline `Share.share`
   * (msg 6829). Write the combined breadcrumb + network log to a temp file and
   * hand the URI to expo-sharing so target apps receive an attachment, not
   * chat text. Falls back to inline `Share.share` when `Sharing.isAvailableAsync`
   * returns false (older platforms / no share sheet).
   */
  const onShareLog = async () => {
    setShareError(null);
    const composed = composeShareLog({
      appVersion: APP_VERSION,
      context: lastRunContext,
      atMs: Date.now(),
      breadcrumbLines: breadcrumbs.formattedLines,
      networkLines: netLog.formattedLines,
    });

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
      setShareError(`file-share failed: ${message.slice(0, 80)}`);
      // Fall through to inline-Share fallback below.
    }

    // Fallback: inline text share (old code path). Kept for platforms where
    // expo-sharing is unavailable.
    try {
      await Share.share({ message: composed });
    } catch {
      // Share sheet dismissed / unavailable -- no-op.
    }
  };

  const hasAnyLog =
    breadcrumbs.formattedLines.length > 0 || netLog.formattedLines.length > 0;

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
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
        style={[styles.button, isWorking && styles.buttonDisabled]}
        onPress={onExtract}
        disabled={isWorking}
      >
        {isWorking ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Extract</Text>
        )}
      </Pressable>

      <Pressable
        style={[styles.testButton, isWorking && styles.buttonDisabled]}
        onPress={onTestAll3}
        disabled={isWorking}
      >
        <Text style={styles.testButtonText}>Test All 3</Text>
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}
      {uploadOk && <Text style={styles.success}>Uploaded to backend.</Text>}

      {breadcrumbs.formattedLines.length > 0 && (
        <View style={styles.logBox}>
          <ScrollView>
            {breadcrumbs.formattedLines.map((line, idx) => (
              <Text key={idx} style={styles.logLine}>
                {line}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}

      {netLog.formattedLines.length > 0 && (
        <View style={styles.netLogBox}>
          <Text style={styles.logHeading}>Network</Text>
          <ScrollView>
            {netLog.formattedLines.map((line, idx) => (
              <Text key={idx} style={styles.logLine}>
                {line}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}

      {hasAnyLog && (
        <Pressable style={styles.shareButton} onPress={onShareLog}>
          <Text style={styles.shareButtonText}>Share log</Text>
        </Pressable>
      )}

      {shareError && <Text style={styles.shareErrorText}>{shareError}</Text>}

      {title && <Text style={styles.videoTitle}>{title}</Text>}

      <ScrollView style={styles.transcriptBox}>
        {lines.map((line, idx) => (
          <Text key={idx} style={styles.transcriptLine}>
            [{line.startSec.toFixed(1)}s] {line.text}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 60,
    paddingHorizontal: 16,
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
    marginBottom: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  testButton: {
    backgroundColor: '#e8f0fe',
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
    flex: 1,
  },
  transcriptLine: {
    fontSize: 13,
    marginBottom: 4,
  },
});
