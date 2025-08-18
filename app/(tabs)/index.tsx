import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StatusBar,
  Modal,
  Animated,
  Dimensions,
  TouchableWithoutFeedback,
  Alert,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import Voice from '@react-native-voice/voice';
import { Audio } from 'expo-av'; // CORRECTED: Use expo-av for permissions

// --- Configuration ---
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const CHAT_HISTORY_KEY = 'chatHistory';
const MAX_HISTORY_LENGTH = 100;
const CONTEXT_WINDOW_SIZE = 10; // Number of previous messages to send as context

// --- Model Definitions ---
const availableModels = [
    { name: 'Gemini 1.5 Flash', id: 'gemini-1.5-flash' },
    { name: 'Gemini 2.0 Flash-Lite', id: 'gemini-2.0-flash-lite' }, // Placeholder ID
    { name: 'Gemini 2.5 Flash-Lite', id: 'gemini-2.5-flash-lite' }, // Placeholder ID
];

// --- Type Definitions ---
interface Message {
  id: string;
  text: string;
  isFromUser: boolean;
}

interface ChatSession {
  id: string;
  messages: Message[];
}

// Gemini API content format
interface GeminiContent {
    role: 'user' | 'model';
    parts: { text: string }[];
}

// --- Chat History Drawer Component ---
const ChatHistoryDrawer = ({
  visible,
  onClose,
  sessions,
  onSwitchSession,
  onNewChat,
  onDeleteSession,
  models,
  selectedModel,
  onSelectModel,
}: {
  visible: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  onSwitchSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  models: { name: string; id: string }[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
}) => {
  const slideAnim = useRef(new Animated.Value(-Dimensions.get('window').width * 0.8)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -Dimensions.get('window').width * 0.8,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.drawerBackdrop} onPress={onClose} activeOpacity={1}>
        <TouchableWithoutFeedback>
          <Animated.View style={[styles.drawerContainer, { transform: [{ translateX: slideAnim }] }]}>
            <View style={styles.drawerHeader}>
              <TouchableOpacity style={styles.drawerNewChatButton} onPress={onNewChat}>
                <Feather name="plus" size={20} color="#FFFFFF" />
                <Text style={styles.drawerNewChatText}>New Chat</Text>
              </TouchableOpacity>
            </View>
            
            <Text style={styles.historyListHeader}>Model</Text>
            {models.map(model => (
              <TouchableOpacity 
                key={model.id} 
                style={[styles.modelItem, selectedModel === model.id && styles.modelItemSelected]}
                onPress={() => onSelectModel(model.id)}
              >
                <Feather name={selectedModel === model.id ? 'check-circle' : 'circle'} size={18} color="#FFFFFF" />
                <Text style={styles.modelText}>{model.name}</Text>
              </TouchableOpacity>
            ))}

            <Text style={styles.historyListHeader}>Recent Chats</Text>
            <FlatList
              data={sessions}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.historyItem} onPress={() => onSwitchSession(item.id)}>
                  <Text style={styles.historyText} numberOfLines={1}>
                    {item.messages[0]?.text || 'New Chat'}
                  </Text>
                  <TouchableOpacity onPress={() => onDeleteSession(item.id)} style={styles.deleteButton}>
                    <Feather name="trash-2" size={18} color="#999" />
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
            />
          </Animated.View>
        </TouchableWithoutFeedback>
      </TouchableOpacity>
    </Modal>
  );
};


// --- Main Screen Component ---
export default function ChatScreen() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedModel, setSelectedModel] = useState(availableModels[0].id);
  const [isRecording, setIsRecording] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // --- Voice Recognition Setup ---
  useEffect(() => {
    const onSpeechResults = (e: any) => {
      if (e.value && e.value.length > 0) {
        setInputText(e.value[0]);
      }
    };
    const onSpeechPartialResults = (e: any) => {
      if (e.value && e.value.length > 0) {
        setInputText(e.value[0]);
      }
    };
    const onSpeechEnd = () => setIsRecording(false);
    const onSpeechError = (e: any) => {
      console.error(e);
      setIsRecording(false);
    };

    Voice.onSpeechResults = onSpeechResults;
    Voice.onSpeechPartialResults = onSpeechPartialResults;
    Voice.onSpeechEnd = onSpeechEnd;
    Voice.onSpeechError = onSpeechError;

    return () => {
      // FIX: Only remove listeners, do not destroy the Voice instance
      Voice.removeAllListeners();
    };
  }, []);

  const handleMicPress = async () => {
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Microphone permission is required to use voice input.');
      return;
    }
    
    if (isRecording) {
      try {
        await Voice.stop();
        setIsRecording(false);
      } catch (e) {
        console.error('Error stopping recording:', e);
      }
    } else {
      try {
        setInputText('');
        // FIX: Wrap Voice.start in a try-catch to handle initialization errors
        await Voice.start('en-US');
        setIsRecording(true);
      } catch (e) {
        console.error('Error starting recording:', e);
        Alert.alert('Error', 'Could not start voice recognition. Please try again.');
      }
    }
  };

  // --- Load Chat History on App Start ---
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const storedHistory = await AsyncStorage.getItem(CHAT_HISTORY_KEY);
        if (storedHistory) {
          const parsedHistory: ChatSession[] = JSON.parse(storedHistory);
          if (parsedHistory.length > 0) {
            setSessions(parsedHistory);
            setActiveSessionId(parsedHistory[0].id);
          } else {
            createNewChat();
          }
        } else {
          createNewChat();
        }
      } catch (error) {
        console.error("Failed to load chat history:", error);
        createNewChat();
      }
    };
    loadHistory();
  }, []);

  // --- Save Chat History Whenever It Changes ---
  useEffect(() => {
    const saveHistory = async () => {
      if (sessions.length === 0) return;
      try {
        const historyToSave = sessions.slice(0, MAX_HISTORY_LENGTH);
        await AsyncStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(historyToSave));
      } catch (error) {
        console.error("Failed to save chat history:", error);
      }
    };
    if (!isLoading) {
        saveHistory();
    }
  }, [sessions, isLoading]);


  // Automatically scroll to the bottom when new messages are added
  useEffect(() => {
    if (flatListRef.current && activeSession?.messages.length) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  }, [sessions, activeSessionId]);

  // --- API Call to Gemini (Streaming with XMLHttpRequest) ---
  const streamGeminiResponse = (modelId: string, history: GeminiContent[], onChunk: (chunk: string) => void): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (!GEMINI_API_KEY) {
            const errorMsg = "Error: API Key is not configured. Please check your .env file.";
            onChunk(errorMsg);
            reject(new Error(errorMsg));
            return;
        }
        
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?key=${GEMINI_API_KEY}`;
        const xhr = new XMLHttpRequest();
        xhr.open('POST', API_URL);
        xhr.setRequestHeader('Content-Type', 'application/json');

        let lastResponseLength = 0;

        xhr.onprogress = () => {
            const responseText = xhr.responseText;
            const newText = responseText.substring(lastResponseLength);
            lastResponseLength = responseText.length;

            const regex = /"text"\s*:\s*"((?:\\"|[^"])*)"/g;
            let match;
            while ((match = regex.exec(newText)) !== null) {
                try {
                    const decodedText = JSON.parse(`"${match[1]}"`);
                    onChunk(decodedText);
                } catch (e) {
                    onChunk(match[1]);
                }
            }
        };

        xhr.onloadend = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                const errorMsg = `Request failed. Status: ${xhr.status}`;
                reject(new Error(errorMsg));
            }
        };

        xhr.onerror = () => {
            const errorMsg = `Network request failed. Status: ${xhr.status}`;
            console.error('Failed to fetch Gemini response:', xhr.responseText);
            onChunk(`\n\n**Error:** ${errorMsg}`);
            reject(new Error(errorMsg));
        };

        xhr.send(JSON.stringify({ contents: history }));
    });
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  // --- Handle Sending a Message ---
  const handleSendMessage = async () => {
    if (inputText.trim() === '' || isLoading || !activeSessionId || !activeSession) return;

    const userMessage: Message = { id: Date.now().toString(), text: inputText, isFromUser: true };
    const aiMessagePlaceholder: Message = { id: (Date.now() + 1).toString(), text: '', isFromUser: false };

    const recentMessages = activeSession.messages.slice(-CONTEXT_WINDOW_SIZE);
    const history: GeminiContent[] = recentMessages.map(msg => ({
        role: msg.isFromUser ? 'user' : 'model',
        parts: [{ text: msg.text }]
    }));
    const fullPrompt = `Please format your response in Markdown. Here is my question: ${inputText}`;
    history.push({
        role: 'user',
        parts: [{ text: fullPrompt }]
    });

    setSessions(prev => prev.map(session => 
      session.id === activeSessionId
        ? { ...session, messages: [...session.messages, userMessage, aiMessagePlaceholder] }
        : session
    ));
    
    setInputText('');
    setIsLoading(true);

    const onChunk = (chunk: string) => {
      setSessions(prev => prev.map(session => {
        if (session.id === activeSessionId) {
          const lastMessage = session.messages[session.messages.length - 1];
          if (lastMessage) {
            const updatedMessage = { ...lastMessage, text: lastMessage.text + chunk };
            return { ...session, messages: [...session.messages.slice(0, -1), updatedMessage] };
          }
        }
        return session;
      }));
    };

    try {
        await streamGeminiResponse(selectedModel, history, onChunk);
    } catch (error) {
        console.error("Error during streaming:", error);
    } finally {
        setIsLoading(false);
    }
  };

  // --- Chat History Management ---
  const createNewChat = () => {
    const newSession: ChatSession = { id: Date.now().toString(), messages: [] };
    setSessions(prevSessions => [newSession, ...prevSessions]);
    setActiveSessionId(newSession.id);
    setIsDrawerVisible(false);
  };

  const switchToSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setIsDrawerVisible(false);
  };

  const deleteSession = (sessionId: string) => {
    const newSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(newSessions);
    if (activeSessionId === sessionId) {
        if (newSessions.length > 0) {
            setActiveSessionId(newSessions[0].id);
        } else {
            const newSession: ChatSession = { id: Date.now().toString(), messages: [] };
            setSessions([newSession]);
            setActiveSessionId(newSession.id);
        }
    }
  };


  // --- Render a single message bubble ---
  const renderMessage = ({ item }: { item: Message }) => (
    <View style={[ styles.messageContainer, item.isFromUser ? styles.userMessageContainer : styles.aiMessageContainer ]}>
      {item.isFromUser ? (
        <Text style={styles.messageText}>{item.text}</Text>
      ) : (
        item.text ? <Markdown style={markdownStyles}>{item.text}</Markdown> : <ActivityIndicator size="small" color="#FFFFFF" />
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ChatHistoryDrawer
        visible={isDrawerVisible}
        onClose={() => setIsDrawerVisible(false)}
        sessions={sessions}
        onSwitchSession={switchToSession}
        onNewChat={createNewChat}
        onDeleteSession={deleteSession}
        models={availableModels}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
      />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setIsDrawerVisible(true)} style={styles.headerButton}>
          <Feather name="menu" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Gemini Chat</Text>
        <View style={{ width: 24 }} />
      </View>
      
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={activeSession?.messages || []}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          style={styles.chatArea}
          contentContainerStyle={{ paddingVertical: 10 }}
        />
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.loadingText}>Gemini is thinking...</Text>
          </View>
        )}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={isRecording ? "Listening..." : "Ask me anything..."}
            placeholderTextColor="#999"
            editable={!isLoading && !isRecording}
            multiline
          />
          {inputText.trim() === '' ? (
            <TouchableOpacity
              style={styles.micButton}
              onPress={handleMicPress}
              disabled={isLoading}
            >
              <Feather name={isRecording ? "stop-circle" : "mic"} size={22} color={isRecording ? "#FF6B6B" : "#FFFFFF"} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.sendButton}
              onPress={handleSendMessage}
              disabled={isLoading}
            >
              <Feather name="send" size={22} color="#FFFFFF" style={{ transform: [{ rotate: '0deg' }] }} />
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// --- Styles for the Markdown content ---
const markdownStyles = StyleSheet.create({
  body: { color: '#FFFFFF', fontSize: 16 },
  heading1: { color: '#FFFFFF', fontSize: 24, fontWeight: 'bold', marginTop: 10, marginBottom: 5 },
  heading2: { color: '#FFFFFF', fontSize: 20, fontWeight: 'bold', marginTop: 8, marginBottom: 4 },
  strong: { fontWeight: 'bold' },
  list_item: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 4 },
  bullet_list_icon: { color: '#FFFFFF', fontSize: 16, marginRight: 8, lineHeight: 24 },
  code_inline: { backgroundColor: '#1E1E1E', color: '#FFD700', padding: 2, borderRadius: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  code_block: { backgroundColor: '#1E1E1E', color: '#FFFFFF', padding: 10, borderRadius: 4, marginVertical: 5, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});

// --- General Styles ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: '#1E1E1E',
  },
  headerButton: {
    padding: 5,
  },
  headerTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  chatArea: { flex: 1, paddingHorizontal: 10 },
  messageContainer: { padding: 12, borderRadius: 18, marginVertical: 5, maxWidth: '80%' },
  userMessageContainer: { backgroundColor: '#344C64', alignSelf: 'flex-end' },
  aiMessageContainer: { backgroundColor: '#2C2C2C', alignSelf: 'flex-start' },
  messageText: { color: '#FFFFFF', fontSize: 16 },
  loadingContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10 },
  loadingText: { color: '#FFFFFF', marginLeft: 10 },
  inputContainer: { 
    flexDirection: 'row', 
    padding: 10, 
    borderTopWidth: 1, 
    borderTopColor: '#333', 
    backgroundColor: '#1E1E1E', 
    alignItems: 'flex-end'
  },
  input: { 
    flex: 1, 
    backgroundColor: '#2C2C2C', 
    borderRadius: 20, 
    paddingHorizontal: 15, 
    paddingTop: 10,
    paddingBottom: 10,
    color: '#FFFFFF', 
    marginRight: 10, 
    fontSize: 16,
    maxHeight: 120,
  },
  micButton: {
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 5,
  },
  sendButton: { 
    backgroundColor: '#344C64', 
    borderRadius: 22,
    width: 44,
    height: 44,
    justifyContent: 'center', 
    alignItems: 'center',
    marginBottom: 5,
  },
  sendButtonDisabled: { backgroundColor: '#555' },
  sendButtonText: { color: '#FFFFFF', fontWeight: 'bold' },
  // Drawer Styles
  drawerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  drawerContainer: {
    width: '80%',
    height: '100%',
    backgroundColor: '#1E1E1E',
    paddingTop: 60,
    paddingHorizontal: 10,
  },
  drawerHeader: {
    paddingHorizontal: 10,
    marginBottom: 20,
  },
  drawerNewChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#344C64',
    padding: 12,
    borderRadius: 10,
  },
  drawerNewChatText: {
    color: '#FFFFFF',
    fontSize: 16,
    marginLeft: 10,
    fontWeight: 'bold',
  },
  historyListHeader: {
    color: '#999',
    fontSize: 14,
    fontWeight: 'bold',
    paddingHorizontal: 10,
    marginBottom: 10,
    marginTop: 20,
    textTransform: 'uppercase',
  },
  historyItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyText: {
    color: '#FFFFFF',
    fontSize: 16,
    flex: 1,
  },
  deleteButton: {
    padding: 5,
    marginLeft: 10,
  },
  modelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 5,
  },
  modelItemSelected: {
    backgroundColor: '#344C64',
  },
  modelText: {
    color: '#FFFFFF',
    fontSize: 16,
    marginLeft: 10,
  },
});
