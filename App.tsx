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

import { parseVideoId } from './src/util/videoId';
import { fetchTranscript, transcriptToText, TranscriptLine } from './src/scrape/youtubeiClient';
import { postTranscript } from './src/backend/api';
import { useBreadcrumbLog } from './src/log/breadcrumbs';
import { useNetworkLog } from './src/log/networkLog';
import { makeInstrumentedFetch } from './src/log/instrumentedFetch';

export default function App() {
  const [urlInput, setUrlInput] = useState('');
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [uploadOk, setUploadOk] = useState(false);
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

  const onShareLog = async () => {
    const message = [
      ...breadcrumbs.formattedLines,
      '---network---',
      ...netLog.formattedLines,
    ].join('\n');
    try {
      await Share.share({ message });
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
