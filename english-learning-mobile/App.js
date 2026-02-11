
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
  Dimensions
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import axios from 'axios';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech'; // En üstte import edildiğinden emin ol
import { Ionicons } from '@expo/vector-icons'; // BU SATIRI EKLE

// For Android Emulator, use 10.0.2.2; for real device on same WiFi, use 192.168.1.108
const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://192.168.1.104:8000';
const screenWidth = Dimensions.get('window').width;
export default function App() {
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [userAnswer, setUserAnswer] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revealedWords, setRevealedWords] = useState({});
  // Audio recording states
  const [recording, setRecording] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // Web speech recognition (fallback)
  const [recognition, setRecognition] = useState(null);
  useEffect(() => {
    loadRandomQuestion();
    initWebSpeechRecognition();
  }, []);
  // Web speech recognition initialization (fallback for web platform)
  const initWebSpeechRecognition = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' &&
      ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognitionInstance = new SpeechRecognition();
      recognitionInstance.lang = 'en-US';
      recognitionInstance.continuous = false;
      recognitionInstance.interimResults = false;

      recognitionInstance.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setUserAnswer(transcript);
      };

      recognitionInstance.onend = () => {
        setIsRecording(false);
      };

      setRecognition(recognitionInstance);
    }
  };
  const speakWord = async (word) => {
    try {
      // Keep apostrophes (e.g., o'clock) so pronunciation is preserved; remove only sentence punctuation
      let cleanWord = word.replace(/[.,!?]/g, '');

      // Fix: Mobile TTS often reads "I" as "Capital I". Changing it to lowercase "i" usually forces the pronoun pronunciation.
      if (cleanWord === 'I') {
        cleanWord = 'i';
      }

      if (cleanWord) {
        // Ensure speech is stopped before starting new speech
        await Speech.stop();

        // Explicitly set audio mode for playback before speaking (fixes iOS silent mode and Android focus issues)
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });

        Speech.speak(cleanWord, {
          language: 'en-US',
          pitch: 1,
          rate: 0.85, // Hafif yavaş ve anlaşılır
          onError: (e) => console.log('Speech error:', e),
        });
      }
    } catch (error) {
      console.error('Speak word error:', error);
    }
  };
  const loadRandomQuestion = async () => {
    setLoading(true);
    setResult(null);
    setUserAnswer('');
    setRevealedWords({});

    try {
      const response = await axios.get(`${API_URL}/random-question`);
      setCurrentQuestion(response.data);
    } catch (error) {
      Alert.alert('Connection Error', 'Could not load question. Please check your internet connection.');
    } finally {
      setLoading(false);
    }
  };
  const checkAnswer = async () => {
    if (!userAnswer.trim()) {
      Alert.alert('Empty Answer', 'Please provide an answer before checking!');
      return;
    }

    try {
      const response = await axios.post(`${API_URL}/check-answer`, {
        question_id: currentQuestion.id,
        user_answer: userAnswer
      });
      setResult(response.data);
    } catch (error) {
      Alert.alert('Error', 'Could not check answer. Please try again.');
    }
  };
  // PRODUCTION AUDIO RECORDING IMPLEMENTATION
  const requestMicrophonePermission = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Microphone Permission Required',
          'This app needs microphone access to help you practice English pronunciation. Please enable it in your device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Settings', onPress: () => {/* Open settings if needed */ } }
          ]
        );
        return false;
      }
      return true;
    } catch (error) {
      Alert.alert('Permission Error', 'Could not request microphone permission.');
      return false;
    }
  };
  const startRecording = async () => {
    // Web platform fallback
    if (Platform.OS === 'web') {
      if (!recognition) {
        Alert.alert('Not Supported', 'Speech recognition is not available in this browser.');
        return;
      }
      setIsRecording(true);
      recognition.start();
      return;
    }

    // Native mobile recording
    try {
      const hasPermission = await requestMicrophonePermission();
      if (!hasPermission) return;

      // Configure audio mode for recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      // Create and start recording
      const { recording: newRecording } = await Audio.Recording.createAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        android: {
          extension: '.wav',
          outputFormat: Audio.AndroidOutputFormat.DEFAULT,
          audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.wav',
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
      });

      setRecording(newRecording);
      setIsRecording(true);
    } catch (error) {
      Alert.alert('Recording Error', 'Could not start recording. Please try again.');
      console.error('Recording start error:', error);
    }
  };
  const stopRecording = async () => {
    // Web platform fallback
    if (Platform.OS === 'web') {
      if (recognition) {
        recognition.stop();
      }
      setIsRecording(false);
      return;
    }

    // Native mobile recording
    if (!recording) return;

    try {
      setIsRecording(false);
      setIsProcessing(true);

      await recording.stopAndUnloadAsync();

      // Fix: Reset audio mode to playback so TTS works again
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const uri = recording.getURI();
      setRecording(null);

      if (uri) {
        await sendAudioToBackend(uri);
      } else {
        Alert.alert('Recording Error', 'Could not save the recording. Please try again.');
      }
    } catch (error) {
      Alert.alert('Processing Error', 'Could not process the recording. Please try again.');
      console.error('Recording stop error:', error);
    } finally {
      setIsProcessing(false);
    }
  };
  // PRODUCTION AUDIO UPLOAD IMPLEMENTATION
  const sendAudioToBackend = async (audioUri) => {
    try {
      const formData = new FormData();

      // Create file object for upload
      const audioFile = {
        uri: audioUri,
        type: 'audio/wav',
        name: 'speech.wav',
      };

      formData.append('file', audioFile);

      const response = await fetch(`${API_URL}/speech-to-text`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 30000, // 30 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.text && data.text.trim()) {
        setUserAnswer(data.text.trim());
      } else {
        Alert.alert('Speech Recognition', 'Could not understand the speech. Please try speaking more clearly.');
      }
    } catch (error) {
      console.error('Audio upload error:', error);
      Alert.alert(
        'Processing Error',
        'Could not process your speech. Please check your internet connection and try again.'
      );
    }
  };
  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };
  const revealWord = (index) => {
    if (currentQuestion.hints[index]) {
      setRevealedWords(prev => ({
        ...prev,
        [index]: currentQuestion.hints[index].word
      }));
    }
  };

  const getFeedbackStyle = (text) => {
    if (text.includes('Typos')) return { icon: 'pencil-outline', color: '#EAB308', bg: '#FEF9C3', label: 'Yazım Hatası' };
    if (text.includes('Missing')) return { icon: 'alert-circle-outline', color: '#EF4444', bg: '#FEE2E2', label: 'Eksik Kelime' };
    if (text.includes('Extra')) return { icon: 'add-circle-outline', color: '#8B5CF6', bg: '#EDE9FE', label: 'Fazla Kelime' };
    if (text.includes('Spacing')) return { icon: 'resize-outline', color: '#3B82F6', bg: '#DBEAFE', label: 'Boşluk Hatası' };
    return { icon: 'information-circle-outline', color: '#6B7280', bg: '#F3F4F6', label: 'Bilgi' };
  };

  const renderMaskedSentence = () => {
    if (!currentQuestion) return null;

    let hintIndex = 0;
    // Cümleyi boşluklardan bölüp her kelimeyi diziye alıyoruz
    const sentenceParts = currentQuestion.masked_en.split(' ');

    return (
      <Text style={styles.enSentence}>
        EN: {sentenceParts.map((part, index) => {
          if (part.includes('_')) {
            const currentHintIndex = hintIndex;
            hintIndex++;
            const revealedWord = revealedWords[currentHintIndex];

            return (
              <Text
                key={index}
                style={[styles.maskedWord, revealedWord && styles.revealedWord]}
                onPress={() => {
                  if (!revealedWord) {
                    // Kelime kapalıysa: Önce aç, sonra oku
                    const wordToSpeak = currentQuestion.hints[currentHintIndex].word;
                    setRevealedWords({ ...revealedWords, [currentHintIndex]: wordToSpeak });
                    speakWord(wordToSpeak);
                  } else {
                    // Kelime zaten açıksa: Sadece oku
                    speakWord(revealedWord);
                  }
                }}
              >
                {revealedWord || part}
              </Text>
            );
          }

          // Normal (maskelenmemiş) kelimeler için
          return (
            <Text
              key={index}
              style={styles.clickableWord}
              onPress={() => speakWord(part)}
            >
              {part}
            </Text>
          );
        }).reduce((prev, curr, index) => [prev, ' ', curr])}
      </Text>
    );
  };
  if (loading) {
    return (
      <LinearGradient
        colors={['#faf5ff', '#fce7f3', '#eff6ff']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.container}
      >
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9333ea" />
          <Text style={styles.loadingText}>Loading question...</Text>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={['#faf5ff', '#fce7f3', '#eff6ff']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>🎓 English Learning App</Text>
          <Text style={styles.subtitle}>Practice translation exercises</Text>
        </View>

        {/* Badges */}
        <View style={styles.badgeContainer}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{currentQuestion?.level}</Text>
          </View>
          <View style={[styles.badge, styles.badgeSecondary]}>
            <Text style={styles.badgeTextSecondary}>{currentQuestion?.topic}</Text>
          </View>
        </View>

        {/* Main Card */}
        {currentQuestion && (
          <View style={styles.card}>
            {/* Turkish Section */}
            <View style={styles.turkishSection}>
              <Text style={styles.sectionLabel}>Turkish</Text>
              <Text style={styles.turkishText}>{currentQuestion.tr}</Text>
            </View>

            {/* English Template Section */}
            <View style={styles.englishSection}>
              <Text style={styles.sectionLabel}>English Template</Text>
              {renderMaskedSentence()}
            </View>

            {/* Input Area */}
            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>Your Answer</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.textarea}
                  placeholder="Type your answer here..."
                  placeholderTextColor="#b0a4c5"
                  value={userAnswer}
                  onChangeText={setUserAnswer}
                  multiline
                  numberOfLines={4}
                  editable={!isRecording && !isProcessing}
                />
                <TouchableOpacity
                  style={[styles.micButton, isRecording && styles.micButtonActive]}
                  onPress={toggleRecording}
                  disabled={isProcessing}
                >
                  <Text style={styles.micIcon}>{isRecording ? '⏹️' : '🎤'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Recording Status */}
            {isRecording && (
              <View style={styles.statusBanner}>
                <Text style={styles.statusText}>🔴 Recording... Tap to stop</Text>
              </View>
            )}

            {isProcessing && (
              <View style={[styles.statusBanner, styles.processingBanner]}>
                <Text style={styles.processingText}>🔄 Processing speech...</Text>
              </View>
            )}

            {/* Button Group */}
            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[styles.buttonPrimary, (isRecording || isProcessing) && styles.buttonDisabled]}
                onPress={checkAnswer}
                disabled={!userAnswer.trim() || isRecording || isProcessing}
              >
                <Text style={styles.buttonTextPrimary}>Check Answer</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.buttonSecondary, (isRecording || isProcessing) && styles.buttonDisabled]}
                onPress={loadRandomQuestion}
                disabled={isRecording || isProcessing}
              >
                <Text style={styles.buttonTextSecondary}>Next Question</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Result Card */}
        {result && (
          <View style={[styles.resultCard, result.is_correct ? styles.resultCorrect : styles.resultIncorrect]}>
            {/* Status Icon & Title */}
            <View style={styles.resultHeaderRow}>
              <View style={[styles.resultIconContainer, result.is_correct ? styles.iconCorrect : styles.iconIncorrect]}>
                <Text style={styles.resultIcon}>{result.is_correct ? '✓' : '!'}</Text>
              </View>
              <Text style={[styles.resultTitle, result.is_correct ? styles.resultTitleCorrect : styles.resultTitleIncorrect]}>
                {result.is_correct ? 'Perfect!' : 'Keep Improving!'}
              </Text>
            </View>

            {/* Similarity Score */}
            <View style={styles.scoreContainer}>
              <Text style={styles.scoreLabel}>Accuracy Score</Text>
              <View style={styles.scoreBar}>
                <View
                  style={[
                    styles.scoreBarFill,
                    {
                      width: `${result.similarity * 100}%`,
                      backgroundColor: result.is_correct ? '#10b981' : '#f97316'
                    }
                  ]}
                />
              </View>
              <Text style={[styles.scoreText, result.is_correct ? styles.scoreTextCorrect : styles.scoreTextIncorrect]}>
                {Math.round(result.similarity * 100)}%
              </Text>
            </View>

            {/* Hata Analizi Bölümü */}
            {!result.is_correct && result.feedback && (
              <View style={styles.feedbackWrapper}>
                <Text style={styles.analysisHeader}>Hata Analizi</Text>

                {result.feedback.split('; ').map((item, index) => {
                  const style = getFeedbackStyle(item);
                  // "Typos: succes -> success" kısmından sadece "succes -> success" kısmını alalım (isteğe bağlı)
                  const cleanText = item.includes(': ') ? item.split(': ')[1] : item;

                  return (
                    <View key={index} style={[styles.feedbackCard, { backgroundColor: style.bg, borderColor: style.color }]}>
                      <View style={[styles.iconCircle, { backgroundColor: style.color }]}>
                        <Ionicons name={style.icon} size={16} color="#fff" />
                      </View>
                      <View style={styles.feedbackContent}>
                        <Text style={[styles.feedbackLabel, { color: style.color }]}>{style.label}</Text>
                        <Text style={styles.feedbackDetail}>{cleanText}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Answer Comparison */}
            {!result.is_correct && (
              <View style={styles.answerComparison}>
                <View style={styles.comparisonSubBox}>
                  <Text style={styles.comparisonLabel}>Your input was:</Text>
                  <Text style={styles.userAnswerText}>{result.user_answer}</Text>
                </View>
                <View style={styles.answerDivider} />
                <View style={styles.comparisonSubBox}>
                  <Text style={styles.correctLabel}>The correct way to say it:</Text>
                  <Text style={styles.correctAnswerText}>{result.correct_answer}</Text>
                </View>
              </View>
            )}

            <Text style={[styles.encouragement, result.is_correct ? styles.encouragementCorrect : styles.encouragementIncorrect]}>
              {result.is_correct
                ? '🎉 Excellent! You mastered this sentence.'
                : '💪 Don\'t give up! Look at the feedback above.'}
            </Text>
          </View>
        )}

        {/* Instructions Card */}
        <View style={styles.instructionsCard}>
          <Text style={styles.instructionsTitle}>How to Play:</Text>
          <Text style={styles.instructionItem}>• Read the Turkish sentence carefully</Text>
          <Text style={styles.instructionItem}>• Translate it to English following the template</Text>
          <Text style={styles.instructionItem}>• Type your answer or use the microphone</Text>
          <Text style={styles.instructionItem}>• Check your answer to see how you did!</Text>
        </View>

        <View style={styles.spacer} />
      </ScrollView>
    </LinearGradient>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#7c3aed',
    fontWeight: '600',
  },

  // Header
  header: {
    alignItems: 'center',
    marginBottom: 24,
    paddingTop: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#6b21a8',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#9333ea',
  },

  // Badges
  badgeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 24,
  },
  badge: {
    backgroundColor: '#e9d5ff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7c3aed',
  },
  badgeSecondary: {
    backgroundColor: '#dbeafe',
  },
  badgeTextSecondary: {
    color: '#2563eb',
  },

  // Card
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },

  // Turkish Section
  turkishSection: {
    backgroundColor: '#faf5ff',
    backgroundGradient: ['#f3e8ff', '#fce7f3'],
    padding: 20,
    borderRadius: 20,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9333ea',
    marginBottom: 8,
  },
  turkishText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#6b21a8',
    lineHeight: 32,
  },

  // English Section
  englishSection: {
    backgroundColor: '#f0f9ff',
    padding: 20,
    borderRadius: 20,
    marginBottom: 20,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#93c5fd',
  },
  enSentence: {
    fontSize: 18,
    color: '#1e40af',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    lineHeight: 28,
  },
  maskedWord: {
    color: '#2563eb',
    fontWeight: 'bold',
    backgroundColor: '#dbeafe',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  revealedWord: {
    color: '#10b981',
    backgroundColor: '#d1fae5',
  },

  // Input Section
  inputSection: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  textarea: {
    flex: 1,
    minHeight: 100,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e9d5ff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1f2937',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f3e8ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  micButtonActive: {
    backgroundColor: '#fee2e2',
    borderWidth: 2,
    borderColor: '#f87171',
  },
  micIcon: {
    fontSize: 24,
  },

  // Status Banners
  statusBanner: {
    backgroundColor: '#fee2e2',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  statusText: {
    color: '#b91c1c',
    fontWeight: '600',
    fontSize: 14,
  },
  processingBanner: {
    backgroundColor: '#dbeafe',
  },
  processingText: {
    color: '#1e40af',
    fontWeight: '600',
    fontSize: 14,
  },

  // Buttons
  buttonGroup: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 0,
  },
  buttonPrimary: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#7c3aed',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  buttonSecondary: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#d8b4fe',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonTextPrimary: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonTextSecondary: {
    color: '#7c3aed',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },

  // Result Card
  resultCard: {
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  resultCorrect: {
    backgroundColor: '#f0fdf4',
    borderTopWidth: 4,
    borderTopColor: '#10b981',
  },
  resultIncorrect: {
    backgroundColor: '#fef3c7',
    borderTopWidth: 4,
    borderTopColor: '#f97316',
  },

  // Result Icon
  resultIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  iconCorrect: {
    backgroundColor: '#10b981',
  },
  iconIncorrect: {
    backgroundColor: '#f97316',
  },
  resultIcon: {
    fontSize: 32,
    color: '#fff',
    fontWeight: 'bold',
  },

  // Result Title
  resultTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  resultTitleCorrect: {
    color: '#15803d',
  },
  resultTitleIncorrect: {
    color: '#92400e',
  },

  // Score
  scoreContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  scoreLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 8,
  },
  scoreBar: {
    width: '100%',
    height: 12,
    backgroundColor: '#d1d5db',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 8,
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 6,
  },
  scoreText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  scoreTextCorrect: {
    color: '#15803d',
  },
  scoreTextIncorrect: {
    color: '#b45309',
  },

  // Answer Comparison
  answerComparison: {
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  comparisonLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
  },
  userAnswerText: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '500',
    marginBottom: 12,
  },
  answerDivider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 12,
  },
  correctLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#16a34a',
    marginBottom: 4,
  },
  correctAnswerText: {
    fontSize: 16,
    color: '#15803d',
    fontWeight: '600',
  },

  // Encouragement
  encouragement: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  encouragementCorrect: {
    color: '#15803d',
  },
  encouragementIncorrect: {
    color: '#b45309',
  },

  // Instructions Card
  instructionsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 4,
  },
  instructionsTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#6b21a8',
    marginBottom: 12,
  },
  instructionItem: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 20,
    marginBottom: 6,
  },

  spacer: {
    height: 20,
  },

  feedbackWrapper: {
    marginVertical: 15,
  },
  analysisHeader: {
    fontSize: 14,
    fontWeight: '800',
    color: '#4B5563',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginLeft: 5,
  },
  feedbackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
    borderWidth: 1,
    // Hafif gölge için:
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  feedbackContent: {
    flex: 1,
  },
  feedbackLabel: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  feedbackDetail: {
    fontSize: 15,
    color: '#1F2937',
    fontWeight: '600',
  },

  // StyleSheet.create içindeki diğer stillerin yanına ekle:
  resultHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 10,
  },
  comparisonSubBox: {
    marginVertical: 4,
  },

  // Styles içine ekle veya güncelle
  clickableWord: {
    color: '#1e40af', // Normal kelimeler için koyu mavi (tıklanabilir hissi)
    // textDecorationLine: 'underline', // İstersen altını çizebilirsin
  },
  maskedWord: {
    color: '#2563eb',
    fontWeight: 'bold',
    backgroundColor: '#dbeafe',
    paddingHorizontal: 4,
    borderRadius: 4,
    overflow: 'hidden', // iOS'ta arka plan renginin köşelerini yuvarlamak için
  },
  revealedWord: {
    color: '#10b981',
    backgroundColor: '#d1fae5',
  },
});